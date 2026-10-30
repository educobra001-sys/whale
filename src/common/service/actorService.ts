import { roleEnum } from "../enum/user.enum"
import { repos } from "../../db/repository"
import { redisService } from "./redisService"
import { runAsPlatform } from "./tenantContext"

export interface Actor {
    id: string
    role: roleEnum
    tv: number
    status?: string
    teacherId?: string
    assistantRole?: string
    permissions?: string[]
    features?: string[]
}

const repoFor: Record<string, any> = {
    owner: repos.owner, teacher: repos.teacher, assistant: repos.assistant,
    center: repos.center, student: repos.student, parent: repos.parent,
}

const load = (role: roleEnum, id: string) => runAsPlatform(async (): Promise<Actor | null> => {
    const account = await repoFor[role].findById({ id })
    if (!account) return null
    const actor: Actor = { id, role, tv: account.tokenVersion ?? 0 }
    if (role === roleEnum.Teacher) {
        actor.status = account.status
        actor.teacherId = id
        actor.features = account.features
    }
    if (role === roleEnum.Center) actor.status = account.status
    if (role === roleEnum.Assistant) {
        const teacher = await repos.teacher.findById({ id: account.teacher, select: "status features" })
        actor.status = teacher?.status
        actor.teacherId = String(account.teacher)
        actor.features = teacher?.features ?? []
        actor.assistantRole = account.role
        actor.permissions = account.permissions
    }
    return actor
})

const cacheKey = (role: string, id: string) => `actor:${role}:${id}`

// Account state checked on every request, cached briefly so a request doesn't always cost a database read.
export const getActor = (role: roleEnum, id: string) => redisService.cached(cacheKey(role, id), 30, () => load(role, id))

export const forgetActor = async (role: string, id: string) => {
    if (redisService.ready) await redisService.redis_delete({ key: cacheKey(role, id) }).catch(() => undefined)
}

export const forgetTeacherTeam = async (teacherId: string) => {
    await forgetActor("teacher", teacherId)
    const team = await runAsPlatform(() => repos.assistant.findall({ filter: { teacher: teacherId }, select: "_id" }))
    await Promise.all(team.map((member) => forgetActor("assistant", String(member._id))))
}
