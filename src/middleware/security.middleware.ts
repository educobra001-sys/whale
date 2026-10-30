import { NextFunction, Request, Response } from "express"
import { BadRequestError, TooManyRequestsError } from "../common/exceptions/error.exceptions"
import { redisService } from "../common/service/redisService"
import { env } from "../config/env.service"

const hasOperatorKey = (value: any, depth = 0): boolean => {
    if (depth > 12 || value === null || typeof value !== "object") return false
    if (Array.isArray(value)) return value.some((item) => hasOperatorKey(item, depth + 1))
    return Object.keys(value).some((key) => key.startsWith("$") || key === "__proto__" || key === "constructor" || hasOperatorKey(value[key], depth + 1))
}

// Blocks NoSQL operator injection and prototype pollution before anything reaches a service.
export const rejectOperators = (req: Request, res: Response, next: NextFunction) => {
    if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) throw new BadRequestError("Invalid request")
    next()
}

interface LimitOptions {
    name: string
    windowSeconds: number
    max: number
    key?: (req: any) => string
}

// Redis-backed, so the limit holds across every API process. Stays open if Redis is briefly unavailable.
export const rateLimit = ({ name, windowSeconds, max, key }: LimitOptions) => {
    return async (req: any, res: Response, next: NextFunction) => {
        if (env.rateLimitOff || !redisService.ready) return next()
        const id = key?.(req) ?? req.user?.id ?? req.ip
        let count = 0
        try {
            count = await redisService.hit(`rl:${name}:${id}`, windowSeconds)
        } catch {
            return next()
        }
        if (count > max) {
            res.setHeader("Retry-After", windowSeconds)
            throw new TooManyRequestsError()
        }
        next()
    }
}
