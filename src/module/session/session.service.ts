import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { markActive } from "../../common/service/activity"
import { normalizePhone, personName, pick } from "../../common/service/helpers"
import { peopleRefs, refOf } from "../../common/service/lookups"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { studentSessionRows } from "../shared/reports"
import { sessionLabel, sessionView, studentView } from "../shared/views"

class SessionService {
    async findEnrolled(identifier: string) {
        const needle = String(identifier ?? "").trim()
        if (!needle) throw new BadRequestError("Enter a student code")
        const filter: any[] = [{ userID: needle.toUpperCase() }, { phone: normalizePhone(needle) }]
        if (/^[a-f\d]{24}$/i.test(needle)) filter.push({ _id: needle })
        const candidates = await repos.student.findall({ filter: { $or: filter } })
        for (const student of candidates) {
            const entry = await repos.enrollment.findone({ filter: { student: student._id, status: "active", archived: false } })
            if (entry) return { student, entry }
        }
        throw new NotFoundError("No student in your class matches that code")
    }

    private async own(id: string) {
        const session = await repos.session.findById({ id })
        if (!session) throw new NotFoundError("Session not found")
        return session
    }

    async list() {
        const sessions = await repos.session.findall({ sort: { date: -1 }, limit: 300 })
        return Promise.all(sessions.map((session) => sessionView(session, { withRows: Boolean(session.active) })))
    }

    async get(id: string) {
        return sessionView(await this.own(id))
    }

    async create(data: any) {
        const session = await repos.session.create({
            ...data,
            price: data.price === "" ? null : data.price ?? null,
            date: data.date ? new Date(data.date) : new Date(),
            active: false,
        })
        return sessionView(session.toObject())
    }

    async setActive(id: string, active: boolean) {
        const session = await this.own(id)
        if (session.status === "cancelled" && active) throw new BadRequestError("Restore the session before activating it")
        const updated = await withTransaction(async () => {
            if (active) await repos.session.updateMany({ filter: { active: true, _id: { $ne: id } }, data: { $set: { active: false } } })
            return repos.session.findByIdAndUpdate({ id, data: { $set: { active } } })
        })
        return sessionView(updated, { withRows: false })
    }

    async update(id: string, body: any, actorId: string) {
        const session = await this.own(id)
        const fields = pick(body, ["sequence", "week", "number", "center", "grade", "price", "status"])
        if (body.date) fields.date = new Date(body.date)
        if (fields.price === "") fields.price = null
        const cancelling = body.status === "cancelled" && session.status !== "cancelled"
        const updated = await withTransaction(async () => {
            if (cancelling) {
                // Cancelling refunds every charge from this session.
                const rows = await repos.attendance.findall({ filter: { session: id, charged: { $gt: 0 } } })
                for (const row of rows) {
                    await repos.enrollment.updateone({ filter: { student: row.student }, data: { $inc: { balance: row.charged } } })
                    await repos.transaction.create({ student: row.student, amount: row.charged, type: "refund", reason: `Refund · session cancelled (${session.sequence})`, by: actorId, session: id })
                }
                await repos.attendance.updateMany({ filter: { session: id }, data: { $set: { charged: 0 } } })
                fields.active = false
            }
            return repos.session.findByIdAndUpdate({ id, data: { $set: fields } })
        })
        return sessionView(updated)
    }

    async remove(id: string) {
        await this.own(id)
        if (await repos.attendance.exists({ session: id })) {
            throw new ConflictError("This session has attendance records. Cancel it instead, or remove the attendance first.")
        }
        await repos.session.deleteById(id)
        return { id }
    }

    async markAttendance(teacherId: string, id: string, body: any, actorId: string) {
        const session = await repos.session.findone({ filter: { _id: id, active: true } })
        if (!session) throw new NotFoundError("Active session not found")
        const { student, entry } = await this.findEnrolled(body.identifier)
        if (entry.isBlocked && !body.force) {
            throw new ForbiddenError(`${personName(student)} is blocked. Unblock the student or force the check-in.`, { code: "BLOCKED" })
        }
        if (await repos.attendance.exists({ session: id, student: student._id })) throw new ConflictError("Student is already marked present")
        const payment = Math.max(0, Number(body.payment) || 0)
        const price = Number(entry.pricePerSession ?? session.price ?? 0)
        const change = payment - price
        const balance = await withTransaction(async () => {
            // The balance check is part of the update, so two simultaneous scans can't both spend the same money.
            const filter: any = { _id: entry._id }
            if (!body.force && change < 0) filter.balance = { $gte: -change }
            const updated = await repos.enrollment.findOneAndUpdate({ filter, data: { $inc: { balance: change } } })
            if (!updated) {
                throw new ConflictError(`Not enough balance: ${entry.balance} available, ${price} needed.`, { code: "INSUFFICIENT_BALANCE", balance: entry.balance, price, payment })
            }
            await repos.attendance.create({
                session: id, student: student._id, payment, charged: price,
                comment: body.comment ?? "", homeworkStatus: body.homeworkStatus ?? null,
                markedBy: actorId, location: entry.center ?? session.center,
            })
            if (payment) await repos.transaction.create({ student: student._id, amount: payment, type: "payment", reason: "Cash paid at attendance", by: actorId, session: id })
            await repos.transaction.create({ student: student._id, amount: -price, type: "attendance", reason: `Session · ${sessionLabel(session)}`, by: actorId, session: id })
            await repos.session.updateone({ filter: { _id: id }, data: { $inc: { presentCount: 1, collected: payment } } })
            return updated.balance as number
        }).catch((error) => {
            if (error?.code === 11000) throw new ConflictError("Student is already marked present")
            throw error
        })
        await markActive(teacherId, student._id, "attendance")
        return {
            session: await sessionView(await this.own(id), { withRows: false }),
            student: await studentView({ ...entry, balance }),
            charged: price,
            balance,
        }
    }

    async updateAttendance(id: string, studentId: string, body: any, actorId: string) {
        await this.own(id)
        const row = await repos.attendance.findone({ filter: { session: id, student: studentId } })
        if (!row) throw new NotFoundError("Attendance record")
        await withTransaction(async () => {
            if (body.payment !== undefined && Number(body.payment) !== row.payment) {
                const diff = Number(body.payment) - row.payment
                await repos.enrollment.updateone({ filter: { student: studentId }, data: { $inc: { balance: diff } } })
                await repos.transaction.create({ student: studentId, amount: diff, type: "adjustment", reason: "Attendance payment corrected", by: actorId, session: id })
                await repos.session.updateone({ filter: { _id: id }, data: { $inc: { collected: diff } } })
            }
            await repos.attendance.updateone({ filter: { _id: row._id }, data: { $set: pick(body, ["payment", "comment", "homeworkStatus"]) } })
        })
        return this.get(id)
    }

    async removeAttendance(id: string, studentId: string, actorId: string) {
        await this.own(id)
        const row = await repos.attendance.findone({ filter: { session: id, student: studentId } })
        if (!row) throw new NotFoundError("Attendance record not found")
        await withTransaction(async () => {
            if (row.charged) {
                await repos.enrollment.updateone({ filter: { student: studentId }, data: { $inc: { balance: row.charged } } })
                await repos.transaction.create({ student: studentId, amount: row.charged, type: "refund", reason: "Attendance removed — session price refunded", by: actorId, session: id })
            }
            await repos.attendance.deleteone({ filter: { _id: row._id } })
            await repos.session.updateone({ filter: { _id: id }, data: { $inc: { presentCount: -1, collected: -row.payment } } })
        })
        return this.get(id)
    }

    async checkHomework(id: string, { identifier, status }: any, actorId: string) {
        await this.own(id)
        const { student } = await this.findEnrolled(identifier)
        const updated = await repos.attendance.findOneAndUpdate({
            filter: { session: id, student: student._id },
            data: { $set: { homeworkStatus: status, homeworkBy: actorId } },
        })
        if (!updated) throw new NotFoundError(`${personName(student)} hasn't been marked present in this session yet`)
        return { student: pick(student, ["_id", "userID", "firstName", "lastName", "phone", "parentPhone", "grade", "profilepic"]), status }
    }

    async saveClosing(id: string, body: any) {
        await this.own(id)
        const closing = {
            normalCost: Number(body.normalCost) || 0,
            reducedCost: Number(body.reducedCost) || 0,
            reducedCount: Number(body.reducedCount) || 0,
            notes: body.notes ?? "",
        }
        const updated = await repos.session.findByIdAndUpdate({ id, data: { $set: { closing } } })
        return sessionView(updated)
    }

    async staffCheckIn(id: string, body: any) {
        await this.own(id)
        if (!(await repos.assistant.exists({ _id: body.assistant }))) throw new NotFoundError("Assistant not found")
        const updated = await repos.session.findByIdAndUpdate({
            id,
            data: { $push: { staff: { assistant: body.assistant, checkIn: body.checkIn ? new Date(body.checkIn) : new Date(), checkOut: null, notes: body.notes ?? "" } } },
        })
        return sessionView(updated)
    }

    async staffUpdate(id: string, entryId: string, body: any) {
        const set: any = {}
        if (body.checkIn) set["staff.$.checkIn"] = new Date(body.checkIn)
        if (body.checkOut) set["staff.$.checkOut"] = new Date(body.checkOut)
        if (body.notes !== undefined) set["staff.$.notes"] = body.notes
        const updated = await repos.session.findOneAndUpdate({ filter: { _id: id, "staff._id": entryId }, data: { $set: set } })
        if (!updated) throw new NotFoundError("Staff record not found")
        return sessionView(updated)
    }

    async staffRemove(id: string, entryId: string) {
        const updated = await repos.session.findByIdAndUpdate({ id, data: { $pull: { staff: { _id: entryId } } } })
        if (!updated) throw new NotFoundError("Session not found")
        return sessionView(updated)
    }

    async lookup(identifier: string) {
        const { student, entry } = await this.findEnrolled(identifier)
        const active = await repos.session.findone({ filter: { active: true } })
        const row = active ? await repos.attendance.findone({ filter: { session: active._id, student: student._id } }) : null
        const price = Number(entry.pricePerSession ?? active?.price ?? 0)
        const reasons: string[] = []
        if (entry.isBlocked) reasons.push("Student is blocked")
        if (!row && entry.balance < price) reasons.push(`Balance ${entry.balance} is less than the session price ${price}`)
        const [warnings, booklets, sessions] = await Promise.all([
            repos.warning.findall({ filter: { student: student._id }, sort: { createdAt: -1 } }),
            repos.bookletOrder.findall({ filter: { student: student._id, delivered: false, status: { $ne: "rejected" } }, populate: { path: "booklet", select: "name" } }),
            studentSessionRows(student._id, entry),
        ])
        if (warnings.length >= 3) reasons.push(`${warnings.length} warnings`)
        const people = await peopleRefs([row?.markedBy, ...warnings.map((warning) => warning.by)])
        return {
            student: await studentView(entry),
            activeSession: active ? pick(active, ["_id", "sequence", "week", "number", "date", "center", "price"]) : null,
            attended: Boolean(row),
            attendance: row ? { ...row, markedBy: refOf(people, row.markedBy) } : null,
            price,
            allowed: reasons.length === 0,
            reasons,
            warnings: warnings.map((warning) => ({ ...warning, byName: refOf(people, warning.by)?.name })),
            booklets,
            lastSessions: sessions.slice(0, 4),
        }
    }
}

export default new SessionService()
