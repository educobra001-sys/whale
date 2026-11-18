import type { NextFunction, Response } from "express"
import { NotFoundError } from "../exceptions/error.exceptions"
import { repos } from "../../db/repository"
import { redisService } from "./redisService"
import { runAsPlatform } from "./tenantContext"

// Sections the owner keeps hidden until they're ready to publish. Hidden sections disappear for teachers,
// assistants, students and parents (website and app), whatever a teacher's plan says.
// The owner switches them on again from Plans & sections.
export const DEFAULT_HIDDEN = ["lessons", "homework", "exams", "booklets", "leaderboard", "announcements"]

const KEY = "settings:sections"

export const hiddenSections = (): Promise<string[]> =>
    redisService.cached(KEY, 30, () => runAsPlatform(async () => {
        const row = await repos.setting.findone({ filter: { _id: "sections" } })
        return Array.isArray(row?.value?.hidden) ? row.value.hidden : DEFAULT_HIDDEN
    }))

export const setHiddenSections = async (hidden: string[]) => {
    const value = { hidden: [...new Set(hidden)] }
    await runAsPlatform(() => repos.setting.updateone({ filter: { _id: "sections" }, data: { $set: { value } }, options: { upsert: true } }))
    if (redisService.ready) await redisService.redis_delete({ key: KEY })
    return value.hidden
}

export const isHidden = async (key: string) => (await hiddenSections()).includes(key)

// For student routes, which don't go through a teacher's plan.
export const sectionOpen = (key: string) => async (req: any, res: Response, next: NextFunction) => {
    if (await isHidden(key)) throw new NotFoundError("This section isn't available yet")
    next()
}
