export const pick = (source: any, fields: readonly string[]) =>
    Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]))

export const sameId = (a: unknown, b: unknown) => String(a) === String(b)
export const sum = <T>(items: T[], fn: (item: T) => unknown) => items.reduce((total, item) => total + (Number(fn(item)) || 0), 0)
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export const personName = (person: any) =>
    [person?.firstName, person?.lastName].filter(Boolean).join(" ") || person?.name || person?.userName || ""

// Egyptian numbers arrive as 010..., +2010..., 002010...: keep one canonical form.
export const normalizePhone = (phone: unknown) => {
    const digits = String(phone ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "")
    return digits.startsWith("20") && digits.length === 12 ? `0${digits.slice(2)}` : digits
}

export const whatsappNumber = (phone: unknown) => {
    const local = normalizePhone(phone)
    return local.startsWith("0") ? `20${local.slice(1)}` : local
}

// Arabic and English spelling variants of a name compare equal.
export const nameKey = (firstName: unknown, lastName: unknown) =>
    `${firstName ?? ""} ${lastName ?? ""}`
        .toLowerCase()
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/\s+/g, " ")
        .trim()

const CAIRO_MONTH = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" })

// Billing months follow Cairo time, as "2026-10".
export const monthKey = (date: Date = new Date()) => {
    const parts = CAIRO_MONTH.formatToParts(date)
    return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`
}

export const DAY = 86_400_000

export const inRangeFilter = (from?: unknown, to?: unknown) => {
    const range: any = {}
    if (from) range.$gte = new Date(String(from))
    if (to) range.$lte = new Date(new Date(String(to)).getTime() + DAY - 1)
    return Object.keys(range).length ? range : undefined
}

export const STUDENT_FIELDS = ["_id", "userID", "firstName", "lastName", "phone", "parentPhone", "gender", "grade", "schoolName", "learningLanguage", "profilepic", "createdAt"] as const
export const STUDENT_REF_FIELDS = ["_id", "userID", "firstName", "lastName", "phone", "parentPhone", "grade", "profilepic"] as const
export const STUDENT_REF_SELECT = "userID firstName lastName phone parentPhone grade profilepic"
export const TEACHER_PUBLIC_FIELDS = ["_id", "userName", "firstName", "lastName", "companyName", "subject", "teachingLanguage", "gender", "profilepic", "bio", "visibility", "createdAt"] as const
export const CENTER_PUBLIC_FIELDS = ["_id", "name", "phone", "localphone", "textlocation", "Maplocation", "createdAt"] as const

export const studentPublic = (student: any) => (student ? pick(student, STUDENT_FIELDS) : null)
export const studentRefOf = (student: any, id?: unknown) =>
    student ? pick(student, STUDENT_REF_FIELDS) : { _id: id, firstName: "Removed", lastName: "student" }
export const teacherPublic = (teacher: any) => (teacher ? pick(teacher, TEACHER_PUBLIC_FIELDS) : null)
export const centerPublic = (center: any) => (center ? pick(center, CENTER_PUBLIC_FIELDS) : null)
