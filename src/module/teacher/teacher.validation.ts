import { z } from "zod"
import { genders, grades, studyLanguages, subjects, teachingLanguages } from "../../common/enum/user.enum"
import { money, objectId, optionalId, signedMoney, text } from "../../common/service/zodTypes"

const phone = z.string().trim().min(6).max(32)

export const updateProfileSchema = z.object({
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    profilepic: text(2048).optional(),
    gender: z.enum(genders).optional(),
    companyName: text(120).optional(),
    subject: z.array(z.enum(subjects)).optional(),
    teachingLanguage: z.enum(teachingLanguages).optional(),
    bio: text(600).optional(),
    phone: phone.optional(),
    visibility: z.enum(["public", "private"]).optional(),
})

const studentFields = {
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    phone: phone.optional(),
    parentPhone: z.union([phone, z.literal("")]).optional(),
    gender: z.enum(genders).optional(),
    grade: z.union([z.enum(grades), z.literal("")]).optional(),
    schoolName: text(160).optional(),
    learningLanguage: z.union([z.enum(studyLanguages), z.literal("")]).optional(),
    profilepic: text(2048).optional(),
}

export const updateStudentSchema = z.object({
    ...studentFields,
    pricePerSession: z.union([money, z.null()]).optional(),
    center: optionalId,
    adminNote: text(1000).optional(),
    followUpAssistant: optionalId,
})

export const createStudentSchema = z.object({
    ...studentFields,
    firstName: z.string().trim().min(1).max(80),
    phone,
    pricePerSession: z.union([money, z.null()]).optional(),
    center: optionalId,
    balance: signedMoney.optional(),
    password: z.string().min(8).max(128).optional(),
})

export const linkStudentSchema = z.object({
    identifier: z.string().trim().min(1).max(40),
    center: optionalId,
    pricePerSession: z.union([money, z.null()]).optional(),
})

export const importStudentsSchema = z.object({ students: z.array(z.record(z.string(), z.any())).min(1).max(500) })
export const balanceSchema = z.object({ amount: signedMoney, reason: text(300).optional() })
export const pointsSchema = z.object({ points: z.coerce.number().int().min(-100000).max(100000), reason: text(300).optional() })
export const reasonSchema = z.object({ reason: text(300).optional() })
export const blockSchema = z.object({ blocked: z.boolean() })
export const requestAnswerSchema = z.object({ status: z.enum(["accepted", "rejected"]) })

export const assistantCreateSchema = z.object({
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    userName: z.string().trim().min(3).max(80),
    email: z.string().trim().toLowerCase().email().max(254),
    phone,
    password: z.string().min(8).max(128),
    role: z.enum(["Admin", "Assistant"]).optional(),
    permissions: z.array(text(40)).max(40).optional(),
})

export const assistantUpdateSchema = z.object({
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    phone: phone.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.enum(["Admin", "Assistant"]).optional(),
    permissions: z.array(text(40)).max(40).optional(),
    salary: z.object({ type: z.enum(["fixed", "hourly", "per_session"]), amount: money }).optional(),
})

export const answerLinkSchema = z.object({ status: z.enum(["active", "rejected"]) })
export const teacherLinkSchema = z.object({ userName: z.string().trim().min(1).max(80) })
export { objectId }
