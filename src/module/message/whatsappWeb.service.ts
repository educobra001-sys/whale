import crypto from "node:crypto"
import QRCode from "qrcode"
import { waitUntil } from "@vercel/functions"
import { checkPhone } from "../../common/service/helpers"
import { redisService } from "../../common/service/redisService"
import { getMessagingSettings } from "../../common/service/settings"
import { runAsPlatform } from "../../common/service/tenantContext"
import { env, selfUrl } from "../../config/env.service"
import { whatsappAccountModel, whatsappAuthModel } from "../../db/model/platform"
import { repos } from "../../db/repository"

// WhatsApp Web through a number linked by QR code (Baileys). Nothing here needs a server that stays on:
// - the login (keys) is kept in MongoDB, so any process, or a short-lived Vercel function, can use it;
// - one Redis lock per number makes sure only one connection to it exists at a time;
// - a batch is sent by a function that connects, sends at the owner's pace until its time is nearly up,
//   disconnects and, if messages are left, calls the next function to carry on.
// "platform" is the owner's number. A teacher's own number uses the teacher's id.

export const PLATFORM = "platform"

export type WhatsappState = {
    account: string
    status: "disconnected" | "connecting" | "qr" | "connected"
    qr?: string
    phone?: string
    error?: string
    linkedAt?: Date
    lastSentAt?: Date
    queued?: number
    busy?: boolean
}

class WaError extends Error {
    constructor(public code: "not_linked" | "timeout" | "closed", message: string, public status = 0) {
        super(message)
    }
}

const RESTART_REQUIRED = 515
const LOGGED_OUT = 401
const LINK_SECONDS = 150

const lockKey = (account: string) => `wa:lock:${account}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
const silentLogger: any = { level: "silent", child: () => silentLogger, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }

// On Vercel the work keeps running after the reply is sent; elsewhere it simply runs in the background.
const background = (work: Promise<unknown>) => {
    const guarded = work.catch((error) => console.error("[whatsapp]", error))
    if (env.serverless) waitUntil(guarded)
}

// The time one function may spend sending before handing over to the next one.
const sendBudgetMs = () => (env.serverless ? Math.max(25, env.functionSeconds - 20) * 1000 : 10 * 60 * 1000)
const linkBudgetMs = () => (env.serverless ? Math.min(LINK_SECONDS, Math.max(40, env.functionSeconds - 15)) * 1000 : LINK_SECONDS * 1000)

let baileysModule: any = null
const loadBaileys = async () => (baileysModule ??= await import("baileys"))

// WhatsApp refuses outdated client versions, so ask for the current one (cached; falls back to the built-in one).
let versionCache: { version: any; at: number } | null = null
const waVersion = async (baileys: any) => {
    if (versionCache && Date.now() - versionCache.at < 6 * 3600_000) return versionCache.version
    try {
        const result: any = await Promise.race([baileys.fetchLatestBaileysVersion(), sleep(4000).then(() => null)])
        if (result?.version) versionCache = { version: result.version, at: Date.now() }
        return result?.version
    } catch {
        return undefined
    }
}

// Baileys' file-based login, stored in MongoDB instead. Every write is tracked so nothing is lost on disconnect.
const mongoAuth = async (account: string, baileys: any) => {
    const id = (name: string) => `${account}:${name}`
    const encode = (value: unknown) => JSON.stringify(value, baileys.BufferJSON.replacer)
    const decode = (raw: string) => JSON.parse(raw, baileys.BufferJSON.reviver)
    const pending = new Set<Promise<unknown>>()
    const track = <T>(promise: Promise<T>) => {
        pending.add(promise)
        promise.then(() => pending.delete(promise), () => pending.delete(promise))
        return promise
    }
    const saved: any = await whatsappAuthModel.findById(id("creds")).lean()
    const creds = saved ? decode(saved.value) : baileys.initAuthCreds()
    const keys = {
        get: async (type: string, ids: string[]) => {
            const rows: any[] = await whatsappAuthModel.find({ _id: { $in: ids.map((key) => id(`${type}-${key}`)) } }).lean()
            const found = new Map(rows.map((row) => [String(row._id), row.value as string]))
            const data: Record<string, any> = {}
            for (const key of ids) {
                const raw = found.get(id(`${type}-${key}`))
                if (!raw) continue
                let value = decode(raw)
                if (type === "app-state-sync-key" && value) value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value)
                data[key] = value
            }
            return data
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
            const ops: any[] = []
            for (const type of Object.keys(data)) {
                for (const [key, value] of Object.entries(data[type] ?? {})) {
                    const _id = id(`${type}-${key}`)
                    ops.push(value
                        ? { updateOne: { filter: { _id }, update: { $set: { account, value: encode(value) } }, upsert: true } }
                        : { deleteOne: { filter: { _id } } })
                }
            }
            if (ops.length) await track(whatsappAuthModel.bulkWrite(ops, { ordered: false }))
        },
    }
    return {
        state: { creds, keys },
        // Linked = the login holds the account id. (creds.registered is only set by pairing-code links,
        // never by QR links; Baileys itself checks creds.me to decide between logging in and showing a QR.)
        registered: Boolean(saved && creds.me?.id),
        saveCreds: () => track(whatsappAuthModel.updateOne({ _id: id("creds") }, { $set: { account, value: encode(creds) } }, { upsert: true })),
        flush: async () => {
            while (pending.size) await Promise.allSettled([...pending])
        },
    }
}

const clearAuth = (account: string) => whatsappAuthModel.deleteMany({ account })

const setState = (account: string, patch: Record<string, unknown>) =>
    whatsappAccountModel.updateOne({ _id: account }, { $set: patch }, { upsert: true })

type Live = { sock: any; close: () => Promise<void> }

// Opens one connection and resolves when WhatsApp says it's open. Anything else rejects with the reason.
const openSocket = async (account: string, options: { allowQr: boolean; timeoutMs: number; onQr?: (qr: string) => unknown }): Promise<Live> => {
    const baileys = await loadBaileys()
    const auth = await mongoAuth(account, baileys)
    if (!options.allowQr && !auth.registered) throw new WaError("not_linked", "This WhatsApp number isn't linked")
    const version = await waVersion(baileys)
    const makeSocket = baileys.makeWASocket ?? baileys.default
    const sock = makeSocket({
        ...(version ? { version } : {}),
        auth: { creds: auth.state.creds, keys: baileys.makeCacheableSignalKeyStore(auth.state.keys, silentLogger) },
        logger: silentLogger,
        printQRInTerminal: false,
        browser: ["EduCobra", "Chrome", "1.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 20_000,
        getMessage: async () => undefined,
    })
    sock.ev.on("creds.update", auth.saveCreds)
    let closed = false
    const close = async () => {
        if (closed) return
        closed = true
        await auth.flush()
        try {
            sock.end(undefined)
        } catch {
            /* already closed */
        }
        await auth.flush()
    }
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new WaError("timeout", "WhatsApp didn't answer in time")), Math.max(5000, options.timeoutMs))
            sock.ev.on("connection.update", (update: any) => {
                if (update.qr) {
                    if (!options.allowQr) {
                        clearTimeout(timer)
                        reject(new WaError("not_linked", "This WhatsApp number isn't linked"))
                        return
                    }
                    void Promise.resolve(options.onQr?.(update.qr)).catch(() => undefined)
                }
                if (update.connection === "open") {
                    clearTimeout(timer)
                    resolve()
                }
                if (update.connection === "close") {
                    clearTimeout(timer)
                    const status = Number(update.lastDisconnect?.error?.output?.statusCode ?? 0)
                    reject(new WaError("closed", update.lastDisconnect?.error?.message ?? "WhatsApp closed the connection", status))
                }
            })
        })
    } catch (error) {
        await close()
        throw error
    }
    void setState(account, { lastSeenAt: new Date() }).catch(() => undefined)
    return { sock, close }
}

const phoneOf = (sock: any) => String(sock.user?.id ?? "").split(/[:@]/)[0]

const queuedFilter = (account: string) => ({
    channel: "whatsapp_web",
    status: "queued",
    sender: account === PLATFORM ? { $in: [PLATFORM, null] } : account,
})

const failQueued = (account: string, error: string) =>
    runAsPlatform(() => repos.messageItem.updateMany({ filter: queuedFilter(account), data: { $set: { status: "failed", error } } }))

// ---------- status ----------

export const whatsappState = async (account = PLATFORM): Promise<WhatsappState> => {
    const [row, queued, busy]: any = await Promise.all([
        whatsappAccountModel.findById(account).lean(),
        runAsPlatform(() => repos.messageItem.count(queuedFilter(account))),
        redisService.exists(lockKey(account)).catch(() => false),
    ])
    if (!row) return { account, status: "disconnected", queued, busy }
    const waiting = row.status === "qr" || row.status === "connecting"
    // A link that was started but whose function has ended (nobody scanned in time).
    const expired = waiting && !busy && Date.now() - new Date(row.updatedAt).getTime() > 30_000
    if (queued && !busy && row.status === "connected") kickWhatsapp(account)
    return {
        account,
        status: expired ? "disconnected" : row.status,
        qr: row.status === "qr" && !expired ? row.qr : undefined,
        phone: row.phone || undefined,
        error: expired ? "The code expired before it was scanned. Press Link WhatsApp to get a new one." : row.error || undefined,
        linkedAt: row.linkedAt,
        lastSentAt: row.lastSentAt,
        queued,
        busy,
    }
}

export const whatsappStates = async (accounts: string[]) => Promise.all(accounts.map((account) => whatsappState(account)))

export const accountLinked = async (account: string) => {
    const row: any = await whatsappAccountModel.findById(account, { status: 1 }).lean()
    return row?.status === "connected"
}

// A teacher's own linked number sends their messages; otherwise the owner's number does.
export const senderFor = async (teacherId: string) => {
    if (await accountLinked(String(teacherId))) return { account: String(teacherId), linked: true }
    return { account: PLATFORM, linked: await accountLinked(PLATFORM) }
}

// ---------- linking ----------

const runLink = async (account: string, token: string, deadline: number) => {
    const lock = lockKey(account)
    let outcome: Record<string, unknown> = { status: "disconnected", qr: "", error: "Linking didn't finish. Press Link WhatsApp to try again." }
    try {
        for (let attempt = 0; attempt < 5 && Date.now() < deadline - 5000; attempt += 1) {
            try {
                const live = await openSocket(account, {
                    allowQr: true,
                    timeoutMs: deadline - Date.now() - 2000,
                    onQr: async (qr) => {
                        await setState(account, { status: "qr", qr: await QRCode.toDataURL(qr, { margin: 1, width: 320 }), error: "" })
                        await redisService.extendLock(lock, token, deadline - Date.now() + 30_000)
                    },
                })
                await setState(account, { status: "connected", phone: phoneOf(live.sock), qr: "", error: "", linkedAt: new Date() })
                outcome = {}
                // Give WhatsApp a few seconds to finish setting up the new device before going offline.
                await sleep(Math.min(8000, deadline - Date.now() - 1000))
                await live.close()
                return
            } catch (error: any) {
                // Right after the code is scanned WhatsApp asks for a fresh connection with the new login.
                if (error.status === RESTART_REQUIRED) continue
                if (error.status === LOGGED_OUT) {
                    await clearAuth(account)
                    outcome = { status: "disconnected", qr: "", error: "WhatsApp refused the link. Press Link WhatsApp to try again." }
                    return
                }
                if (error.code === "timeout" || error.status === 408) {
                    outcome = { status: "disconnected", qr: "", error: "The code expired before it was scanned. Press Link WhatsApp to get a new one." }
                    return
                }
                await sleep(1500)
            }
        }
    } finally {
        if (Object.keys(outcome).length) await setState(account, outcome).catch(() => undefined)
        await redisService.unlock(lock, token).catch(() => undefined)
    }
}

// Starts linking and returns at once. The page polls whatsappState() for the QR code.
export const linkWhatsapp = async (account = PLATFORM) => {
    const budget = linkBudgetMs()
    const token = await redisService.lock(lockKey(account), budget + 30_000)
    if (!token) return whatsappState(account)
    const baileys = await loadBaileys()
    const auth = await mongoAuth(account, baileys)
    if (auth.registered) {
        // Already linked: just check the login still works.
        background((async () => {
            try {
                const live = await openSocket(account, { allowQr: false, timeoutMs: 25_000 })
                await setState(account, { status: "connected", phone: phoneOf(live.sock), qr: "", error: "" })
                await live.close()
            } catch (error: any) {
                if (error.status === LOGGED_OUT || error.code === "not_linked") {
                    await clearAuth(account)
                    await setState(account, { status: "disconnected", phone: "", qr: "", error: "This number was unlinked from the phone. Press Link WhatsApp to link it again." })
                } else {
                    await setState(account, { error: `Couldn't reach WhatsApp: ${String(error.message).slice(0, 200)}` })
                }
            } finally {
                await redisService.unlock(lockKey(account), token).catch(() => undefined)
            }
        })())
        return whatsappState(account)
    }
    await clearAuth(account)
    await setState(account, { status: "connecting", qr: "", error: "", phone: "" })
    background(runLink(account, token, Date.now() + budget))
    return whatsappState(account)
}

export const unlinkWhatsapp = async (account = PLATFORM) => {
    const token = await redisService.lock(lockKey(account), 40_000)
    if (!token) throw new Error("This number is busy sending or linking. Try again in a minute.")
    try {
        try {
            const live = await openSocket(account, { allowQr: false, timeoutMs: 15_000 })
            await live.sock.logout().catch(() => undefined)
            await live.close()
        } catch {
            /* not linked or unreachable: forgetting the login is enough */
        }
        await clearAuth(account)
        await setState(account, { status: "disconnected", phone: "", qr: "", error: "" })
        await failQueued(account, "The sending WhatsApp number was unlinked before this message went out.")
    } finally {
        await redisService.unlock(lockKey(account), token).catch(() => undefined)
    }
    return whatsappState(account)
}

// ---------- sending ----------

const MAX_TRIES = 3

// Asks WhatsApp which of these numbers have an account. WhatsApp only answers for the ones that do,
// so a number missing from the answer has no WhatsApp. Returns null when WhatsApp didn't answer at all.
const lookup = async (sock: any, numbers: string[]) => {
    const found = new Map<string, string>()
    for (let start = 0; start < numbers.length; start += 50) {
        const chunk = numbers.slice(start, start + 50)
        const result: any[] | undefined = await sock.onWhatsApp(...chunk)
        if (!Array.isArray(result)) return null
        for (const row of result) {
            if (!row?.exists || !row.jid) continue
            found.set(String(row.jid).split(/[:@]/)[0]!, row.jid)
        }
    }
    return found
}

const sendOne = async (sock: any, item: any) => {
    const checked = checkPhone(item.to)
    if (!checked.ok) return { error: `Wrong number: ${checked.reason}` }
    const number = checked.international
    let jid = `${number}@s.whatsapp.net`
    try {
        const found = await lookup(sock, [number])
        if (found && !found.has(number)) return { error: "This number isn't on WhatsApp" }
        jid = found?.get(number) ?? jid
    } catch {
        /* WhatsApp didn't answer the check: send anyway */
    }
    const sent = await sock.sendMessage(jid, { text: item.body })
    return { waMessageId: sent?.key?.id as string | undefined }
}

// Before sending: which numbers are wrong, and (when a number is linked and free) which aren't on WhatsApp.
export const checkNumbers = async (account: string, phones: string[]) => {
    const results = new Map<string, { ok: boolean; reason: string; international: string }>()
    for (const phone of phones) results.set(phone, checkPhone(phone))
    const valid = [...new Set([...results.values()].filter((row) => row.ok).map((row) => row.international))]
    let whatsapp: "checked" | "busy" | "not_linked" | "unavailable" = "unavailable"
    if (valid.length && (await accountLinked(account))) {
        const token = await redisService.lock(lockKey(account), 60_000)
        if (!token) whatsapp = "busy"
        else {
            try {
                const live = await openSocket(account, { allowQr: false, timeoutMs: 25_000 })
                try {
                    const found = await lookup(live.sock, valid)
                    if (found) {
                        whatsapp = "checked"
                        for (const row of results.values()) {
                            if (row.ok && !found.has(row.international)) Object.assign(row, { ok: false, reason: "This number isn't on WhatsApp" })
                        }
                    }
                } finally {
                    await live.close()
                }
            } catch (error: any) {
                if (error.code === "not_linked" || error.status === LOGGED_OUT) whatsapp = "not_linked"
            } finally {
                await redisService.unlock(lockKey(account), token).catch(() => undefined)
            }
        }
    } else if (valid.length) whatsapp = "not_linked"
    return {
        whatsapp,
        numbers: [...results.entries()].map(([phone, row]) => ({ phone, ok: row.ok, reason: row.reason, international: row.international })),
    }
}

// Sends this number's waiting messages, one every `delaySeconds`, until done or out of time.
export const drainWhatsapp = async (account = PLATFORM, budgetMs = sendBudgetMs()) => {
    const deadline = Date.now() + budgetMs
    const settings = await getMessagingSettings()
    const gap = Math.max(0, settings.delaySeconds) * 1000
    const lock = lockKey(account)
    const lockMs = gap + 90_000
    const token = await redisService.lock(lock, lockMs)
    if (!token) return { busy: true }
    let more = false
    try {
        more = await runAsPlatform(async () => {
            if (!(await repos.messageItem.exists(queuedFilter(account)))) return false
            let live: Live
            try {
                live = await openSocket(account, { allowQr: false, timeoutMs: 25_000 })
            } catch (error: any) {
                if (error.code === "not_linked" || error.status === LOGGED_OUT) {
                    if (error.status === LOGGED_OUT) await clearAuth(account)
                    await setState(account, { status: "disconnected", phone: "", qr: "", error: "This number was unlinked from the phone. Link it again to send." })
                    await failQueued(account, "The sending WhatsApp number isn't linked. Link it again from the owner dashboard.")
                    return false
                }
                await setState(account, { error: `Couldn't reach WhatsApp: ${String(error.message).slice(0, 200)}` })
                throw error
            }
            try {
                const row: any = await whatsappAccountModel.findById(account, { lastSentAt: 1 }).lean()
                const lastSent = row?.lastSentAt ? new Date(row.lastSentAt).getTime() : 0
                await sleep(Math.min(lastSent + gap - Date.now(), deadline - Date.now() - 10_000))
                for (;;) {
                    if (Date.now() + 10_000 > deadline) return true
                    const item = await repos.messageItem.findone({ filter: queuedFilter(account), sort: { _id: 1 } })
                    if (!item) return false
                    await redisService.extendLock(lock, token, lockMs)
                    let connectionLost = false
                    try {
                        const result = await sendOne(live.sock, item)
                        if (result.error) {
                            await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: { status: "failed", error: result.error } } })
                            continue
                        }
                        const set: any = { status: "sent", sentAt: new Date() }
                        if (result.waMessageId) set.waMessageId = result.waMessageId
                        await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: set } })
                        await setState(account, { lastSentAt: new Date(), error: "" })
                    } catch (error: any) {
                        const tries = (item.tries ?? 0) + 1
                        connectionLost = /closed|lost|timed? ?out/i.test(String(error?.message))
                        await repos.messageItem.updateone({
                            filter: { _id: item._id },
                            data: { $set: tries >= MAX_TRIES ? { status: "failed", error: String(error.message).slice(0, 300), tries } : { tries } },
                        })
                    }
                    if (connectionLost) return true
                    if (Date.now() + gap + 10_000 > deadline) return Boolean(await repos.messageItem.exists(queuedFilter(account)))
                    await sleep(gap)
                }
            } finally {
                await live.close()
            }
        })
    } finally {
        await redisService.unlock(lock, token).catch(() => undefined)
    }
    if (more) await continueLater(account)
    return { busy: false, more }
}

// Proves a call to /internal/whatsapp/drain came from this deployment.
export const internalKey = () => crypto.createHmac("sha256", env.access_secret || "educobra").update("whatsapp-drain").digest("hex")

const continueLater = async (account: string) => {
    if (!env.serverless) {
        setTimeout(() => kickWhatsapp(account), 1000)
        return
    }
    try {
        await fetch(`${selfUrl()}/internal/whatsapp/drain`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-educobra-key": internalKey() },
            body: JSON.stringify({ account }),
            signal: AbortSignal.timeout(10_000),
        })
    } catch (error: any) {
        // The next status check, history view or daily cron picks the batch up again.
        console.warn(`[whatsapp] couldn't hand over the rest of the batch: ${error.message}`)
    }
}

export const kickWhatsapp = (account = PLATFORM) => {
    background(drainWhatsapp(account))
}

// Restarts any number that has waiting messages and nobody sending them (after a crash or a missed hand-over).
export const kickStuckWhatsapp = async () => {
    const senders = await runAsPlatform(() => repos.messageItem.distinct("sender", { channel: "whatsapp_web", status: "queued" }))
    const accounts = [...new Set(senders.map((sender: any) => (sender ? String(sender) : PLATFORM)))]
    for (const account of accounts) {
        if (!(await redisService.exists(lockKey(account)).catch(() => true))) kickWhatsapp(account)
    }
    return accounts.length
}

// WhatsApp drops linked devices that stay offline for weeks, so connect briefly to quiet numbers.
export const keepWhatsappAlive = async () => {
    const cutoff = new Date(Date.now() - 5 * 86400_000)
    const rows: any[] = await whatsappAccountModel.find({ status: "connected", $or: [{ lastSeenAt: { $lt: cutoff } }, { lastSeenAt: null }] }).lean()
    for (const row of rows) {
        const token = await redisService.lock(lockKey(row._id), 60_000)
        if (!token) continue
        try {
            const live = await openSocket(row._id, { allowQr: false, timeoutMs: 25_000 })
            await sleep(3000)
            await live.close()
        } catch (error: any) {
            if (error.status === LOGGED_OUT || error.code === "not_linked") {
                await clearAuth(row._id)
                await setState(row._id, { status: "disconnected", phone: "", error: "This number was unlinked from the phone." })
            }
        } finally {
            await redisService.unlock(lockKey(row._id), token).catch(() => undefined)
        }
    }
    return rows.length
}
