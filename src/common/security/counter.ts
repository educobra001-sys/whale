import { redisService } from "../service/redisService"

// Fixed-window counters for rate limits and failed logins. Redis keeps them shared across every API
// process; if Redis is down they fall back to this process's memory, so protection never switches off.
const memory = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memory) if (entry.resetAt <= now) memory.delete(key)
}, 5 * 60 * 1000).unref()

const memoryHit = (key: string, windowSeconds: number) => {
    const now = Date.now()
    const entry = memory.get(key)
    if (!entry || entry.resetAt <= now) {
        memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
        return 1
    }
    entry.count += 1
    return entry.count
}

export const hitCounter = async (key: string, windowSeconds: number) => {
    if (redisService.ready) {
        try {
            return await redisService.hit(key, windowSeconds)
        } catch {
            /* fall back to memory */
        }
    }
    return memoryHit(key, windowSeconds)
}

// The current count and the seconds left in its window.
export const readCounter = async (key: string): Promise<{ count: number; secondsLeft: number }> => {
    if (redisService.ready) {
        try {
            const [value, ttl] = await Promise.all([redisService.get({ key }), redisService.ttl(key)])
            return { count: Number(value) || 0, secondsLeft: Math.max(0, ttl) }
        } catch {
            /* fall back to memory */
        }
    }
    const entry = memory.get(key)
    if (!entry || entry.resetAt <= Date.now()) return { count: 0, secondsLeft: 0 }
    return { count: entry.count, secondsLeft: Math.ceil((entry.resetAt - Date.now()) / 1000) }
}

export const clearCounters = async (keys: string[]) => {
    for (const key of keys) memory.delete(key)
    if (redisService.ready) await redisService.redis_delete({ key: keys }).catch(() => undefined)
}
