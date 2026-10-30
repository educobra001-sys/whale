import { Worker } from "bullmq"
import { getMessagingSettings } from "./common/service/settings"
import { runWithTeacher, runAsPlatform } from "./common/service/tenantContext"
import { monthKey, whatsappNumber } from "./common/service/helpers"
import { redisService } from "./common/service/redisService"
import { env } from "./config/env.service"
import { dbconnection } from "./db/connection"
import { repos } from "./db/repository"
import billingService from "./module/billing/billing.service"
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
        if (!whatsappConnected() && env.isDev) throw new Simulated()
        return sendWhatsappWeb(item.to, item.body)
    }
    throw new Error(`Unknown channel ${item.channel}`)
}

const process = async (job: any) => runWithTeacher(job.data.teacher, async () => {
    const item = await repos.messageItem.findById({ id: job.data.item })
    if (!item || item.status !== "queued") return
    try {
        await deliver(item)
        await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: { status: "sent", sentAt: new Date() } } })
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

const previousMonth = () => {
    const now = new Date()
    return monthKey(new Date(now.getFullYear(), now.getMonth(), 0, 12))
}

export const startWorkers = async () => {
    new Worker(FAST_QUEUE, process, { connection: queueConnection() as any, concurrency: 20, limiter: { max: 25, duration: 1000 } })
    new Worker(WHATSAPP_WEB_QUEUE, process, { connection: queueConnection() as any, concurrency: 1 })
    new Worker(BILLING_QUEUE, () => billingService.generateMonth(previousMonth()), { connection: queueConnection() as any })
    // Closes the previous month's invoices on the 1st of every month.
    const billing = new Queue(BILLING_QUEUE, { connection: queueConnection() as any })
    await billing.upsertJobScheduler("monthly-invoices", { pattern: "30 0 1 * *", tz: "Africa/Cairo" }, { name: "generate" })
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
