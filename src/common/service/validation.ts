import { NextFunction, Request, Response } from "express"
import { ZodType } from "zod"
import { BadRequestError } from "../exceptions/error.exceptions"

// Parses req.body with the schema and replaces it with the parsed value, so services only see whitelisted fields.
export const validation = (schema: ZodType) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body ?? {})
        if (!result.success) {
            const first = result.error.issues[0]
            const where = first?.path.length ? `${first.path.join(".")}: ` : ""
            throw new BadRequestError(`${where}${first?.message ?? "Invalid data"}`, result.error.issues)
        }
        req.body = result.data
        next()
    }
}
