import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { personName, sameId, whatsappNumber } from "../../common/service/helpers"
import { redisService } from "../../common/service/redisService"
import { getMessagingSettings } from "../../common/service/settings"
import { runAsPlatform } from "../../common/service/tenantContext"
import { repos } from "../../db/repository"
import { sessionLabel } from "../shared/views"
import sessionService from "../session/session.service"
import { fastQueue, webQueue } from "./message.queue"

export const VARIABLES = [
    { key: "student_name", label: "Student name" },
    { key: "student_code", label: "Student code" },
    { key: "teacher_name", label: "Teacher name" },
    { key: "session", label: "Session" },
    { key: "date", label: "Date" },
    { key: "center", label: "Center" },
    { key: "balance", label: "Balance" },
    { key: "payment", label: "Paid today" },
    { key: "homework", label: "Homework" },
]

const DEFAULT_TEMPLATES: Record<string, string> = {
    attendance: "Hello, {student_name} attended {session} on {date}. Homework: {homework}. Balance: {balance} EGP.\n{teacher_name}",
    absence: "Hello, {student_name} missed {session} on {date}. Please follow up with us.\n{teacher_name}",
}

const HOMEWORK_LABELS: Record<string, string> = { complete: "complete", incomplete: "incomplete", no_steps: "no steps", not_done: "not done" }
const CHANNEL_FEATURE: Record<string, string> = { telegram: "telegram", whatsapp_api: "whatsapp", whatsapp_web: "whatsapp", whatsapp_link: "whatsapp" }
const CHANNEL_LABEL: Record<string, string> = { telegram: "Telegram bot", whatsapp_api: "WhatsApp API", whatsapp_web: "WhatsApp (server)", whatsapp_link: "WhatsApp links" }

const render = (template: string, values: Record<string, unknown>) =>
    template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key] ?? "") : whole))

class MessageService {
    private async teacherOf(teacherId: string) {
        return runAsPlatform(() => repos.teacher.findById({ id: teacherId }))
    }

    private enabledChannels(teacher: any) {
        return Object.keys(CHANNEL_LABEL).filter((key) => teacher.channels?.[key] && teacher.features.includes(CHANNEL_FEATURE[key]))
    }

    async config(teacherId: string) {
        const [teacher, settings, saved] = await Promise.all([this.teacherOf(teacherId), getMessagingSettings(), repos.template.findall({})])
        const template = (type: string) => saved.find((row) => row.type === type)?.body ?? DEFAULT_TEMPLATES[type]
        return {
            channels: this.enabledChannels(teacher).map((key) => ({ key, label: CHANNEL_LABEL[key] })),
            delaySeconds: settings.delaySeconds,
            maxChars: settings.maxChars,
            variables: VARIABLES,
            templates: { attendance: template("attendance"), absence: template("absence") },
        }
    }

    async saveTemplate(type: string, body: string) {
        await repos.template.updateone({ filter: { type }, data: { $set: { body } }, options: { upsert: true } })
        return { type, body }
    }

    private async templateFor(type: string) {
        return (await repos.template.findone({ filter: { type } }))?.body ?? DEFAULT_TEMPLATES[type]!
    }

    private buildRow(template: string, ctx: any, student: any, entry: any, row: any) {
        const name = personName(student)
        return {
            student: student._id,
            name,
            userID: student.userID,
            phone: student.phone,
            parentPhone: student.parentPhone,
            to: student.parentPhone || student.phone,
            body: render(template, {
                student_name: name,
                student_code: student.userID,
                teacher_name: ctx.teacherName,
                session: ctx.sessionLabel,
                date: ctx.date,
                center: ctx.center,
                balance: entry.balance,
                payment: row?.payment ?? 0,
                homework: row?.homeworkStatus ? HOMEWORK_LABELS[row.homeworkStatus] : "not checked",
            }),
        }
    }

    private async context(teacherId: string, sessionId: string) {
        const session = await repos.session.findById({ id: sessionId })
        if (!session) throw new NotFoundError("Session not found")
        const [teacher, center] = await Promise.all([
            this.teacherOf(teacherId),
            session.center ? repos.center.findById({ id: session.center, select: "name" }) : Promise.resolve(null),
        ])
        return {
            session,
            teacherName: teacher.companyName || personName(teacher),
            sessionLabel: sessionLabel(session),
            date: new Date(session.date).toLocaleDateString("en-GB"),
            center: center?.name ?? "",
        }
    }

    // One row per student, ready for the teacher to review, edit, remove or add to before sending.
    async preview(teacherId: string, { session: sessionId, type }: any) {
        const ctx = await this.context(teacherId, sessionId)
        const template = await this.templateFor(type)
        const attended = await repos.attendance.findall({ filter: { session: sessionId } })
        const filter: any = { status: "active", archived: false }
        if (type === "attendance") filter.student = { $in: attended.map((row) => row.student) }
        else {
            filter.student = { $nin: attended.map((row) => row.student) }
            if (ctx.session.center) filter.center = ctx.session.center
        }
        const entries = await repos.enrollment.findall({ filter })
        const students = await repos.student.findall({ filter: { _id: { $in: entries.map((entry) => entry.student) } } })
        return {
            session: { _id: ctx.session._id, label: ctx.sessionLabel },
            type,
            items: entries
                .map((entry) => {
                    const student = students.find((item) => sameId(item._id, entry.student))
                    return student ? this.buildRow(template, ctx, student, entry, attended.find((row) => sameId(row.student, entry.student))) : null
                })
                .filter(Boolean),
        }
    }

    async previewOne(teacherId: string, { session: sessionId, type, identifier }: any) {
        const ctx = await this.context(teacherId, sessionId)
        const { student, entry } = await sessionService.findEnrolled(identifier)
        const row = await repos.attendance.findone({ filter: { session: sessionId, student: student._id } })
        return this.buildRow(await this.templateFor(type), ctx, student, entry, row)
    }

    async send(teacherId: string, actorId: string, body: any) {
        const teacher = await this.teacherOf(teacherId)
        const { channel, type, items } = body
        if (!this.enabledChannels(teacher).includes(channel)) throw new ForbiddenError("This channel isn't activated for your account")
        const settings = await getMessagingSettings()
        if (channel === "whatsapp_api") {
            const tooLong = items.find((item: any) => item.body.length > settings.maxChars)
            if (tooLong) throw new BadRequestError(`The message to ${tooLong.name} is ${tooLong.body.length} letters. The limit is ${settings.maxChars}.`)
        }
        const batch = await repos.messageBatch.create({
            channel, type, session: body.session ?? null, total: items.length,
            delaySeconds: channel === "whatsapp_link" || channel === "whatsapp_web" ? settings.delaySeconds : 0,
            createdBy: actorId,
        })
        const rows = await repos.messageItem.insertMany(items.map((item: any) => ({
            batch: batch._id, student: item.student ?? null, name: item.name, to: item.to, body: item.body, channel,
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
        const jobs = rows.map((row: any) => ({ name: "send", data: { teacher: teacherId, item: String(row._id) } }))
        if (channel === "whatsapp_web") {
            const step = settings.delaySeconds * 1000
            for (const job of jobs) {
                // A reserved send time per message, shared by every teacher, keeps the linked number at the owner's pace.
                const at = await redisService.reserveSlot("wa:next-at", step)
                await webQueue().add(job.name, job.data, { delay: Math.max(0, at - Date.now()) })
            }
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

    async batches() {
        const list = await repos.messageBatch.findall({ sort: { createdAt: -1 }, limit: 50 })
        const counts = await repos.messageItem.aggregate([
            { $match: { batch: { $in: list.map((batch) => batch._id) } } },
            { $group: { _id: { batch: "$batch", status: "$status" }, count: { $sum: 1 } } },
        ])
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
        return { batch, items: await repos.messageItem.findall({ filter: { batch: batchId } }) }
    }
}

export default new MessageService()
