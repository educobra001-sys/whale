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
    // How many proxies sit in front of the server: 1 for one host (Render alone), 2 when Vercel forwards to Render.
    trustProxy: number("TRUST_PROXY", 1),
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
    // A test deployment has no email yet, so codes stay on screen and unconfigured channels are simulated.
    testMode: nodeEnv !== "production" || read("TEST_MODE") === "true",
    cloudinaryCloud: read("CLOUDINARY_CLOUD_NAME"),
    cloudinaryKey: read("CLOUDINARY_API_KEY"),
    cloudinarySecret: read("CLOUDINARY_API_SECRET"),
    cloudinaryFolder: read("CLOUDINARY_FOLDER", "educobra"),
    telegramToken: read("TELEGRAM_BOT_TOKEN"),
    telegramBotUsername: read("TELEGRAM_BOT_USERNAME"),
    // WhatsApp Cloud API webhook: the verify token you type in Meta's dashboard, and the app secret Meta signs with.
    whatsappVerifyToken: read("WHATSAPP_VERIFY_TOKEN"),
    whatsappAppSecret: read("WHATSAPP_APP_SECRET"),
    backupDir: read("BACKUP_DIR", "backups"),
    backupKeep: number("BACKUP_KEEP", 14),
    backupDaily: read("BACKUP_DAILY", "false") === "true",
}

const PLACEHOLDERS = /^(change-me.*|secret|password|123456.*|)$/i

// Settings that are unsafe to run with. In production the dangerous ones stop the server from starting.
export const envProblems = () => {
    const fatal: string[] = []
    const warn: string[] = []
    const weakSecret = (value: string) => value.length < 32 || PLACEHOLDERS.test(value)
    if (weakSecret(env.access_secret) || weakSecret(env.refresh_secret)) {
        (env.isDev ? warn : fatal).push("ACCESS_SECRET and REFRESH_SECRET must be long random values")
    }
    if (env.access_secret && env.access_secret === env.refresh_secret) (env.isDev ? warn : fatal).push("ACCESS_SECRET and REFRESH_SECRET must be different")
    if (env.ownerPassword && (env.ownerPassword.length < 10 || PLACEHOLDERS.test(env.ownerPassword))) {
        (env.isDev ? warn : fatal).push("OWNER_PASSWORD is a placeholder or shorter than 10 characters")
    }
    if (!env.isDev && env.testMode) warn.push("TEST_MODE is on: verification codes are shown on screen")
    if (!env.isDev && env.whatsappVerifyToken && !env.whatsappAppSecret) warn.push("WHATSAPP_APP_SECRET is empty: WhatsApp webhook calls will be refused")
    if (!env.isDev && !env.corsOrigins.length) warn.push("CORS_ORIGINS is empty: browsers on other sites can't use the API")
    return { fatal, warn }
}

const startup = envProblems()
if (startup.fatal.length) throw new Error(`Unsafe settings in .env:\n- ${startup.fatal.join("\n- ")}`)
