import { z } from "zod"
import { dateText, money, objectId, optionalId, text } from "../../common/service/zodTypes"

const homeworkStatus = z.enum(["complete", "incomplete", "no_steps", "not_done"])

export const createSessionSchema = z.object({
    sequence: z.string().trim().min(1).max(160),
    week: z.coerce.number().int().min(1).max(60),
    number: z.coerce.number().int().min(1).max(999),
    date: dateText.optional(),
    center: optionalId,
    grade: z.string().max(4).optional(),
    price: z.union([money, z.null(), z.literal("")]).optional(),
})

export const updateSessionSchema = createSessionSchema.partial().extend({ status: z.enum(["normal", "cancelled"]).optional() })
export const setSessionActiveSchema = z.object({ active: z.boolean() })

export const markAttendanceSchema = z.object({
    identifier: z.string().trim().min(1).max(80),
    payment: money.optional(),
    comment: text(500).optional(),
    homeworkStatus: homeworkStatus.nullable().optional(),
    force: z.boolean().optional(),
})

export const updateAttendanceSchema = z.object({
    payment: money.optional(),
    comment: text(500).optional(),
    homeworkStatus: homeworkStatus.nullable().optional(),
})

export const homeworkCheckSchema = z.object({ identifier: z.string().trim().min(1).max(80), status: homeworkStatus })

export const closingSchema = z.object({
    normalCost: money.optional(),
    reducedCost: money.optional(),
    reducedCount: z.coerce.number().int().min(0).max(100000).optional(),
    notes: text(500).optional(),
})

export const staffCreateSchema = z.object({ assistant: objectId, checkIn: dateText.optional(), notes: text(500).optional() })
export const staffUpdateSchema = z.object({ checkIn: dateText.optional(), checkOut: dateText.optional(), notes: text(500).optional() })
