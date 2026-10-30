import { z } from "zod"
import { genders, grades, studyLanguages, subjects, teachingLanguages } from "../../common/enum/user.enum"

const password = z.string().min(8, "Use at least 8 characters").max(128)
const phone = z.string().trim().min(6).max(32)
const name = z.string().trim().min(1).max(80)

export const teacherSignupSchema = z.object({
    firstName: name,
    lastName: name.optional(),
    userName: z.string().trim().min(3).max(80).regex(/^[\w.-]+$/, "Letters, numbers, dots and dashes only"),
    email: z.string().trim().toLowerCase().email().max(254),
    phone,
    companyName: z.string().trim().min(1).max(120).optional(),
    subject: z.array(z.enum(subjects)).max(7).optional(),
    teachingLanguage: z.enum(teachingLanguages).optional(),
    password,
})

export const studentSignupSchema = z.object({
    firstName: name,
    lastName: name,
    phone,
    parentPhone: phone,
    grade: z.enum(grades),
    schoolName: z.string().trim().max(160).optional(),
    learningLanguage: z.enum(studyLanguages).optional(),
    gender: z.enum(genders).optional(),
    password,
})

export const centerSignupSchema = z.object({
    name: z.string().trim().min(2).max(120),
    phone,
    localphone: z.string().trim().max(32).optional(),
    textlocation: z.string().trim().max(300).optional(),
    Maplocation: z.string().trim().max(1000).optional(),
    password,
})

export const parentSignupSchema = z.object({
    name: z.string().trim().min(2).max(120),
    phone,
    childCode: z.string().trim().min(1).max(32),
    password,
})

export const loginSchema = z.object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(128),
})

export const verifySchema = z.object({
    identifier: z.string().trim().min(1).max(254),
    otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
})

export const identifierSchema = z.object({ identifier: z.string().trim().min(1).max(254) })
export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1).max(4096) })
export const resetPasswordSchema = verifySchema.extend({ password })
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password })
