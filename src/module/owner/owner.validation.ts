import { z } from "zod"
import { dateText, money, objectId, text } from "../../common/service/zodTypes"

export const statusSchema = z.object({
    status: z.enum(["active", "rejected", "suspended"]),
    note: text(500).optional(),
})
export const featureSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: text(300).optional(),
    price: money.optional(),
})
export const planSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    features: z.array(text(40)).max(100),
})
export const channelsSchema = z.object({
    telegram: z.boolean().optional(),
    whatsapp_api: z.boolean().optional(),
    whatsapp_web: z.boolean().optional(),
    whatsapp_link: z.boolean().optional(),
})
export const affiliateSchema = z.object({
    code: z.union([z.string().trim().toUpperCase().regex(/^EC-[A-Z0-9]{8}$/, "Use an id like EC-ABCD2345"), z.literal("")]),
    ratePerStudent: money.optional(),
})
export const ruleSchema = z.object({
    name: z.string().trim().min(1).max(160),
    price: money,
    priority: z.coerce.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
    filters: z.object({
        grades: z.array(z.string()).max(10).optional(),
        centers: z.array(objectId).max(100).optional(),
        students: z.array(z.string().trim().toUpperCase()).max(5000).optional(),
        joinedAfter: z.union([dateText, z.literal("")]).optional(),
        joinedBefore: z.union([dateText, z.literal("")]).optional(),
    }).optional(),
})
export const createCenterSchema = z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(32),
    password: z.string().min(8).max(128),
    textlocation: text(300).optional(),
    localphone: text(32).optional(),
    Maplocation: text(1000).optional(),
})
export const adReviewSchema = z.object({ status: z.enum(["approved", "rejected"]), note: text(500).optional() })
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM") })
export const invoiceSchema = z.object({ status: z.enum(["open", "paid"]), note: text(300).optional() })
export const messagingSchema = z.object({
    delaySeconds: z.coerce.number().min(0).max(3600).optional(),
    maxChars: z.coerce.number().int().min(20).max(4096).optional(),
    whatsappApi: z.object({
        phoneNumberId: text(60).optional(),
        accessToken: text(1000).optional(),
        enabled: z.boolean().optional(),
    }).optional(),
})
