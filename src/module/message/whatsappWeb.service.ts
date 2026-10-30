import path from "node:path"
import QRCode from "qrcode"
import { redisService } from "../../common/service/redisService"
import { whatsappNumber } from "../../common/service/helpers"

// Linking WhatsApp Web keeps a live socket, which must exist in exactly one process: the worker.
// The admin page talks to it through Redis, so this works when the API runs on many processes.
const STATE_KEY = "wa:state"
const COMMAND_CHANNEL = "wa:command"
const AUTH_DIR = path.resolve(__dirname, "../../../.data/whatsapp")

export type WhatsappState = { status: "disconnected" | "connecting" | "qr" | "connected"; qr?: string; phone?: string; error?: string; workerOnline?: boolean }

const silentLogger: any = { level: "silent", child: () => silentLogger, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} }

let socket: any = null
let wantConnected = false

const setState = (state: WhatsappState) => redisService.set({ key: STATE_KEY, value: state, ttl: 86400 })

export const whatsappState = async (): Promise<WhatsappState> =>
    (await redisService.getJson<WhatsappState>(STATE_KEY)) ?? { status: "disconnected" }

export const requestWhatsapp = async (command: "connect" | "logout") => {
    await redisService.publish(COMMAND_CHANNEL, command)
    await new Promise((resolve) => setTimeout(resolve, 300))
}

const connect = async () => {
    wantConnected = true
    if (socket) return
    await setState({ status: "connecting" })
    try {
        const baileys: any = await import("baileys")
        const { state, saveCreds } = await baileys.useMultiFileAuthState(AUTH_DIR)
        const sock = baileys.default({ auth: state, logger: silentLogger, printQRInTerminal: false, browser: ["EduCobra", "Chrome", "1.0"], syncFullHistory: false })
        socket = sock
        sock.ev.on("creds.update", saveCreds)
        sock.ev.on("connection.update", async (update: any) => {
            if (update.qr) {
                await setState({ status: "qr", qr: await QRCode.toDataURL(update.qr, { margin: 1, width: 320 }) })
            }
            if (update.connection === "open") {
                await setState({ status: "connected", phone: String(sock.user?.id ?? "").split(/[:@]/)[0] })
            }
            if (update.connection === "close") {
                socket = null
                const code = update.lastDisconnect?.error?.output?.statusCode
                if (code === baileys.DisconnectReason.loggedOut) {
                    wantConnected = false
                    await setState({ status: "disconnected" })
                } else if (wantConnected) {
                    await setState({ status: "connecting" })
                    setTimeout(() => void connect(), 3000)
                } else {
                    await setState({ status: "disconnected" })
                }
            }
        })
    } catch (error: any) {
        socket = null
        await setState({ status: "disconnected", error: error.message })
    }
}

const logout = async () => {
    wantConnected = false
    const current = socket
    socket = null
    await current?.logout().catch(() => undefined)
    current?.end?.(undefined)
    await setState({ status: "disconnected" })
}

export const whatsappConnected = () => Boolean(socket?.user)

export const sendWhatsappWeb = async (phone: string, text: string) => {
    if (!whatsappConnected()) throw new Error("WhatsApp isn't linked on the server")
    await socket.sendMessage(`${whatsappNumber(phone)}@s.whatsapp.net`, { text })
}

export const startWhatsappListener = async () => {
    const subscriber = redisService.subscriber()
    subscriber.on("error", () => undefined)
    await subscriber.connect()
    await subscriber.subscribe(COMMAND_CHANNEL, (command: string) => {
        if (command === "connect") void connect()
        if (command === "logout") void logout()
    })
    const previous = await whatsappState()
    if (previous.status === "connected" || previous.status === "connecting") void connect()
    else await setState({ status: "disconnected" })
}
