import { createClient, RedisClientType } from "redis"
import { env } from "../../config/env.service"

export class RedisService {
    private client: RedisClientType

    constructor() {
        this.client = createClient({
            url: env.redis_url,
            socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
        })
        this.handlingConnection()
    }

    async connectRedis() {
        if (!this.client.isOpen) await this.client.connect()
    }

    async disconnect() {
        if (this.client.isOpen) await this.client.quit()
    }

    async clear() {
        await this.client.flushDb()
    }

    get ready() {
        return this.client.isReady
    }

    handlingConnection() {
        this.client.on("error", () => console.log("redis connection failed"))
        this.client.on("ready", () => console.log("redis connected successfully"))
    }

    async set({ key, value, ttl }: { key: string; value: any; ttl?: number }) {
        const text = typeof value === "object" ? JSON.stringify(value) : String(value)
        if (ttl) await this.client.set(key, text, { EX: ttl })
        else await this.client.set(key, text)
    }

    async get({ key }: { key: string }) {
        return (await this.client.get(key)) as string | null
    }

    async getJson<T = any>(key: string): Promise<T | null> {
        const text = await this.get({ key })
        return text ? (JSON.parse(text) as T) : null
    }

    async redis_delete({ key }: { key: string | string[] }) {
        return await this.client.del(key)
    }

    // Fixed-window counter, used by rate limits and failed-login tracking.
    async hit(key: string, windowSeconds: number) {
        const count = await this.client.incr(key)
        if (count === 1) await this.client.expire(key, windowSeconds)
        return count
    }

    async publish(channel: string, message: string) {
        await this.client.publish(channel, message)
    }

    // Reserves the next send time on a shared timeline, atomically across all processes.
    async reserveSlot(key: string, stepMs: number) {
        const script = "local now=tonumber(ARGV[1]) local step=tonumber(ARGV[2]) local nextAt=tonumber(redis.call('GET',KEYS[1]) or '0') if nextAt<now then nextAt=now end redis.call('SET',KEYS[1],nextAt+step,'EX',86400) return nextAt"
        return Number(await this.client.eval(script, { keys: [key], arguments: [String(Date.now()), String(stepMs)] }))
    }

    subscriber() {
        return this.client.duplicate()
    }

    // Cache-aside helper. Falls through to the loader when Redis is unavailable.
    async cached<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
        if (this.ready) {
            const hit = await this.getJson<T>(key).catch(() => null)
            if (hit !== null) return hit
        }
        const value = await loader()
        if (this.ready && value !== null && value !== undefined) await this.set({ key, value, ttl }).catch(() => undefined)
        return value
    }
}

export const redisService = new RedisService()
