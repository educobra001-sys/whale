import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { genertateHash } from "../../common/security/security"
import { forgetTeacherTeam } from "../../common/service/actorService"
import { DAY, nameKey, normalizePhone, personName, pick, sameId, sum, teacherPublic } from "../../common/service/helpers"
import { centerNames, peopleRefs, refOf } from "../../common/service/lookups"
import { duplicateStudentError, findExistingStudent, nextStudentId } from "../../common/service/registry"
import { runAsPlatform } from "../../common/service/tenantContext"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { lessonAccess, studentExamRows, studentSessionRows, studentStats } from "../shared/reports"
import { slotViews, sessionView, studentView, studentViews, transactionViews } from "../shared/views"
import crypto from "node:crypto"

const STUDENT_EDIT = ["firstName", "lastName", "phone", "parentPhone", "gender", "grade", "schoolName", "learningLanguage", "profilepic"]
const ENROLLMENT_EDIT = ["pricePerSession", "center", "adminNote", "followUpAssistant"]

const tempPassword = () => `ec${crypto.randomInt(100000, 1000000)}`

class TeacherService {
    async profile(teacherId: string) {
        const teacher = await repos.teacher.findById({ id: teacherId })
        if (!teacher) throw new NotFoundError("Teacher account not found")
        const links = await repos.centerLink.findall({ filter: { teacher: teacherId, status: "active" }, select: "center" })
        return {
            ...teacherPublic(teacher),
            email: teacher.email,
            phone: teacher.phone,
            status: teacher.status,
            referralId: teacher.referralId,
            features: teacher.features,
            channels: teacher.channels,
            pricePerStudent: teacher.pricePerStudent,
            centers: links.map((link) => link.center),
        }
    }

    async updateProfile(teacherId: string, data: any) {
        if (data.phone) data.phone = normalizePhone(data.phone)
        if (data.companyName && await repos.teacher.exists({ companyName: data.companyName, _id: { $ne: teacherId } })) {
            throw new ConflictError("Company name already taken")
        }
        await repos.teacher.updateone({ filter: { _id: teacherId }, data: { $set: data } })
        return this.profile(teacherId)
    }

    // Closing an account hides it and ends its sessions; the data stays so the owner can restore it.
    async closeAccount(teacherId: string) {
        await repos.teacher.updateone({
            filter: { _id: teacherId },
            data: { $set: { status: "suspended", statusNote: "Closed by the teacher", visibility: "private" }, $inc: { tokenVersion: 1 } },
        })
        await forgetTeacherTeam(teacherId)
        return { id: teacherId }
    }

    async dashboard(teacherId: string) {
        const active = { status: "active", archived: false }
        const [students, assistants, centers, pendingRequests, pendingTopups, pendingSubmissions, lowBalance, blocked, totals, sessions, slots, activeRaw] = await Promise.all([
            repos.enrollment.count(active),
            repos.assistant.count({}),
            repos.centerLink.count({ teacher: teacherId, status: "active" }),
            repos.enrollment.count({ status: "pending", archived: false }),
            repos.topup.count({ status: "pending" }),
            repos.submission.count({ status: "submitted" }),
            repos.enrollment.count({ ...active, $expr: { $lt: ["$balance", { $ifNull: ["$pricePerSession", 0] }] } }),
            repos.enrollment.count({ ...active, isBlocked: true }),
            repos.enrollment.aggregate([{ $match: active }, { $group: { _id: null, balance: { $sum: "$balance" } } }]),
            repos.session.findall({ filter: { status: "normal" }, sort: { date: -1 }, limit: 8 }),
            repos.schedule.findall({ filter: { isActive: true, dayOfWeek: new Date().getDay() } }),
            repos.session.findone({ filter: { active: true } }),
        ])
        const [byCenterRows, gradeRows, lowRows, txs, warnings, requests] = await Promise.all([
            repos.enrollment.aggregate([{ $match: active }, { $group: { _id: "$center", value: { $sum: 1 } } }]),
            repos.enrollment.aggregate([
                { $match: active },
                { $lookup: { from: "students", localField: "student", foreignField: "_id", as: "person", pipeline: [{ $project: { grade: 1 } }] } },
                { $group: { _id: { $first: "$person.grade" }, value: { $sum: 1 } } },
            ]),
            repos.enrollment.findall({ filter: { ...active, $expr: { $lt: ["$balance", { $ifNull: ["$pricePerSession", 0] }] } }, sort: { balance: 1 }, limit: 6 }),
            repos.transaction.findall({ filter: { type: { $ne: "attendance" } }, sort: { createdAt: -1 }, limit: 8 }),
            repos.warning.findall({ sort: { createdAt: -1 }, limit: 4 }),
            repos.enrollment.findall({ filter: { status: "pending", archived: false }, sort: { joinedAt: -1 }, limit: 4 }),
        ])
        const names = await centerNames(byCenterRows.map((row) => row._id))
        const people = await repos.student.findall({
            filter: { _id: { $in: [...txs, ...warnings, ...requests].map((row) => row.student) } },
            select: "firstName lastName",
        })
        const nameOf = (id: unknown) => personName(people.find((person) => sameId(person._id, id)))
        const recent = [
            ...txs.map((tx) => ({ type: tx.type, text: `${nameOf(tx.student)} · ${tx.reason ?? ""}`, amount: tx.amount, createdAt: tx.createdAt })),
            ...warnings.map((row) => ({ type: "warning", text: `Warning for ${nameOf(row.student)}: ${row.reason ?? ""}`, createdAt: row.createdAt })),
            ...requests.map((row) => ({ type: "request", text: `${nameOf(row.student)} asked to join your class`, createdAt: row.joinedAt })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8)
        return {
            counts: { students, assistants, centers, pendingRequests, pendingTopups, pendingSubmissions, lowBalance, blocked },
            totalBalance: totals[0]?.balance ?? 0,
            activeSession: activeRaw ? await sessionView(activeRaw, { withRows: false }) : null,
            todaySlots: await slotViews(slots),
            attendanceTrend: [...sessions].reverse().map((session) => ({ label: `#${session.number}`, value: session.presentCount, sessionId: session._id })),
            byCenter: byCenterRows.map((row) => ({ label: row._id ? names.get(String(row._id)) ?? "Unassigned" : "Unassigned", value: row.value })),
            byGrade: gradeRows.map((row) => ({ label: ["S1", "S2", "S3"][Number(row._id)] ?? "Unassigned", value: row.value })),
            lowBalanceStudents: await studentViews(lowRows),
            recent,
        }
    }

    async students() {
        const entries = await repos.enrollment.findall({ filter: { status: "active", archived: false }, sort: { joinedAt: -1 } })
        return studentViews(entries)
    }

    private async entryOf(studentId: string, includeArchived = false) {
        const entry = await repos.enrollment.findone({ filter: { student: studentId, ...(includeArchived ? {} : { archived: false }) } })
        if (!entry) throw new NotFoundError("Student not found")
        return entry
    }

    async student(studentId: string) {
        const entry = await this.entryOf(studentId)
        if (entry.status !== "active") throw new NotFoundError("Student not found")
        return studentView(entry)
    }

    async updateStudent(studentId: string, body: any) {
        const entry = await this.entryOf(studentId)
        const person = pick(body, STUDENT_EDIT)
        if (person.phone) person.phone = normalizePhone(person.phone)
        if (person.parentPhone) person.parentPhone = normalizePhone(person.parentPhone)
        if (person.firstName !== undefined || person.lastName !== undefined) {
            const current = await repos.student.findById({ id: studentId, select: "firstName lastName" })
            person.nameKey = nameKey(person.firstName ?? current?.firstName, person.lastName ?? current?.lastName)
        }
        if (Object.keys(person).length) await repos.student.updateone({ filter: { _id: studentId }, data: { $set: person } })
        const enrollment = pick(body, ENROLLMENT_EDIT)
        if (Object.keys(enrollment).length) await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: enrollment } })
        return this.student(studentId)
    }

    async createStudent(body: any, actorId: string) {
        const data: any = {
            ...pick(body, ["firstName", "lastName", "gender", "grade", "schoolName", "learningLanguage"]),
            phone: normalizePhone(body.phone),
            parentPhone: normalizePhone(body.parentPhone),
        }
        const existing = await findExistingStudent(data)
        if (existing) throw duplicateStudentError(existing)
        const password = body.password || tempPassword()
        const userID = await nextStudentId()
        const hashed = await genertateHash({ plainText: password })
        const opening = Number(body.balance) || 0
        const entry = await withTransaction(async () => {
            const student = await repos.student.create({ ...data, userID, password: hashed, nameKey: nameKey(data.firstName, data.lastName) })
            const created = await repos.enrollment.create({
                student: student._id,
                status: "active",
                balance: opening,
                pricePerSession: body.pricePerSession ?? null,
                center: body.center ?? null,
            })
            if (opening) await repos.transaction.create({ student: student._id, amount: opening, type: "adjustment", reason: "Opening balance", by: actorId })
            return created.toObject()
        })
        return { student: await studentView(entry), userID, password }
    }

    async linkStudent(body: any) {
        const needle = body.identifier.trim()
        const student = await repos.student.findone({ filter: { $or: [{ userID: needle.toUpperCase() }, { phone: normalizePhone(needle) }] } })
        if (!student) throw new NotFoundError("Student account not found")
        const existing = await repos.enrollment.findone({ filter: { student: student._id } })
        if (existing?.status === "active" && !existing.archived) throw new ConflictError("This student is already in your class")
        const entry = existing
            ? await repos.enrollment.findByIdAndUpdate({ id: existing._id, data: { $set: { status: "active", archived: false, removedAt: null } } })
            : (await repos.enrollment.create({ student: student._id, status: "active", center: body.center ?? null, pricePerSession: body.pricePerSession ?? null })).toObject()
        return studentView(entry)
    }

    async importStudents(rows: any[], actorId: string) {
        const created: any[] = []
        const skipped: any[] = []
        for (const row of rows) {
            try {
                if (!row.firstName || !row.phone) throw new BadRequestError("First name and phone are required")
                const result = await this.createStudent(row, actorId)
                created.push({ name: personName(result.student), userID: result.userID, password: result.password })
            } catch (error: any) {
                skipped.push({ row, reason: error.message })
            }
        }
        return { created, skipped }
    }

    async removeStudent(studentId: string, reason?: string) {
        const entry = await this.entryOf(studentId)
        await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: { archived: true, removedAt: new Date(), removedReason: reason ?? "" } } })
        return { id: studentId }
    }

    async history(studentId: string) {
        const entry = await this.entryOf(studentId)
        const person = await repos.student.findById({ id: studentId, select: "grade" })
        const [attendance, exams, homework, submissions, transactions, warnings, points, orders, lessons, watch] = await Promise.all([
            studentSessionRows(studentId, entry),
            studentExamRows(studentId, person?.grade),
            repos.homework.findall({ sort: { order: -1 }, limit: 200 }),
            repos.submission.findall({ filter: { student: studentId } }),
            repos.transaction.findall({ filter: { student: studentId }, sort: { createdAt: -1 }, limit: 300 }),
            repos.warning.findall({ filter: { student: studentId }, sort: { createdAt: -1 } }),
            repos.pointsLog.findall({ filter: { student: studentId }, sort: { createdAt: -1 }, limit: 200 }),
            repos.bookletOrder.findall({ filter: { student: studentId }, populate: { path: "booklet", select: "name sellPrice" } }),
            repos.lesson.findall({ filter: { published: true }, sort: { week: 1, order: 1 } }),
            repos.watch.findall({ filter: { student: studentId } }),
        ])
        const people = await peopleRefs([...warnings, ...points].map((row) => row.by))
        return {
            attendance,
            exams,
            homework: homework.map((hw) => {
                const sub = submissions.find((item) => sameId(item.homework, hw._id))
                return { homework: pick(hw, ["_id", "title", "order", "endDate"]), status: sub?.status ?? null, submittedAt: sub?.submittedAt ?? null, feedback: sub?.feedback ?? "" }
            }),
            transactions: await transactionViews(transactions),
            warnings: warnings.map((row) => ({ ...row, byName: refOf(people, row.by)?.name })),
            points: points.map((row) => ({ ...row, byName: refOf(people, row.by)?.name })),
            booklets: orders,
            lessons: await Promise.all(lessons.map(async (lesson) => ({
                lesson: pick(lesson, ["_id", "title", "week"]),
                access: await lessonAccess(lesson, studentId, entry),
                watchedSeconds: sum(watch.filter((row) => sameId(row.lesson, lesson._id)), (row) => row.seconds),
                totalSeconds: sum(lesson.parts, (part: any) => part.durationSeconds),
            }))),
            stats: studentStats(attendance, exams),
        }
    }

    async adjustBalance(studentId: string, { amount, reason }: any, actorId: string) {
        if (!amount) throw new BadRequestError("Enter a non-zero amount")
        const entry = await this.entryOf(studentId)
        const updated = await withTransaction(async () => {
            const row = await repos.enrollment.findByIdAndUpdate({ id: entry._id, data: { $inc: { balance: amount } } })
            await repos.transaction.create({ student: studentId, amount, type: amount > 0 ? "payment" : "adjustment", reason: reason || (amount > 0 ? "Payment received" : "Manual deduction"), by: actorId })
            return row
        })
        return studentView(updated)
    }

    async addPoints(studentId: string, { points, reason }: any, actorId: string) {
        if (!points) throw new BadRequestError("Enter a non-zero number of points")
        const entry = await this.entryOf(studentId)
        const updated = await repos.enrollment.findByIdAndUpdate({ id: entry._id, data: { $inc: { points } } })
        await repos.pointsLog.create({ student: studentId, points, reason: reason ?? "", by: actorId })
        return studentView(updated)
    }

    async addWarning(studentId: string, reason: string | undefined, actorId: string) {
        const entry = await this.entryOf(studentId)
        await repos.warning.create({ student: studentId, reason: reason ?? "", by: actorId })
        const count = await repos.warning.count({ student: studentId })
        // Three warnings block the student, as in the old system.
        if (count >= 3) await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: { isBlocked: true } } })
        return this.student(studentId)
    }

    async removeWarning(studentId: string, warningId: string) {
        await repos.warning.deleteone({ filter: { _id: warningId, student: studentId } })
        return this.student(studentId)
    }

    async setBlocked(studentId: string, blocked: boolean) {
        const entry = await this.entryOf(studentId)
        await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: { isBlocked: blocked } } })
        return this.student(studentId)
    }

    async requests() {
        const entries = await repos.enrollment.findall({ filter: { status: "pending", archived: false }, sort: { joinedAt: -1 }, populate: { path: "student", select: "userID firstName lastName phone parentPhone gender grade schoolName learningLanguage profilepic createdAt" } })
        return entries.map((entry) => ({ _id: entry._id, student: entry.student, createdAt: entry.joinedAt }))
    }

    async answerRequest(requestId: string, status: string) {
        const entry = await repos.enrollment.findone({ filter: { _id: requestId, status: "pending" } })
        if (!entry) throw new NotFoundError("Request not found")
        if (status === "accepted") await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: { status: "active", joinedAt: new Date() } } })
        else await repos.enrollment.deleteone({ filter: { _id: entry._id } })
        return { _id: requestId, status }
    }

    async archive() {
        const entries = await repos.enrollment.findall({ filter: { archived: true }, sort: { removedAt: -1 }, populate: { path: "student", select: "userID firstName lastName phone parentPhone gender grade schoolName learningLanguage profilepic createdAt" } })
        return entries.map((entry) => ({ student: entry.student, removedAt: entry.removedAt, reason: entry.removedReason, balance: entry.balance, points: entry.points }))
    }

    async restore(studentId: string) {
        const entry = await this.entryOf(studentId, true)
        await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $set: { archived: false, removedAt: null, status: "active" } } })
        return this.student(studentId)
    }

    // ---------- team ----------
    private async salaryFor(assistant: any, entries: any[]) {
        const minutes = sum(entries, (entry) => entry.minutes || 0)
        const type = assistant.salary?.type ?? "fixed"
        const amount = Number(assistant.salary?.amount) || 0
        if (type === "hourly") return Math.round((minutes / 60) * amount)
        if (type === "per_session") return entries.length * amount
        return amount
    }

    async staffEntries(assistantId: unknown, from?: unknown, to?: unknown) {
        const sessions = await repos.session.findall({ filter: { "staff.assistant": assistantId }, sort: { date: -1 }, limit: 500 })
        const start = from ? new Date(String(from)).getTime() : 0
        const end = to ? new Date(String(to)).getTime() + DAY - 1 : Infinity
        return sessions.flatMap((session) => session.staff
            .filter((row: any) => sameId(row.assistant, assistantId))
            .filter((row: any) => {
                const time = new Date(row.checkIn ?? session.date).getTime()
                return time >= start && time <= end
            })
            .map((row: any) => ({
                ...row,
                session: { _id: session._id, label: `Week ${session.week} · #${session.number} · ${session.sequence}`, date: session.date },
                minutes: row.checkIn && row.checkOut ? Math.round((new Date(row.checkOut).getTime() - new Date(row.checkIn).getTime()) / 60000) : 0,
            })))
    }

    salary = this.salaryFor

    private async assistantView(assistant: any) {
        const [followUpCount, entries] = await Promise.all([
            repos.enrollment.count({ followUpAssistant: assistant._id, archived: false }),
            this.staffEntries(assistant._id),
        ])
        return {
            ...pick(assistant, ["_id", "userName", "firstName", "lastName", "email", "phone", "role", "permissions", "salary", "referralId", "createdAt"]),
            followUpCount,
            sessionsWorked: entries.length,
        }
    }

    view = this.assistantView

    async assistants() {
        const list = await repos.assistant.findall({ sort: { createdAt: 1 } })
        return Promise.all(list.map((assistant) => this.assistantView(assistant)))
    }

    private async ownAssistant(id: string) {
        const assistant = await repos.assistant.findById({ id })
        if (!assistant) throw new NotFoundError("Assistant not found")
        return assistant
    }

    async addAssistant(teacherId: string, data: any) {
        const phone = normalizePhone(data.phone)
        const taken = await runAsPlatform(async () => {
            const filter = { $or: [{ email: data.email }, { userName: data.userName }, { phone }] }
            return (await repos.assistant.findone({ filter })) ?? (await repos.teacher.findone({ filter }))
        })
        if (taken) {
            if (taken.email === data.email) throw new ConflictError("Email already registered")
            if (taken.userName === data.userName) throw new ConflictError("Username already taken")
            throw new ConflictError("Phone number already registered")
        }
        const assistant = await repos.assistant.create({ ...data, phone, teacher: teacherId, password: await genertateHash({ plainText: data.password }) })
        return { ...(await this.assistantView(assistant.toObject())), id: assistant._id }
    }

    async assistantStats(id: string, query: any) {
        const assistant = await this.ownAssistant(id)
        const entries = await this.staffEntries(assistant._id, query.from, query.to)
        const [attendanceMarked, homeworkChecked, comments] = await Promise.all([
            repos.attendance.count({ markedBy: assistant._id }),
            repos.attendance.count({ homeworkBy: assistant._id }),
            repos.followComment.count({ by: assistant._id }),
        ])
        return {
            assistant: await this.assistantView(assistant),
            sessionsWorked: entries.length,
            minutes: sum(entries, (entry) => entry.minutes),
            attendanceMarked,
            homeworkChecked,
            comments,
            salaryEstimate: await this.salaryFor(assistant, entries),
            log: entries,
        }
    }

    async updateAssistant(id: string, data: any) {
        await this.ownAssistant(id)
        if (data.phone) data.phone = normalizePhone(data.phone)
        const updated = await repos.assistant.findByIdAndUpdate({ id, data: { $set: data } })
        return this.assistantView(updated)
    }

    async removeAssistant(id: string) {
        await this.ownAssistant(id)
        await repos.assistant.deleteById(id)
        await repos.enrollment.updateMany({ filter: { followUpAssistant: id }, data: { $set: { followUpAssistant: null } } })
        return { id }
    }

    // ---------- centers ----------
    private linkView(link: any, center: any) {
        return { _id: link._id, center, status: link.status, requestedBy: link.requestedBy, createdAt: link.createdAt }
    }

    async centers(teacherId: string) {
        const links = await repos.centerLink.findall({
            filter: { teacher: teacherId, status: { $ne: "rejected" } },
            populate: { path: "center", select: "name phone localphone textlocation Maplocation createdAt" },
        })
        return links.map((link) => this.linkView(link, link.center))
    }

    async requestCenter(teacherId: string, centerId: string) {
        const center = await repos.center.findone({ filter: { _id: centerId, status: "active" }, select: "name phone localphone textlocation Maplocation createdAt" })
        if (!center) throw new NotFoundError("Center not found")
        const existing = await repos.centerLink.findone({ filter: { teacher: teacherId, center: centerId } })
        if (existing?.status === "active") throw new ConflictError("You're already linked to this center")
        const status = existing?.status === "pending" && existing.requestedBy === "center" ? "active" : "pending"
        const requestedBy = status === "active" ? "center" : "teacher"
        const link = await repos.centerLink.findOneAndUpdate({
            filter: { teacher: teacherId, center: centerId },
            data: { $set: { status, requestedBy } },
            options: { upsert: true },
        })
        return this.linkView(link, center)
    }

    async answerCenter(teacherId: string, centerId: string, status: string) {
        const link = await repos.centerLink.findone({ filter: { teacher: teacherId, center: centerId } })
        if (!link) throw new NotFoundError("Request not found")
        if (link.requestedBy !== "center") throw new BadRequestError("Only the center can answer your request")
        const updated = await repos.centerLink.findByIdAndUpdate({ id: link._id, data: { $set: { status } }, populate: { path: "center", select: "name phone localphone textlocation Maplocation createdAt" } })
        return this.linkView(updated, updated.center)
    }

    async leaveCenter(teacherId: string, centerId: string) {
        await repos.centerLink.deleteone({ filter: { teacher: teacherId, center: centerId } })
        return { id: centerId }
    }

    // ---------- linked teachers: separate rooms, with a door the two teachers agreed to open ----------
    async links(teacherId: string) {
        const rows = await repos.teacherLink.findall({
            filter: { $or: [{ from: teacherId }, { to: teacherId }] },
            populate: [{ path: "from", select: "userName firstName lastName companyName subject profilepic" }, { path: "to", select: "userName firstName lastName companyName subject profilepic" }],
        })
        return rows.map((row) => {
            const outgoing = sameId(row.from._id, teacherId)
            return { _id: row._id, teacher: outgoing ? row.to : row.from, status: row.status, direction: outgoing ? "sent" : "received", createdAt: row.createdAt }
        })
    }

    async requestLink(teacherId: string, userName: string) {
        const other = await repos.teacher.findone({ filter: { userName, status: "active" }, select: "_id" })
        if (!other || sameId(other._id, teacherId)) throw new NotFoundError("Teacher not found")
        const existing = await repos.teacherLink.findone({ filter: { $or: [{ from: teacherId, to: other._id }, { from: other._id, to: teacherId }] } })
        if (existing) throw new ConflictError(existing.status === "active" ? "You're already linked" : "A request is already waiting")
        await repos.teacherLink.create({ from: teacherId, to: other._id })
        return this.links(teacherId)
    }

    async answerLink(teacherId: string, linkId: string, accept: boolean) {
        const link = await repos.teacherLink.findone({ filter: { _id: linkId, to: teacherId, status: "pending" } })
        if (!link) throw new NotFoundError("Request not found")
        if (accept) await repos.teacherLink.updateone({ filter: { _id: linkId }, data: { $set: { status: "active" } } })
        else await repos.teacherLink.deleteone({ filter: { _id: linkId } })
        return this.links(teacherId)
    }

    async removeLink(teacherId: string, linkId: string) {
        const result = await repos.teacherLink.deleteone({ filter: { _id: linkId, $or: [{ from: teacherId }, { to: teacherId }] } })
        if (!result) throw new ForbiddenError()
        return this.links(teacherId)
    }
}

export default new TeacherService()
