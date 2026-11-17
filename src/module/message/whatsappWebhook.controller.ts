import crypto from "node:crypto"
import express, { Router } from "express"
import { runAsPlatform } from "../../common/service/tenantContext"
import { env } from "../../config/env.service"
import { repos } from "../../db/repository"

// WhatsApp Cloud API webhook. In Meta's dashboard (WhatsApp > Configuration):
//   Callback URL  = <PUBLIC_URL>/webhooks/whatsapp
//   Verify token  = WHATSAPP_VERIFY_TOKEN
// then subscribe to the "messages" field. Meta posts sent / delivered / read / failed for every message we send.

const router = Router()

const safeEqual = (a: string, b: string) => {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && crypto.timingSafeEqual(left, right)
}

// Meta's one-time check when you press "Verify and save".
router.get("/", (req, res) => {
    const mode = String(req.query["hub.mode"] ?? "")
    const token = String(req.query["hub.verify_token"] ?? "")
    const challenge = String(req.query["hub.challenge"] ?? "")
    if (mode === "subscribe" && env.whatsappVerifyToken && safeEqual(token, env.whatsappVerifyToken)) {
        res.status(200).type("text/plain").send(challenge)
        return
    }
    res.sendStatus(403)
})

// A later status never moves a message backwards (Meta can deliver "delivered" after "read").
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 }

const FRIENDLY_ERRORS: Record<number, string> = {
    131047: "More than 24 hours since this number last messaged you. WhatsApp only allows an approved template here.",
    131026: "This number can't receive the message (not on WhatsApp, or an old app version).",
    131049: "Meta held this message back to protect the person from too many business messages.",
    131030: "This number isn't on the test-numbers list of the Meta app yet.",
    130472: "This number is part of a Meta experiment and didn't receive the message.",
}

const applyStatus = async (status: any) => {
    const waMessageId = String(status?.id ?? "")
    if (!waMessageId) return
    await runAsPlatform(async () => {
        const item = await repos.messageItem.findone({ filter: { waMessageId } })
        if (!item) return
        const at = status.timestamp ? new Date(Number(status.timestamp) * 1000) : new Date()
        if (status.status === "failed") {
            const error = status.errors?.[0]
            const text = FRIENDLY_ERRORS[error?.code] ?? error?.error_data?.details ?? error?.title ?? "WhatsApp couldn't deliver this message"
            await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: { status: "failed", error: String(text).slice(0, 300) } } })
            return
        }
        if (!(status.status in RANK) || (RANK[status.status] ?? 0) <= (RANK[item.status] ?? 0)) return
        const set: any = { status: status.status }
        if (status.status === "delivered") set.deliveredAt = at
        if (status.status === "read") {
            set.readAt = at
            if (!item.deliveredAt) set.deliveredAt = at
        }
        await repos.messageItem.updateone({ filter: { _id: item._id }, data: { $set: set } })
    })
}

router.post("/", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (env.whatsappAppSecret) {
        const expected = "sha256=" + crypto.createHmac("sha256", env.whatsappAppSecret).update(raw).digest("hex")
        if (!safeEqual(String(req.headers["x-hub-signature-256"] ?? ""), expected)) {
            res.sendStatus(401)
            return
        }
    } else if (!env.isDev) {
        // Without the app secret anyone could fake delivery reports, so production refuses.
        res.sendStatus(503)
        return
    }
    // Answer at once: Meta retries anything slower than a few seconds.
    res.sendStatus(200)
    try {
        const payload = JSON.parse(raw.toString("utf8") || "{}")
        for (const entry of payload.entry ?? []) {
            for (const change of entry.changes ?? []) {
                for (const status of change.value?.statuses ?? []) await applyStatus(status)
            }
        }
    } catch (error: any) {
        console.warn(`[whatsapp webhook] ${error.message}`)
    }
})

export default router
