import compression from "compression"
import cors from "cors"
import express, { Express } from "express"
import helmet from "helmet"
import path from "node:path"
import { successResponce } from "./common/exceptions/successresponce"
import { redisService } from "./common/service/redisService"
import { uploadRoot } from "./common/service/upload"
import { env } from "./config/env.service"
import { dbconnection } from "./db/connection"
import { globalErrorHandling } from "./middleware/errorHandling"
import { rateLimit, rejectOperators } from "./middleware/security.middleware"
import AssistantRouter from "./module/assistant/assistant.controller"
import AuthRouter from "./module/auth/aurh.controller"
import CenterRouter from "./module/center/center.controller"
import DirectoryRouter from "./module/directory/directory.controller"
import MeRouter from "./module/me/me.controller"
import OwnerRouter from "./module/owner/owner.controller"
import ParentRouter from "./module/parent/parent.controller"
import StudentRouter from "./module/student/student.controller"
import TeacherRouter from "./module/teacher/teacher.router"
import { seedFeatures } from "./module/owner/plan.service"
import { startWorkers } from "./worker"

export const createApp = (): Express => {
    const app: Express = express()
    app.disable("x-powered-by")
    app.set("trust proxy", 1)
    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "script-src": ["'self'", "https://cdn.jsdelivr.net"],
                "img-src": ["'self'", "data:", "blob:", "https:"],
                "media-src": ["'self'", "https:", "blob:"],
                "frame-src": ["https://www.youtube.com", "https://player.vimeo.com", "https://drive.google.com"],
                "upgrade-insecure-requests": null,
            },
        },
        crossOriginResourcePolicy: { policy: "same-site" },
        strictTransportSecurity: !env.isDev,
    }))
    app.use(compression())
    app.use(cors({
        origin: env.corsOrigins.length ? env.corsOrigins : env.isDev,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    }))
    app.use(rateLimit({ name: "ip", windowSeconds: 60, max: 3000 }))
    app.use(express.json({ limit: "2mb" }))
    app.use(rejectOperators)

    app.get("/check-health", (req, res) => {
        successResponce({ res, message: "healthy", data: { redis: redisService.ready } })
    })

    app.use("/files", express.static(uploadRoot, { index: false, dotfiles: "deny", maxAge: "30d", immutable: true }))
    app.use("/vendor/qrcode", express.static(path.resolve(__dirname, "../node_modules/qrcode-generator/dist")))
    app.use("/vendor", express.static(path.resolve(__dirname, "../node_modules/jsqr/dist")))

    app.use(AuthRouter)
    app.use(DirectoryRouter)
    app.use("/teacher", TeacherRouter)
    app.use("/assistant", AssistantRouter)
    app.use("/center", CenterRouter)
    app.use("/student", StudentRouter)
    app.use("/parent", ParentRouter)
    app.use("/owner", OwnerRouter)
    app.use("/me", MeRouter)

    app.use(express.static(path.resolve(__dirname, "../front-end"), { maxAge: env.isDev ? 0 : "1h" }))
    app.use((req, res) => {
        res.status(404).json({ message: "Not found" })
    })
    app.use(globalErrorHandling)
    return app
}

export const bootstrap = async ({ worker = env.runWorker } = {}) => {
    await redisService.connectRedis()
    await dbconnection()
    await seedFeatures()
    const app = createApp()
    if (worker) await startWorkers()
    const server = app.listen(env.port, () => {
        console.log(`server is running on http://${env.server_IP}:${env.port}`)
    })
    server.keepAliveTimeout = 65_000
    server.headersTimeout = 66_000
    server.requestTimeout = 60_000
    return server
}
