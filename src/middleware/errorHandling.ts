import { NextFunction, Request, Response } from "express"
import { env } from "../config/env.service"

const clientError = (err: any) => {
    if (err?.code === 11000) {
        const field = Object.keys(err.keyPattern ?? {})[0]
        return { status: 409, message: field ? `This ${field} is already registered` : "This record already exists" }
    }
    if (err?.name === "CastError") return { status: 400, message: "Invalid identifier" }
    if (err?.name === "ValidationError") return { status: 400, message: (Object.values(err.errors)[0] as any)?.message ?? "Invalid data" }
    if (err?.type === "entity.parse.failed") return { status: 400, message: "Malformed JSON" }
    if (err?.type === "entity.too.large" || err?.code === "LIMIT_FILE_SIZE") return { status: 413, message: "That is too large" }
    return null
}

export const globalErrorHandling = (err: any, req: Request, res: Response, next: NextFunction) => {
    const known = clientError(err)
    const status = known?.status ?? err.status ?? 500
    if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err)
    const message = known?.message ?? (status >= 500 && !env.isDev ? "Something went wrong on our side." : err.message)
    return res.status(status).json({
        message,
        cause: status < 500 && err.cause && !Array.isArray(err.cause) ? err.cause : undefined,
        stack: env.isDev && status >= 500 ? err.stack : undefined,
    })
}
