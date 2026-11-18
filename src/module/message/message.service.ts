import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { personName, sameId, whatsappNumber } from "../../common/service/helpers"
import { getMessagingSettings } from "../../common/service/settings"
import { runAsPlatform } from "../../common/service/tenantContext"
import { env } from "../../config/env.service"
import { repos } from "../../db/repository"
import { sessionLabel } from "../shared/views"
import sessionService from "../session/session.service"
import { waitUntil } from "@vercel/functions"
import { deliverNow } from "../../worker"
import { fastQueue } from "./message.queue"
import { telegramEnabled } from "./telegram.service"
import { kickStuckWhatsapp, kickWhatsapp, PLATFORM, senderFor } from "./whatsappWeb.service"

// Everything a message can mention, filled in per student. {key} in a message is replaced by the value.
export const VARIABLES = [
    { key: "student_name", label: "Student name", group: "Student" },
    { key: "first_name", label: "First name", group: "Student" },
    { key: "last_name", label: "Last name", group: "Student" },
    { key: "student_code", label: "Student code", group: "Student" },
    { key: "student_phone", label: "Student phone", group: "Student" },
    { key: "parent_phone", label: "Parent phone", group: "Student" },
    { key: "grade", label: "Grade", group: "Student" },
    { key: "school", label: "School", group: "Student" },
    { key: "gender", label: "Gender", group: "Student" },
    { key: "center", label: "Center", group: "Class" },
    { key: "balance", label: "Balance", group: "Class" },
    { key: "points", label: "Points", group: "Class" },
    { key: "joined", label: "Joined on", group: "Class" },
    { key: "teacher_name", label: "Teacher name", group: "Teacher" },
    { key: "teacher_phone", label: "Teacher phone", group: "Teacher" },
    { key: "subject", label: "Subject", group: "Teacher" },
    { key: "session", label: "Session", group: "Session" },
    { key: "date", label: "Session date", group: "Session" },
    { key: "arrival_time", label: "Arrival time", group: "Session" },
    { key: "payment", label: "Paid today", group: "Session" },
    { key: "homework", label: "Homework", group: "Session" },
    { key: "comment", label: "Comment", group: "Session" },
    { key: "today", label: "Today's date", group: "Other" },
]

export const MESSAGE_TYPES = ["attendance", "absence", "marketing"] as const

const DEFAULT_TEMPLATES: Record<string, string> = {
    attendance: "Hello, {student_name} attended {session} on {date}. Homework: {homework}. Balance: {balance} EGP.\n{teacher_name}",
    absence: "Hello, {student_name} missed {session} on {date}. Please follow up with us.\n{teacher_name}",
    marketing: "Hello {student_name} 👋\nNew sessions with {teacher_name} start soon. Call {teacher_phone} to book your place.",
}

const GRADE_LABELS: Record<string, string> = { "0": "S1", "1": "S2", "2": "S3" }
const HOMEWORK_LABELS: Record<string, string> = { complete: "complete", incomplete: "incomplete", no_steps: "no steps", not_done: "not done" }
const CHANNEL_FEATURE: Record<string, string> = { telegram: "telegram", whatsapp_api: "whatsapp", whatsapp_web: "whatsapp", whatsapp_link: "whatsapp" }
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram bot", whatsapp_api: "WhatsApp API", whatsapp_web: "WhatsApp (linked number)", whatsapp_link: "WhatsApp links" }

export const render = (template: string, values: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key] ?? "") : whole))

const day = (value: unknown) => (value ? new Date(value as any).toLocaleDateString("en-GB", { timeZone: "Africa/Cairo" }) : "")
const time = (value: unknown) => (value ? new Date(value as any).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }) : "")

type Recipient = "parent" | "student" | "both"
type Options = { owner?: boolean }

class MessageService {
    private async teacherOf(teacherId: string) {
        const teacher = await runAsPlatform(() => repos.teacher.findById({ id: teacherId }))
        if (!teacher) throw new NotFoundError("Teacher not found")
        return teacher
    }

    // The owner can use every channel for any teacher; a teacher only what the owner activated and the plan includes.
    private enabledChannels(teacher: any, options: Options = {}) {
        if (options.owner) return Object.keys(CHANNEL_LABEL)
        return Object.keys(CHANNEL_LABEL).filter((key) => teacher.channels?.[key] && teacher.features.includes(CHANNEL_FEATURE[key]))
    }

    async config(teacherId: string, options: Options = {}) {
        const [teacher, settings, saved, centers, sender, bot] = await Promise.all([
            this.teacherOf(teacherId),
            getMessagingSettings(),
            repos.template.findall({}),
            repos.enrollment.distinct("center", { status: "active", archived: false }),
            senderFor(teacherId),
            telegramEnabled(),
        ])
        const centerRows = await repos.center.findall({ filter: { _id: { $in: centers.filter(Boolean) } }, select: "name" })
        const template = (type: string) => saved.find((row) => row.type === type)?.body ?? DEFAULT_TEMPLATES[type]
        const senderRow: any = sender.linked ? await runAsPlatform(() => repos.whatsappAccount.findById({ id: sender.account, select: "phone" })) : null
        return {
            channels: this.enabledChannels(teacher, options).map((key) => ({ key, label: CHANNEL_LABEL[key] })),
            delaySeconds: settings.delaySeconds,
            maxChars: settings.maxChars,
            variables: VARIABLES,
            templates: Object.fromEntries(MESSAGE_TYPES.map((type) => [type, template(type)])),
            centers: centerRows.map((center) => ({ _id: center._id, name: center.name })),
            grades: Object.entries(GRADE_LABELS).map(([value, label]) => ({ value, label })),
            whatsapp: { linked: sender.linked, own: sender.account !== PLATFORM, phone: senderRow?.phone ?? "" },
            telegram: { ready: bot },
        }
    }

    async sessions() {
        const list = await repos.session.findall({ sort: { date: -1 }, limit: 150, select: "week number sequence date center" })
        return list.map((session) => ({ _id: session._id, label: sessionLabel(session), date: session.date }))
    }

    async saveTemplate(type: string, body: string) {
        await repos.template.updateone({ filter: { type }, data: { $set: { body } }, options: { upsert: true } })
        return { type, body }
    }

    private async templateFor(type: string) {
        return (await repos.template.findone({ filter: { type } }))?.body ?? DEFAULT_TEMPLATES[type] ?? ""
    }

    private async context(teacherId: string, sessionId?: string | null) {
        const teacher = await this.teacherOf(teacherId)
        const session = sessionId ? await repos.session.findById({ id: sessionId }) : null
        if (sessionId && !session) throw new NotFoundError("Session not found")
        return {
            session,
            teacherName: teacher.companyName || personName(teacher),
            teacherPhone: teacher.phone ?? "",
            subject: (teacher.subject ?? []).join(", "),
            sessionLabel: session ? sessionLabel(session) : "",
            date: session ? day(session.date) : "",
        }
    }

    private values(ctx: any, student: any, entry: any, row: any, centerName: string) {
        return {
            student_name: personName(student),
            first_name: student.firstName ?? "",
            last_name: student.lastName ?? "",
            student_code: student.userID ?? "",
            student_phone: student.phone ?? "",
            parent_phone: student.parentPhone ?? "",
            grade: GRADE_LABELS[student.grade] ?? "",
            school: student.schoolName ?? "",
            gender: student.gender ?? "",
            center: centerName,
            balance: entry?.balance ?? 0,
            points: entry?.points ?? 0,
            joined: day(entry?.joinedAt),
            teacher_name: ctx.teacherName,
            teacher_phone: ctx.teacherPhone,
            subject: ctx.subject,
            session: ctx.sessionLabel,
            date: ctx.date,
            arrival_time: time(row?.markedAt),
            payment: row?.payment ?? 0,
            homework: row ? (row.homeworkStatus ? HOMEWORK_LABELS[row.homeworkStatus] : "not checked") : "",
            comment: row?.comment ?? "",
            today: day(new Date()),
        }
    }

    // One row per person to message. "both" makes a row for the parent and one for the student.
    private async buildRows(ctx: any, template: string, recipient: Recipient, pairs: { student: any; entry: any; row?: any }[]) {
        const studentIds = pairs.map((pair) => pair.student._id)
        const centerIds = [...new Set(pairs.map((pair) => String(pair.entry?.center ?? "")).filter(Boolean))]
        const [centers, links] = await Promise.all([
            centerIds.length ? repos.center.findall({ filter: { _id: { $in: centerIds } }, select: "name" }) : Promise.resolve([]),
            runAsPlatform(() => repos.telegramLink.findall({ filter: { student: { $in: studentIds } }, select: "student kind" })),
        ])
        const rows: any[] = []
        for (const { student, entry, row } of pairs) {
            const centerName = centers.find((center) => sameId(center._id, entry?.center))?.name ?? ""
            const values = this.values(ctx, student, entry, row, centerName)
            const studentLinks = links.filter((link) => sameId(link.student, student._id))
            const telegram = { parent: studentLinks.some((link) => link.kind === "parent"), student: studentLinks.some((link) => link.kind === "student") }
            const targets: { recipient: "parent" | "student"; to: string }[] = []
            if (recipient !== "student") targets.push({ recipient: "parent", to: student.parentPhone || (recipient === "parent" ? student.phone : "") || "" })
            if (recipient !== "parent" && (recipient === "student" || student.phone !== student.parentPhone)) targets.push({ recipient: "student", to: student.phone || "" })
            for (const target of targets) {
                if (recipient === "both" && !target.to && !telegram[target.recipient]) continue
                rows.push({
                    student: student._id,
                    name: personName(student),
                    userID: student.userID,
                    phone: student.phone,
                    parentPhone: student.parentPhone,
                    recipient: target.recipient,
                    to: target.to,
                    telegram,
                    values,
                    body: render(template, values),
                })
            }
        }
        return rows
    }

    // Who gets the message: who attended or missed a session, every active student (optionally by grade or center),
    // or chosen students. Rows come back for review and editing before anything is sent.
    async preview(teacherId: string, body: any) {
        const { audience = body.type === "absence" ? "absent" : body.type === "attendance" ? "attended" : "all", type = "marketing", recipient = "parent" } = body
        const needsSession = audience === "attended" || audience === "absent"
        if (needsSession && !body.session) throw new BadRequestError("Choose a session")
        const ctx = await this.context(teacherId, body.session)
        const template = body.template ?? await this.templateFor(type)
        const attended = ctx.session ? await repos.attendance.findall({ filter: { session: ctx.session._id } }) : []
        const filter: any = { status: "active", archived: false }
        if (audience === "attended") filter.student = { $in: attended.map((row) => row.student) }
        if (audience === "absent") {
            filter.student = { $nin: attended.map((row) => row.student) }
            if (ctx.session?.center) filter.center = ctx.session.center
        }
        if (audience === "selected") filter.student = { $in: body.students ?? [] }
        if (body.center) filter.center = body.center === "none" ? null : body.center
        const entries = await repos.enrollment.findall({ filter })
        const studentFilter: any = { _id: { $in: entries.map((entry) => entry.student) } }
        if (body.grade) studentFilter.grade = body.grade
        const students = await repos.student.findall({ filter: studentFilter })
        const pairs = students
            .map((student) => ({
                student,
                entry: entries.find((entry) => sameId(entry.student, student._id)),
                row: attended.find((row) => sameId(row.student, student._id)),
            }))
            .sort((a, b) => personName(a.student).localeCompare(personName(b.student)))
        return {
            session: ctx.session ? { _id: ctx.session._id, label: ctx.sessionLabel } : null,
            type,
            audience,
            recipient,
            template,
            items: await this.buildRows(ctx, template, recipient, pairs),
        }
    }

    async previewOne(teacherId: string, body: any) {
        const ctx = await this.context(teacherId, body.session)
        const { student, entry } = await sessionService.findEnrolled(body.identifier)
        const row = ctx.session ? await repos.attendance.findone({ filter: { session: ctx.session._id, student: student._id } }) : null
        const template = body.template ?? await this.templateFor(body.type ?? "marketing")
        return this.buildRows(ctx, template, body.recipient ?? "parent", [{ student, entry, row }])
    }

    async send(teacherId: string, actorId: string, body: any, options: Options = {}) {
        const teacher = await this.teacherOf(teacherId)
        const { channel, type } = body
        if (!this.enabledChannels(teacher, options).includes(channel)) throw new ForbiddenError("This channel isn't activated for your account")
        const settings = await getMessagingSettings()
        const items = body.items.filter((item: any) => channel === "telegram" || String(item.to ?? "").trim())
        if (!items.length) throw new BadRequestError(channel === "telegram" ? "Add at least one student" : "None of the rows has a phone number")
        if (channel === "whatsapp_api") {
            const tooLong = items.find((item: any) => item.body.length > settings.maxChars)
            if (tooLong) throw new BadRequestError(`The message to ${tooLong.name} is ${tooLong.body.length} letters. The limit is ${settings.maxChars}.`)
        }
        if (channel === "telegram" && !(await telegramEnabled()) && !env.testMode) throw new BadRequestError("The Telegram bot isn't set up yet. Add its token on the owner's Messaging page.")

        // WhatsApp on a linked number: the teacher's own number if the owner linked one, otherwise the owner's.
        const sender = channel === "whatsapp_web" ? await senderFor(teacherId) : null
        if (sender && !sender.linked && !env.testMode) throw new BadRequestError("No WhatsApp number is linked yet. Link one with the QR code on the owner's Messaging page.")
        const simulated = Boolean(sender && !sender.linked)

        const batch = await repos.messageBatch.create({
            channel, type, session: body.session ?? null, total: items.length,
            delaySeconds: channel === "whatsapp_link" || channel === "whatsapp_web" ? settings.delaySeconds : 0,
            createdBy: actorId,
        })
        const rows = await repos.messageItem.insertMany(items.map((item: any) => ({
            batch: batch._id,
            student: item.student ?? null,
            name: item.name,
            to: String(item.to ?? "").trim(),
            body: item.body,
            channel,
            recipient: item.recipient ?? "parent",
            sender: sender?.account ?? PLATFORM,
            ...(simulated ? { status: "simulated", sentAt: new Date() } : {}),
        })))
        if (channel === "whatsapp_link") {
            return {
                batch: batch._id,
                delaySeconds: settings.delaySeconds,
                links: rows.map((row: any) => ({
                    _id: row._id, name: row.name,
                    url: `https://wa.me/${whatsappNumber(row.to)}?text=${encodeURIComponent(row.body)}`,
                })),
            }
        }
        if (channel === "whatsapp_web") {
            if (!simulated) kickWhatsapp(sender!.account)
            return { batch: batch._id, queued: rows.length, delaySeconds: batch.delaySeconds, simulated }
        }
        const jobs = rows.map((row: any) => ({ name: "send", data: { teacher: teacherId, item: String(row._id) } }))
        if (env.serverless) {
            // Keeps running after the reply is sent, so the screen doesn't wait for every message.
            waitUntil(deliverNow(jobs).catch((error) => console.error("[messages]", error)))
        } else {
            await fastQueue().addBulk(jobs)
        }
        return { batch: batch._id, queued: jobs.length, delaySeconds: batch.delaySeconds }
    }

    async reportLink(itemId: string, status: string) {
        const item = await repos.messageItem.findOneAndUpdate({ filter: { _id: itemId, channel: "whatsapp_link" }, data: { $set: { status, sentAt: new Date() } } })
        if (!item) throw new NotFoundError("Message not found")
        return { _id: item._id, status: item.status }
    }

    // Someone looking at the history is also the moment to restart a WhatsApp batch that stopped.
    private restartIfWaiting(counts: any[], batches: any[]) {
        const waiting = counts.some((row) => row._id.status === "queued" && batches.find((batch) => sameId(batch._id, row._id.batch))?.channel === "whatsapp_web")
        if (waiting) void kickStuckWhatsapp().catch(() => undefined)
    }

    async batches() {
        const list = await repos.messageBatch.findall({ sort: { createdAt: -1 }, limit: 50 })
        const counts = await repos.messageItem.aggregate([
            { $match: { batch: { $in: list.map((batch) => batch._id) } } },
            { $group: { _id: { batch: "$batch", status: "$status" }, count: { $sum: 1 } } },
        ])
        this.restartIfWaiting(counts, list)
        const sessions = await repos.session.findall({ filter: { _id: { $in: list.map((batch) => batch.session).filter(Boolean) } } })
        return list.map((batch) => ({
            ...batch,
            channelLabel: CHANNEL_LABEL[batch.channel],
            sessionLabel: batch.session ? sessionLabel(sessions.find((item) => sameId(item._id, batch.session))) : "",
            counts: Object.fromEntries(counts.filter((row) => sameId(row._id.batch, batch._id)).map((row) => [row._id.status, row.count])),
        }))
    }

    async batchItems(batchId: string) {
        const batch = await repos.messageBatch.findById({ id: batchId })
        if (!batch) throw new NotFoundError("Batch not found")
        const items = await repos.messageItem.findall({ filter: { batch: batchId } })
        if (batch.channel === "whatsapp_web" && items.some((item) => item.status === "queued")) void kickStuckWhatsapp().catch(() => undefined)
        return { batch, items }
    }
}

export default new MessageService()
