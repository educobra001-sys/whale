import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { markActive } from "../../common/service/activity"
import { escapeRegex, nameKey, normalizePhone, normalizeStudentCode, personName, pick, sameId } from "../../common/service/helpers"
import { centerNames, peopleRefs, refOf } from "../../common/service/lookups"
import { isHidden } from "../../common/service/sections"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { studentSessionRows } from "../shared/reports"
import { sessionLabel, sessionView, studentView } from "../shared/views"

// Offline scans carry the time they happened. Never in the future, never more than a week back.
const offlineTime = (value: unknown) => {
    const at = value ? new Date(String(value)) : new Date()
    const now = Date.now()
    if (Number.isNaN(at.getTime()) || at.getTime() > now) return new Date()
    return at.getTime() < now - 7 * 86_400_000 ? new Date(now - 7 * 86_400_000) : at
}

class SessionService {
    async findEnrolled(identifier: string) {
        const needle = String(identifier ?? "").trim()
        if (!needle) throw new BadRequestError("Enter a student code")
        const filter: any[] = [{ userID: needle.toUpperCase() }, { userID: normalizeStudentCode(needle) }, { phone: normalizePhone(needle) }]
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
        // A check-in a device accepted offline is honoured even if the session was closed since then:
        // the student was let in and any cash was already collected, so the server records it as it happened.
        const offline = Boolean(body.offline)
        const session = await repos.session.findone({ filter: offline ? { _id: id, status: { $ne: "cancelled" } } : { _id: id, active: true } })
        if (!session) throw new NotFoundError(offline ? "Session not found or cancelled" : "Active session not found")
        const { student, entry } = await this.findEnrolled(body.identifier)
        const force = Boolean(body.force) || offline
        const markedAt = offline ? offlineTime(body.scannedAt) : new Date()
        if (offline) {
            const note = `Recorded offline at ${markedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
            body.comment = body.comment ? `${body.comment} · ${note}` : note
        }
        if (entry.isBlocked && !force) {
            throw new ForbiddenError(`${personName(student)} is blocked. Unblock the student or force the check-in.`, { code: "BLOCKED" })
        }
        if (await repos.attendance.exists({ session: id, student: student._id })) throw new ConflictError("Student is already marked present")
        const payment = Math.max(0, Number(body.payment) || 0)
        const price = Number(entry.pricePerSession ?? session.price ?? 0)
        const change = payment - price
        const balance = await withTransaction(async () => {
            // The balance check is part of the update, so two simultaneous scans can't both spend the same money.
            const filter: any = { _id: entry._id }
            if (!force && change < 0) filter.balance = { $gte: -change }
            const updated = await repos.enrollment.findOneAndUpdate({ filter, data: { $inc: { balance: change } } })
            if (!updated) {
                throw new ConflictError(`Not enough balance: ${entry.balance} available, ${price} needed.`, { code: "INSUFFICIENT_BALANCE", balance: entry.balance, price, payment })
            }
            await repos.attendance.create({
                session: id, student: student._id, payment, charged: price, markedAt,
                comment: body.comment ?? "", homeworkStatus: body.homeworkStatus ?? null,
                markedBy: actorId, location: entry.center ?? session.center,
            })
            if (payment) await repos.transaction.create({ student: student._id, amount: payment, type: "payment", reason: "Cash paid at attendance", by: actorId, session: id })
            await repos.transaction.create({ student: student._id, amount: -price, type: "attendance", reason: `Session · ${sessionLabel(session)}`, by: actorId, session: id })
            return updated.balance as number
        }).catch((error) => {
            if (error?.code === 11000) throw new ConflictError("Student is already marked present")
            throw error
        })
        // Outside the transaction: every scan touches this one document, so inside it they would all collide and retry.
        const updatedSession = await repos.session.findByIdAndUpdate({ id, data: { $inc: { presentCount: 1, collected: payment } } })
        await markActive(teacherId, student._id, "attendance")
        return {
            session: await sessionView(updatedSession, { withRows: false }),
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
        const [warnings, booklets, sessions, exams] = await Promise.all([
            repos.warning.findall({ filter: { student: student._id }, sort: { createdAt: -1 } }),
            (await isHidden("booklets")) ? Promise.resolve([]) : repos.bookletOrder.findall({ filter: { student: student._id, delivered: false, status: { $ne: "rejected" } }, populate: { path: "booklet", select: "name" } }),
            studentSessionRows(student._id, entry, 10),
            this.recentExams(student._id),
        ])
        if (warnings.length >= 3) reasons.push(`${warnings.length} warnings`)
        const people = await peopleRefs([row?.markedBy, ...warnings.map((warning) => warning.by)])
        const view = await studentView(entry)
        const sessionCenter = active?.center ? (await centerNames([active.center])).get(String(active.center)) ?? "" : ""
        return {
            student: view,
            activeSession: active ? { ...pick(active, ["_id", "sequence", "week", "number", "date", "center", "price"]), centerName: sessionCenter } : null,
            // The student belongs to another center than the session's (an online session matches everyone).
            centerMatch: !active?.center || !entry.center || String(active.center) === String(entry.center),
            attended: Boolean(row),
            attendance: row ? { ...row, markedBy: refOf(people, row.markedBy) } : null,
            price,
            allowed: reasons.length === 0,
            reasons,
            warnings: warnings.map((warning) => ({ ...warning, byName: refOf(people, warning.by)?.name })),
            booklets,
            lastSessions: sessions.filter((row) => !active || String(row.session._id) !== String(active._id)).slice(0, 8),
            exams,
        }
    }

    private async recentExams(studentId: any) {
        if (await isHidden("exams")) return []
        const exams = await repos.exam.findall({ filter: { "results.student": studentId }, sort: { date: -1 }, limit: 5, select: "name maxScore date results" })
        return exams.map((exam) => ({
            name: exam.name, maxScore: exam.maxScore, date: exam.date,
            score: (exam.results ?? []).find((row: any) => String(row.student) === String(studentId))?.score ?? null,
        }))
    }

    // Typing in the scan box: an exact code, part of a phone (3+ digits) or part of a name, among this teacher's students.
    async search(query: string) {
        const text = String(query ?? "").trim().slice(0, 60)
        if (!text) return { exactCode: null, total: 0, students: [] }
        const entries = await repos.enrollment.findall({ filter: { status: "active", archived: false }, select: "student center isBlocked balance" })
        const ids = entries.map((entry) => entry.student)
        const code = normalizeStudentCode(text)
        let digits = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "")
        // +20 / 0020 in front (even of part of a number) stands for the local 0.
        if (/^(?:00)?201\d{9}$/.test(digits) || /^\s*(?:\+|00)\s*20/.test(text)) digits = digits.replace(/^(?:00)?20/, "0")
        const or: any[] = [{ userID: code }]
        if (digits.length >= 3 && /^[+\d\s\-٠-٩]+$/.test(text)) {
            const pattern = new RegExp(escapeRegex(digits))
            or.push({ phone: pattern }, { parentPhone: pattern })
        }
        if (/[\p{L}]{2,}/u.test(text)) {
            const pattern = new RegExp(escapeRegex(text), "i")
            or.push({ firstName: pattern }, { lastName: pattern }, { nameKey: new RegExp(escapeRegex(nameKey(text, ""))) })
        }
        const filter = { _id: { $in: ids }, $or: or }
        const [students, total, active] = await Promise.all([
            repos.student.findall({ filter, limit: 30, select: "userID firstName lastName phone parentPhone grade" }),
            repos.student.count(filter),
            repos.session.findone({ filter: { active: true } }),
        ])
        const present = active ? new Set((await repos.attendance.findall({ filter: { session: active._id, student: { $in: students.map((s) => s._id) } }, select: "student" })).map((row) => String(row.student))) : new Set<string>()
        const centers = await centerNames(entries.map((entry) => entry.center))
        const byStudent = new Map(entries.map((entry) => [String(entry.student), entry]))
        const exact = students.find((student) => student.userID === code)
        const rows = students.map((student) => {
            const entry: any = byStudent.get(String(student._id))
            const sameCenter = !active?.center || !entry?.center || String(entry.center) === String(active.center)
            return {
                _id: student._id,
                code: student.userID,
                name: personName(student),
                phone: student.phone ?? "",
                parentPhone: student.parentPhone ?? "",
                grade: student.grade ?? "",
                centerName: entry?.center ? centers.get(String(entry.center)) ?? "" : "",
                match: exact && sameId(exact._id, student._id) ? -1 : sameCenter ? 0 : 1,
                present: present.has(String(student._id)),
                blocked: Boolean(entry?.isBlocked),
            }
        }).sort((a, b) => a.match - b.match || a.name.localeCompare(b.name))
        return { exactCode: exact?.userID ?? null, total, students: rows }
    }

    // Already checked in: more cash on top of what was paid in this session. opId makes an offline replay count once.
    async addPayment(id: string, body: any, actorId: string) {
        const session = await repos.session.findone({ filter: { _id: id, status: { $ne: "cancelled" } } })
        if (!session) throw new NotFoundError("Session not found or cancelled")
        const { student, entry } = await this.findEnrolled(body.identifier)
        const amount = Math.max(0, Number(body.amount) || 0)
        if (!amount) throw new BadRequestError("Enter an amount above zero")
        if (body.opId && await repos.transaction.exists({ opId: body.opId })) {
            const current = await repos.enrollment.findById({ id: entry._id, select: "balance" })
            return { duplicate: true, balance: current?.balance ?? entry.balance, student: { _id: student._id, name: personName(student) } }
        }
        const row = await repos.attendance.findone({ filter: { session: id, student: student._id } })
        if (!row) throw new NotFoundError(`${personName(student)} isn't checked in to this session`)
        const balance = await withTransaction(async () => {
            const updated = await repos.enrollment.findOneAndUpdate({ filter: { _id: entry._id }, data: { $inc: { balance: amount } } })
            await repos.attendance.updateone({ filter: { _id: row._id }, data: { $inc: { payment: amount } } })
            await repos.transaction.create({
                student: student._id, amount, type: "payment", reason: body.reason ? `Cash · ${body.reason}` : "Cash paid at attendance",
                by: actorId, session: id, ...(body.opId ? { opId: body.opId } : {}),
            })
            return updated.balance as number
        }).catch((error) => {
            if (error?.code === 11000) throw new ConflictError("This payment was already recorded")
            throw error
        })
        await repos.session.updateone({ filter: { _id: id }, data: { $inc: { collected: amount } } })
        return { balance, paidInSession: row.payment + amount, student: { _id: student._id, name: personName(student) } }
    }

    // What a phone keeps to scan with no internet: the class, recent sessions, and who came to which with what homework.
    async snapshot() {
        const [entries, sessions] = await Promise.all([
            repos.enrollment.findall({ filter: { status: "active", archived: false } }),
            repos.session.findall({ filter: { status: { $ne: "cancelled" } }, sort: { date: -1 }, limit: 40 }),
        ])
        const students = await repos.student.findall({ filter: { _id: { $in: entries.map((entry) => entry.student) } }, select: "userID firstName lastName phone parentPhone grade" })
        const [centers, people, rows, warnings] = await Promise.all([
            centerNames([...entries.map((entry) => entry.center), ...sessions.map((session) => session.center)]),
            peopleRefs(entries.map((entry) => entry.followUpAssistant)),
            repos.attendance.findall({ filter: { session: { $in: sessions.map((session) => session._id) } }, select: "student session homeworkStatus payment" }),
            repos.warning.aggregate([{ $group: { _id: "$student", count: { $sum: 1 } } }]),
        ])
        const byStudent = new Map(students.map((student) => [String(student._id), student]))
        const warningCount = new Map(warnings.map((row) => [String(row._id), row.count as number]))
        return {
            at: new Date(),
            sessions: sessions.map((session) => ({
                _id: session._id, week: session.week, number: session.number, sequence: session.sequence, date: session.date,
                center: session.center ?? null, centerName: session.center ? centers.get(String(session.center)) ?? "" : "",
                price: session.price ?? 0, active: Boolean(session.active), status: session.status,
            })),
            students: entries.flatMap((entry) => {
                const student = byStudent.get(String(entry.student))
                if (!student) return []
                return [{
                    _id: student._id, userID: student.userID, firstName: student.firstName ?? "", lastName: student.lastName ?? "",
                    phone: student.phone ?? "", parentPhone: student.parentPhone ?? "", grade: student.grade ?? "",
                    center: entry.center ?? null, centerName: entry.center ? centers.get(String(entry.center)) ?? "" : "",
                    balance: entry.balance ?? 0, pricePerSession: entry.pricePerSession ?? null, isBlocked: Boolean(entry.isBlocked),
                    adminNote: entry.adminNote ?? "", followUpAssistantName: refOf(people, entry.followUpAssistant)?.name ?? "",
                    joinedAt: entry.joinedAt ?? null, warningsCount: warningCount.get(String(student._id)) ?? 0,
                }]
            }),
            // [student, session, homework status or null, paid]
            attendance: rows.map((row) => [String(row.student), String(row.session), row.homeworkStatus ?? null, row.payment ?? 0]),
        }
    }
}

export default new SessionService()
