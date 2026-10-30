import { NextFunction, Request, Response } from "express"
import { Actor, getActor } from "../common/service/actorService"
import { ForbiddenError, UnauthorizedError } from "../common/exceptions/error.exceptions"
import { roleEnum } from "../common/enum/user.enum"
import { runAsPlatform, runWithTeacher } from "../common/service/tenantContext"
import { TokenService } from "../common/service/token"

const tokenService = new TokenService()

export interface userRequest extends Request {
    user?: any
    actor?: Actor
    teacherId?: string
}

const bearer = (req: Request) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ")
    return scheme === "Bearer" && token ? token : ""
}

const authenticate = async (token: string) => {
    const data = tokenService.decodeToken(token)
    const actor = await getActor(data.role, data.id)
    if (!actor || actor.tv !== data.tv) throw new UnauthorizedError()
    return actor
}

export const auth = async (req: userRequest, res: Response, next: NextFunction) => {
    const token = bearer(req)
    if (!token) throw new UnauthorizedError("Please sign in first.")
    const actor = await authenticate(token)
    req.actor = actor
    req.user = { id: actor.id, role: actor.role }
    next()
}

// For public pages that show a little more to signed-in users.
export const optionalAuth = async (req: userRequest, res: Response, next: NextFunction) => {
    const token = bearer(req)
    if (!token) return next()
    try {
        const actor = await authenticate(token)
        req.actor = actor
        req.user = { id: actor.id, role: actor.role }
    } catch {
        /* treated as anonymous */
    }
    next()
}

export const requireRole = (...roles: roleEnum[]) => (req: userRequest, res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role)) throw new ForbiddenError()
    next()
}

// Teacher and assistant routes: sets the tenant for the whole request.
export const teacherScope = (req: userRequest, res: Response, next: NextFunction) => {
    const actor = req.actor
    if (!actor?.teacherId) throw new ForbiddenError("Only teachers and assistants can do that")
    if (actor.status !== "active") throw new ForbiddenError("This teaching account is not active.", { code: "NOT_ACTIVE" })
    req.teacherId = actor.teacherId
    runWithTeacher(actor.teacherId, next)
}

// Owner, center, student and parent routes run on the platform scope and filter explicitly.
export const platformScope = (req: userRequest, res: Response, next: NextFunction) => {
    runAsPlatform(next)
}

export const activeCenter = (req: userRequest, res: Response, next: NextFunction) => {
    if (req.actor?.status !== "active") throw new ForbiddenError("This center is not active.", { code: "NOT_ACTIVE" })
    next()
}

const isTeacher = (actor?: Actor) => actor?.role === roleEnum.Teacher

// Assistants need one of the permissions. "Admin" assistants have every teaching permission.
export const can = (...permissions: string[]) => (req: userRequest, res: Response, next: NextFunction) => {
    const actor = req.actor
    if (isTeacher(actor) || actor?.assistantRole === "Admin") return next()
    if (permissions.some((permission) => actor?.permissions?.includes(permission))) return next()
    throw new ForbiddenError("Your teacher hasn't given your account access to this.")
}

export const teacherOnly = (req: userRequest, res: Response, next: NextFunction) => {
    if (!isTeacher(req.actor)) throw new ForbiddenError("Only the teacher can do that")
    next()
}

// The owner decides which sections each teacher bought. Anything else is closed, for the whole team.
export const requireFeature = (...keys: string[]) => (req: userRequest, res: Response, next: NextFunction) => {
    const owned = req.actor?.features ?? []
    if (keys.some((key) => owned.includes(key))) return next()
    throw new ForbiddenError("This section isn't included in your plan.", { code: "FEATURE_LOCKED", feature: keys[0] })
}
