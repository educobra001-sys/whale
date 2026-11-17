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

// Links end up in href and src attributes. Escaping can't stop "javascript:" there, so only web links
// and our own uploaded files are accepted. Spaces are allowed because some storage folders contain them.
const SAFE_URL = /^(https?:\/\/[^\s"'<>`\\]+|\/files\/[\w.-]+)$/i
export const isSafeUrl = (value: string) => SAFE_URL.test(value.replace(/ /g, "%20"))
export const safeUrl = (max = 2048) => z.string().trim().max(max).refine((value) => value === "" || isSafeUrl(value), "Use a link that starts with https://")
export const requiredUrl = (max = 2048) => z.string().trim().min(1).max(max).refine(isSafeUrl, "Use a link that starts with https://")

// Names are shown to other people (leaderboards, messages, centers). HTML and control characters are refused.
export const UNSAFE_NAME = /[<>`\\\u0000-\u001f\u007f]/
export const safeName = (max = 80, min = 1) => z.string().trim().min(min).max(max).refine((value) => !UNSAFE_NAME.test(value), "This name contains characters that aren't allowed")
