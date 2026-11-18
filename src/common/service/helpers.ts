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

export type PhoneCheck = { ok: boolean; international: string; reason: string }

// Whether a number can receive WhatsApp, and its international form ("201012345678").
// Fixes the usual slips: missing leading 0 (1012345678), +20 / 0020 prefixes, spaces and dashes,
// Arabic-Indic digits. Egyptian mobiles must be 010, 011, 012 or 015 followed by 8 digits.
export const checkPhone = (phone: unknown): PhoneCheck => {
    const western = String(phone ?? "")
        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    const digits = western.replace(/[^\d]/g, "").replace(/^00/, "")
    const fail = (reason: string): PhoneCheck => ({ ok: false, international: digits, reason })
    if (!digits) return fail("No phone number")
    let local = ""
    if (/^1\d{9}$/.test(digits)) local = `0${digits}`
    else if (/^0\d{10}$/.test(digits)) local = digits
    else if (/^20\d{10}$/.test(digits)) local = `0${digits.slice(2)}`
    else if (/^200\d{10}$/.test(digits)) local = digits.slice(2)
    if (local || digits.startsWith("0") || digits.startsWith("20")) {
        if (!local) return fail(`Wrong length: an Egyptian mobile has 11 digits (01xxxxxxxxx), this has ${digits.replace(/^20/, "0").length}`)
        if (!/^01[0125]\d{8}$/.test(local)) return fail("Egyptian mobiles start with 010, 011, 012 or 015")
        return { ok: true, international: `20${local.slice(1)}`, reason: "" }
    }
    // Another country, already written with its country code.
    if (digits.length >= 10 && digits.length <= 15) return { ok: true, international: digits, reason: "" }
    return fail("Too short to be a phone number")
}

export const whatsappNumber = (phone: unknown) => {
    const checked = checkPhone(phone)
    if (checked.ok) return checked.international
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
export const CENTER_PUBLIC_FIELDS = ["_id", "name", "kind", "phone", "localphone", "textlocation", "Maplocation", "createdAt"] as const

export const studentPublic = (student: any) => (student ? pick(student, STUDENT_FIELDS) : null)
export const studentRefOf = (student: any, id?: unknown) =>
    student ? pick(student, STUDENT_REF_FIELDS) : { _id: id, firstName: "Removed", lastName: "student" }
export const teacherPublic = (teacher: any) => (teacher ? pick(teacher, TEACHER_PUBLIC_FIELDS) : null)
export const centerPublic = (center: any) => (center ? pick(center, CENTER_PUBLIC_FIELDS) : null)
