import crypto from "node:crypto"
import { normalizePhone, personName, sameId, whatsappNumber } from "../../common/service/helpers"
import { getMessagingSettings, saveMessagingSettings } from "../../common/service/settings"
import { runAsPlatform } from "../../common/service/tenantContext"
import { env, selfUrl } from "../../config/env.service"
import { repos } from "../../db/repository"

// The Telegram bot. The owner pastes the token on the Messaging page; the server then registers a webhook
// (Vercel or any https address) or, on a plain local server, the worker polls Telegram instead.
// Anyone who opens the bot gets a "Share my phone number" button. The shared number is matched against
// students' and parents' phones, and the chat is saved next to every student it belongs to.

export const telegramConfig = async () => {
    const saved = (await getMessagingSettings()).telegram
    return { ...saved, token: saved.token || env.telegramToken, username: saved.username || env.telegramBotUsername }
}

export const telegramEnabled = async () => Boolean((await telegramConfig()).token)

const call = async (token: string, method: string, body: Record<string, unknown> = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    })
    const data: any = await response.json().catch(() => ({}))
    if (!data.ok) throw new Error(`Telegram: ${data.description ?? `error ${response.status}`}`)
    return data.result
}

export const sendTelegram = async (chatId: string, text: string, extra: Record<string, unknown> = {}) => {
    const { token } = await telegramConfig()
    if (!token) throw new Error("No Telegram bot is set up")
    await call(token, "sendMessage", { chat_id: chatId, text: text.slice(0, 4096), ...extra })
}

// ---------- owner setup ----------

export const telegramStatus = async () => {
    const config = await telegramConfig()
    const linkedChats = config.token ? (await runAsPlatform(() => repos.telegramLink.distinct("chatId"))).length : 0
    return {
        configured: Boolean(config.token),
        fromEnvironment: Boolean(!(await getMessagingSettings()).telegram.token && env.telegramToken),
        username: config.username,
        botName: config.botName,
        mode: config.mode,
        webhookUrl: config.webhookUrl,
        error: config.error,
        link: config.username ? `https://t.me/${config.username}` : "",
        linkedChats,
    }
}

export const setupTelegram = async (token: string) => {
    const me = await call(token, "getMe")
    const webhookSecret = crypto.randomBytes(24).toString("hex")
    const base = selfUrl()
    let mode: "webhook" | "polling" = "polling"
    let webhookUrl = ""
    if (base.startsWith("https://")) {
        webhookUrl = `${base}/webhooks/telegram`
        await call(token, "setWebhook", { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ["message"] })
        mode = "webhook"
    } else {
        // Polling and a webhook can't both be active.
        await call(token, "deleteWebhook")
    }
    await call(token, "setMyCommands", { commands: [{ command: "start", description: "Link this chat with your phone number" }] }).catch(() => undefined)
    await saveMessagingSettings({ telegram: { token, username: me.username ?? "", botName: me.first_name ?? "", webhookSecret, mode, webhookUrl, error: "" } })
    return telegramStatus()
}

export const removeTelegram = async () => {
    const config = await telegramConfig()
    if (config.token) await call(config.token, "deleteWebhook").catch(() => undefined)
    await saveMessagingSettings({ telegram: { token: "", username: "", botName: "", webhookSecret: "", mode: "", webhookUrl: "", error: "" } })
    return telegramStatus()
}

// ---------- the signed link from the app (older way to link, still accepted) ----------

const sign = (studentId: string, role: string) =>
    crypto.createHmac("sha256", env.access_secret).update(`${studentId}:${role}`).digest("base64url").slice(0, 16)

export const telegramDeepLink = async (studentId: string, role: string) => {
    const { username } = await telegramConfig()
    if (!username) return ""
    return `https://t.me/${username}?start=${studentId}_${role === "student" ? "s" : "p"}_${sign(studentId, role)}`
}

// ---------- conversation ----------

const SHARE_BUTTON = {
    reply_markup: {
        keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
        resize_keyboard: true,
        is_persistent: true,
    },
}
const NO_KEYBOARD = { reply_markup: { remove_keyboard: true } }

const saveLink = (chatId: string, studentId: unknown, kind: "student" | "parent", extra: Record<string, unknown>) =>
    repos.telegramLink.updateone({
        filter: { chatId, student: studentId },
        data: { $set: { kind, ...extra } },
        options: { upsert: true },
    })

const linkedNames = async (chatId: string) => {
    const links = await repos.telegramLink.findall({ filter: { chatId } })
    if (!links.length) return []
    const students = await repos.student.findall({ filter: { _id: { $in: links.map((link) => link.student) } }, select: "firstName lastName" })
    return links.map((link) => {
        const student = students.find((item) => sameId(item._id, link.student))
        return `• ${personName(student) || "Student"} (${link.kind === "student" ? "student" : "parent"})`
    })
}

const linkByContact = async (chatId: string, message: any) => {
    const contact = message.contact
    // The button only shares the sender's own number. A forwarded contact card belongs to someone else.
    if (contact.user_id && message.from?.id && String(contact.user_id) !== String(message.from.id)) {
        await sendTelegram(chatId, "Please share your own number with the button below, not someone else's contact.", SHARE_BUTTON)
        return
    }
    const phone = normalizePhone(contact.phone_number)
    const variants = [...new Set([phone, whatsappNumber(phone), `+${whatsappNumber(phone)}`])].filter(Boolean)
    const [students, parents] = await Promise.all([
        repos.student.findall({ filter: { $or: [{ phone: { $in: variants } }, { parentPhone: { $in: variants } }] }, select: "firstName lastName phone parentPhone" }),
        repos.parent.findall({ filter: { phone: { $in: variants } }, select: "children" }),
    ])
    const matches = new Map<string, "student" | "parent">()
    for (const student of students) {
        const own = normalizePhone(student.phone) === phone
        const parent = normalizePhone(student.parentPhone) === phone
        matches.set(String(student._id), parent || !own ? "parent" : "student")
    }
    for (const parent of parents) for (const child of parent.children ?? []) if (!matches.has(String(child))) matches.set(String(child), "parent")
    if (!matches.size) {
        await sendTelegram(chatId, `We couldn't find ${phone} among the students or parents registered with our teachers.\n\nAsk the teacher to check the phone number saved for you, then press the button again.`, SHARE_BUTTON)
        return
    }
    const extra = {
        phone,
        telegramName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" "),
        telegramUsername: message.from?.username ?? "",
    }
    for (const [studentId, kind] of matches) await saveLink(chatId, studentId, kind, extra)
    const names = await linkedNames(chatId)
    await sendTelegram(chatId, `✅ Done! This chat is now linked to:\n${names.join("\n")}\n\nAttendance, absence and other messages from the teachers will arrive here.`, NO_KEYBOARD)
}

export const handleTelegramUpdate = (update: any) => runAsPlatform(async () => {
    const message = update?.message
    if (!message?.chat || message.chat.type !== "private") return
    const chatId = String(message.chat.id)
    if (message.contact) return linkByContact(chatId, message)

    const text = String(message.text ?? "").trim()
    const deep = text.match(/^\/start ([a-f\d]{24})_([sp])_([\w-]{16})$/i)
    if (deep) {
        const [, studentId, kind, signature] = deep as unknown as [string, string, string, string]
        const role = kind === "s" ? "student" : "parent"
        if (signature === sign(studentId, role)) {
            await saveLink(chatId, studentId, role, { telegramName: message.from?.first_name ?? "", telegramUsername: message.from?.username ?? "" })
            await sendTelegram(chatId, `✅ Linked. You'll receive messages here.\n\n${(await linkedNames(chatId)).join("\n")}`, NO_KEYBOARD)
            return
        }
    }

    const names = await linkedNames(chatId)
    if (names.length) {
        await sendTelegram(chatId, `This chat is linked to:\n${names.join("\n")}\n\nIf your phone number changed, press the button below to share the new one.`, SHARE_BUTTON)
        return
    }
    await sendTelegram(chatId, `Welcome to ${env.appName}! 👋\n\nPress the button below to share your phone number. If it's the number of a student or a parent registered with one of our teachers, this chat will receive their attendance and other messages.`, SHARE_BUTTON)
})

// ---------- receiving updates ----------

export const telegramSecretMatches = async (header: unknown) => {
    const { webhookSecret } = await telegramConfig()
    const given = Buffer.from(String(header ?? ""))
    const expected = Buffer.from(webhookSecret ?? "")
    return expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// Long polling for servers without an https address. Waits while a webhook is in use.
export const startTelegramPolling = () => {
    let offset = 0
    let lastToken = ""
    const loop = async () => {
        for (;;) {
            try {
                const config = await telegramConfig()
                if (!config.token || config.mode === "webhook") {
                    await new Promise((resolve) => setTimeout(resolve, 30_000))
                    continue
                }
                if (config.token !== lastToken) {
                    lastToken = config.token
                    offset = 0
                    await call(config.token, "deleteWebhook").catch(() => undefined)
                }
                const response = await fetch(`https://api.telegram.org/bot${config.token}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`, { signal: AbortSignal.timeout(40_000) })
                const data: any = await response.json()
                for (const update of data.result ?? []) {
                    offset = update.update_id + 1
                    await handleTelegramUpdate(update).catch((error) => console.error("telegram update failed", error))
                }
                if (!data.ok) await new Promise((resolve) => setTimeout(resolve, 10_000))
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 5000))
            }
        }
    }
    void loop()
}
