import { z } from "zod"

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid identifier")
export const optionalId = z.union([objectId, z.literal(""), z.null()]).optional().transform((value) => value || null)
export const money = z.coerce.number().min(0).max(10_000_000)
export const signedMoney = z.coerce.number().min(-10_000_000).max(10_000_000)
export const text = (max = 500) => z.string().trim().max(max)
export const dateText = z.string().trim().max(40).refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date")
export const gradeText = z.union([z.enum(["0", "1", "2"]), z.literal("")]).optional()
export const params = (value: unknown, label = "record") => {
    if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) throw Object.assign(new Error(`Invalid ${label} id`), { status: 400 })
    return value
}
