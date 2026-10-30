import { repos } from "../../db/repository"
import { monthKey } from "./helpers"
import { redisService } from "./redisService"

// Marks a student active for the billing month: attended, recharged or bought something.
// The Redis marker means only the first event of the month costs a database write.
export const markActive = async (teacherId: string, studentId: unknown, reason: string) => {
    const month = monthKey()
    const marker = `active:${month}:${teacherId}:${studentId}`
    if (redisService.ready) {
        const known = await redisService.get({ key: marker }).catch(() => null)
        if (known) return
    }
    try {
        await repos.monthlyActive.updateone({
            filter: { teacher: teacherId, student: studentId, month },
            data: { $setOnInsert: { reason, at: new Date() } },
            options: { upsert: true },
        })
    } catch (error: any) {
        if (error?.code !== 11000) throw error
    }
    if (redisService.ready) await redisService.set({ key: marker, value: "1", ttl: 40 * 86400 }).catch(() => undefined)
}
