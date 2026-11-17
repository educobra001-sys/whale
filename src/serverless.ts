import type { Request, Response } from "express"
import { createApp } from "./app.controller"
import { redisService } from "./common/service/redisService"
import { env, envProblems } from "./config/env.service"
import { dbconnection } from "./db/connection"
import { seedFeatures } from "./module/owner/plan.service"
import { ensureOwner } from "./scripts/createOwner"

// Vercel entry point (api/index.js). Connections are opened once per function instance and reused.
let ready: Promise<void> | null = null

// The Redis client retries forever, so give up after 10 seconds and say why.
const waitForRedis = async () => {
    redisService.connectRedis().catch(() => undefined)
    for (let waited = 0; waited < 10_000; waited += 200) {
        if (redisService.ready) return
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error(`Redis didn't connect in 10 seconds. Check REDIS_URL (it should start with rediss://). Last error: ${redisService.lastError ?? "no answer from the server"}`)
}

const init = () => (ready ??= (async () => {
    for (const problem of envProblems().warn) console.warn(`[settings] ${problem}`)
    await waitForRedis()
    await dbconnection()
    await seedFeatures()
    if (env.ownerEmail && env.ownerPassword && await ensureOwner()) console.log(`owner "${env.ownerUserName}" created`)
})().catch((error) => {
    ready = null
    throw error
}))

const app = createApp()

export default async function handler(req: Request, res: Response) {
    try {
        await init()
    } catch (error) {
        console.error(error)
        const reason = String((error as Error)?.message ?? error).replace(/\/\/[^/\s:@]+:[^@\s]+@/g, "//***:***@").slice(0, 600)
        let usedLink = ""
        try {
            const link = new URL(env.dataBase_url)
            usedLink = `user "${decodeURIComponent(link.username)}", password ${link.password.length} characters, cluster ${link.host}`
        } catch {
            usedLink = "DATABASE_URL isn't a valid link"
        }
        res.status(503).json({ message: "The server can't reach the database or Redis", reason, databaseLink: usedLink })
        return
    }
    app(req, res)
}
