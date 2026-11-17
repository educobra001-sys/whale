import type { Request, Response } from "express"
import { createApp } from "./app.controller"
import { redisService } from "./common/service/redisService"
import { env, envProblems } from "./config/env.service"
import { dbconnection } from "./db/connection"
import { seedFeatures } from "./module/owner/plan.service"
import { ensureOwner } from "./scripts/createOwner"

// Vercel entry point (api/index.js). Connections are opened once per function instance and reused.
let ready: Promise<void> | null = null

const init = () => (ready ??= (async () => {
    for (const problem of envProblems().warn) console.warn(`[settings] ${problem}`)
    await redisService.connectRedis()
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
        res.status(503).json({ message: "The server is starting or can't reach the database. Try again in a moment." })
        return
    }
    app(req, res)
}
