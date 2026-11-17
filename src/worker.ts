import { Worker } from "bullmq"
import { getMessagingSettings } from "./common/service/settings"
import { runWithTeacher, runAsPlatform } from "./common/service/tenantContext"
import { monthKey, whatsappNumber } from "./common/service/helpers"
import { redisService } from "./common/service/redisService"
import { env } from "./config/env.service"
import { dbconnection } from "./db/connection"
import { repos } from "./db/repository"
import billingService from "./module/billing/billing.service"
import { runBackup } from "./scripts/backup"
import { BILLING_QUEUE, FAST_QUEUE, WHATSAPP_WEB_QUEUE, queueConnection } from "./module/message/message.queue"
import { sendTelegram, startTelegramPolling, telegramEnabled } from "./module/message/telegram.service"
import { sendWhatsappWeb, startWhatsappListener, whatsappConnected } from "./module/message/whatsappWeb.service"
import { Queue } from "bullmq"

class Simulated extends Error {}

const sendByApi = async (to: string, body: string) => {
    const { whatsappApi } = await getMessagingSettings()
    if (!whatsappApi.enabled || !whatsappApi.accessToken || !whatsappApi.phoneNumberId) throw new Simulated()
    const response = await fetch(`https://graph.facebook.com/v21.0/${whatsappApi.phoneNumberId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${whatsappApi.accessToken}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to: whatsappNumber(to), type: "text", text: { body } }),
        signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`)
    const result: any = await response.json().catch(() => ({}))
    return { waMessageId: result?.messages?.[0]?.id as string | undefined }
}

const sendByTelegram = async (item: any, body: string) => {
    if (!telegramEnabled()) throw new Simulated()
    const links = item.student ? await runAsPlatform(() => repos.telegramLink.findall({ filter: { student: item.student } })) : []
    if (!links.length) throw new Error("This student hasn't linked Telegram yet")
    await Promise.all(links.map((link) => sendTelegram(link.chatId, body)))
}

const deliver = async (item: any) => {
    if (item.channel === "telegram") return sendByTelegram(item, item.body)
    if (item.channel === "whatsapp_api") return sendByApi(item.to, item.body)
    if (item.channel === "whatsapp_web") {
        if (!whatsappConnected() && env.testMode) throw new Simulated()
        return sendWhatsappWeb(item.to, item.body)
    }
    throw new Error(`Unknown channel ${item.channel}`)
}

export const processJob = async (job: any) => runWithTeacher(job.data.teacher, async () => {
    const item = await repos.messageItem.findById({ id: job.data.item })
    if (!item || item.status !== "queued") return
    try {
        const result: any = await deliver(item)
        const set: any = { status: "sent", sentAt: new Date() }
        if (result?.waMessageId) set.waMessageId = result.waMessageId
        await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: set } })
    } catch (error: any) {
        if (error instanceof Simulated) {
            await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: { status: "simulated", sentAt: new Date() } } })
            return
        }
        const lastTry = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
        if (lastTry) await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: { status: "failed", error: String(error.message).slice(0, 300) } } })
        throw error
    }
})

// Without a background worker (Vercel), messages are sent straight away, 10 at a time, with the same 3 tries.
export const deliverNow = async (jobs: { data: any }[]) => {
    const attempts = 3
    const queue = [...jobs]
    const run = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
            for (let attemptsMade = 0; attemptsMade < attempts; attemptsMade += 1) {
                try {
                    await processJob({ data: job.data, attemptsMade, opts: { attempts } })
                    break
                } catch {
                    if (attemptsMade + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attemptsMade))
                }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(10, jobs.length) }, run))
}

export const previousMonth = () => {
    const now = new Date()
    return monthKey(new Date(now.getFullYear(), now.getMonth(), 0, 12))
}

// Fewer Redis calls while the queues are empty, so hosted Redis with a monthly command limit (Upstash free) lasts.
// New jobs still start right away: BullMQ wakes a waiting worker as soon as one is added.
const idle = { drainDelay: 60, stalledInterval: 300_000 }

export const startWorkers = async () => {
    new Worker(FAST_QUEUE, processJob, { connection: queueConnection() as any, concurrency: 20, limiter: { max: 25, duration: 1000 }, ...idle })
    new Worker(WHATSAPP_WEB_QUEUE, processJob, { connection: queueConnection() as any, concurrency: 1, ...idle })
    new Worker(BILLING_QUEUE, () => billingService.generateMonth(previousMonth()), { connection: queueConnection() as any, ...idle })
    // Closes the previous month's invoices on the 1st of every month.
    const billing = new Queue(BILLING_QUEUE, { connection: queueConnection() as any })
    await billing.upsertJobScheduler("monthly-invoices", { pattern: "30 0 1 * *", tz: "Africa/Cairo" }, { name: "generate" })
    if (env.backupDaily) {
        // Nightly backup, streamed to disk (see scripts/backup.ts). Only one worker takes each run.
        const BACKUP_QUEUE = "backup"
        new Worker(BACKUP_QUEUE, async () => {
            const result = await runBackup()
            console.log(`[backup] ${result.file} (${(result.size / 1024 / 1024).toFixed(2)} MB)`)
        }, { connection: queueConnection() as any, ...idle })
        const backups = new Queue(BACKUP_QUEUE, { connection: queueConnection() as any })
        await backups.upsertJobScheduler("daily-backup", { pattern: "0 3 * * *", tz: "Africa/Cairo" }, { name: "backup" })
    }
    await startWhatsappListener()
    startTelegramPolling()
    console.log("background worker started")
}

if (require.main === module) {
    redisService.connectRedis()
        .then(dbconnection)
        .then(startWorkers)
        .catch((error) => {
            console.error(error)
            globalThis.process.exit(1)
        })
}
