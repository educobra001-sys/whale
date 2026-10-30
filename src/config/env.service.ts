import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true })

const read = (key: string, fallback = "") => process.env[key] ?? fallback
const number = (key: string, fallback: number) => {
    const raw = process.env[key]
    if (raw === undefined || raw === "") return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
}

const nodeEnv = read("NODE_ENV", "dev")

export const env = {
    nodeEnv,
    isDev: nodeEnv !== "production",
    port: number("PORT", 4000),
    server_IP: read("SERVER_IP", "127.0.0.1"),
    appName: read("APP_NAME", "EduCobra"),
    publicUrl: read("PUBLIC_URL", "http://127.0.0.1:4000"),
    runWorker: read("RUN_WORKER", "true") === "true",
    webConcurrency: number("WEB_CONCURRENCY", 0),
    dataBase_url: read("DATABASE_URL"),
    db_name: read("DB_NAME", "educobra"),
    redis_url: read("REDIS_URL"),
    access_secret: read("ACCESS_SECRET"),
    refresh_secret: read("REFRESH_SECRET"),
    salt: number("BCRYPT_ROUNDS", 11),
    ownerUserName: read("OWNER_USERNAME", "owner"),
    ownerEmail: read("OWNER_EMAIL"),
    ownerPassword: read("OWNER_PASSWORD"),
    smtpHost: read("SMTP_HOST"),
    smtpPort: number("SMTP_PORT", 587),
    smtpUser: read("SMTP_USER"),
    smtpPass: read("SMTP_PASS"),
    mailFrom: read("MAIL_FROM", "EduCobra <no-reply@educobra.local>"),
    corsOrigins: read("CORS_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean),
    uploadDir: read("UPLOAD_DIR", "uploads"),
    maxUploadMb: number("MAX_UPLOAD_MB", 25),
    // Tests send far more traffic from one address than any real client.
    rateLimitOff: nodeEnv !== "production" && read("RATE_LIMIT_OFF") === "true",
    telegramToken: read("TELEGRAM_BOT_TOKEN"),
    telegramBotUsername: read("TELEGRAM_BOT_USERNAME"),
}

if (!env.isDev && (env.access_secret.length < 32 || env.refresh_secret.length < 32)) {
    throw new Error("ACCESS_SECRET and REFRESH_SECRET must be long random values in production")
}
