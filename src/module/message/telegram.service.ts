import crypto from "node:crypto"
import { env } from "../../config/env.service"
import { repos } from "../../db/repository"
import { runAsPlatform } from "../../common/service/tenantContext"

const API = `https://api.telegram.org/bot${env.telegramToken}`

export const telegramEnabled = () => Boolean(env.telegramToken)

const sign = (studentId: string, role: string) =>
    crypto.createHmac("sha256", env.access_secret).update(`${studentId}:${role}`).digest("base64url").slice(0, 16)

// The link can't be forged, so nobody can subscribe to another child's messages by guessing an id.
export const telegramDeepLink = (studentId: string, role: string) => {
    if (!env.telegramBotUsername) return ""
    return `https://t.me/${env.telegramBotUsername}?start=${studentId}_${role === "student" ? "s" : "p"}_${sign(studentId, role)}`
}

export const sendTelegram = async (chatId: string, text: string) => {
    const response = await fetch(`${API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`Telegram ${response.status}: ${await response.text()}`)
}

const handleUpdate = async (update: any) => {
    const message = update.message
    const match = String(message?.text ?? "").match(/^\/start ([a-f\d]{24})_([sp])_([\w-]{16})$/i)
    if (!match) return
    const [, studentId, kind, signature] = match as unknown as [string, string, string, string]
    const role = kind === "s" ? "student" : "parent"
    if (signature !== sign(studentId, role)) return
    await runAsPlatform(() => repos.telegramLink.updateone({
        filter: { chatId: String(message.chat.id), student: studentId },
        data: { $set: { kind: role } },
        options: { upsert: true },
    }))
    await sendTelegram(String(message.chat.id), "Linked. You'll receive attendance messages here.")
}

// Long polling keeps the bot working without a public URL.
export const startTelegramPolling = () => {
    if (!telegramEnabled()) return
    let offset = 0
    const loop = async () => {
        for (;;) {
            try {
                const response = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`, { signal: AbortSignal.timeout(40_000) })
                const data: any = await response.json()
                for (const update of data.result ?? []) {
                    offset = update.update_id + 1
                    await handleUpdate(update).catch((error) => console.error("telegram update failed", error))
                }
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 5000))
            }
        }
    }
    void loop()
}
