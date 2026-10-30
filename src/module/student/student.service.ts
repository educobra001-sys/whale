import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { markActive } from "../../common/service/activity"
import { DAY, pick, personName, sameId, studentPublic, sum, teacherPublic } from "../../common/service/helpers"
import { centerNames } from "../../common/service/lookups"
import { runAsPlatform, runWithTeacher } from "../../common/service/tenantContext"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { homeworkView } from "../homework/homework.controller"
import { announcementsFor, leaderboard, lessonAccess, studentExamRows, studentSessionRows, studentStats } from "../shared/reports"
import { slotViews, transactionViews } from "../shared/views"

const LESSON_CARD = ["_id", "title", "description", "week", "order", "isFree", "price"]

class StudentService {
    profile(id: string) {
        return repos.student.findById({ id }).then((student) => ({ ...studentPublic(student), referralId: student?.referralId }))
    }

    async updateProfile(id: string, data: any) {
        await repos.student.updateone({ filter: { _id: id }, data: { $set: data } })
        return this.profile(id)
    }

    async teachers(id: string) {
        const entries = await repos.enrollment.findall({ filter: { student: id, archived: false }, populate: { path: "teacher" } })
        return entries.map((entry) => ({
            teacher: teacherPublic(entry.teacher),
            status: entry.status,
            joinedAt: entry.joinedAt,
            balance: entry.status === "active" ? entry.balance : null,
        }))
    }

    async request(studentId: string, teacherId: string) {
        const teacher = await repos.teacher.findone({ filter: { _id: teacherId, status: "active" }, select: "visibility" })
        if (!teacher) throw new NotFoundError("Teacher not found")
        const existing = await repos.enrollment.findone({ filter: { teacher: teacherId, student: studentId } })
        if (existing && !existing.archived) throw new ConflictError(existing.status === "active" ? "You're already subscribed" : "Your request is already waiting for approval")
        if (teacher.visibility !== "public" && !existing) throw new NotFoundError("Teacher not found")
        if (existing) await repos.enrollment.updateone({ filter: { _id: existing._id }, data: { $set: { archived: false, status: "pending", joinedAt: new Date() } } })
        else await repos.enrollment.create({ teacher: teacherId, student: studentId, status: "pending" })
        return { status: "pending" }
    }

    async cancelRequest(studentId: string, teacherId: string) {
        await repos.enrollment.deleteone({ filter: { teacher: teacherId, student: studentId, status: "pending" } })
        return { status: "none" }
    }

    // ---------- inside one teacher's scope ----------
    async overview(entry: any) {
        const teacherId = String(entry.teacher)
        const [teacher, person, board, slots, warnings, sessions] = await Promise.all([
            runAsPlatform(() => repos.teacher.findById({ id: teacherId })),
            repos.student.findById({ id: entry.student, select: "grade" }),
            leaderboard(),
            repos.schedule.findall({ filter: { isActive: true, ...(entry.center ? { center: entry.center } : {}) } }),
            repos.warning.findall({ filter: { student: entry.student } }),
            studentSessionRows(entry.student, entry),
        ])
        const exams = await studentExamRows(entry.student, person?.grade)
        const now = new Date()
        const minutesNow = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes()
        const views = await slotViews(slots)
        const nextSlot = views.map((slot) => {
            const [hours = 0, minutes = 0] = slot.startTime.split(":").map(Number)
            let delta = slot.dayOfWeek * 1440 + hours * 60 + minutes - minutesNow
            if (delta < 0) delta += 7 * 1440
            return { ...slot, startsInMinutes: delta }
        }).sort((a, b) => a.startsInMinutes - b.startsInMinutes)[0]
        const assistant = entry.followUpAssistant ? await repos.assistant.findById({ id: entry.followUpAssistant, select: "firstName lastName userName phone" }) : null
        const centers = await centerNames([entry.center])
        return {
            teacher: teacherPublic(teacher),
            balance: entry.balance,
            pricePerSession: entry.pricePerSession,
            points: entry.points,
            rank: board.findIndex((row) => sameId(row.student._id, entry.student)) + 1,
            classSize: board.length,
            isBlocked: entry.isBlocked,
            centerName: entry.center ? centers.get(String(entry.center)) ?? "" : "",
            warnings: warnings.map((warning) => ({ reason: warning.reason, createdAt: warning.createdAt })),
            nextSlot: nextSlot ?? null,
            lastSession: sessions.find((row) => row.status !== "cancelled") ?? null,
            stats: studentStats(sessions, exams),
            announcements: await announcementsFor(entry, person?.grade),
            followUp: assistant ? { name: personName(assistant), phone: assistant.phone } : null,
        }
    }

    sessions = (entry: any) => studentSessionRows(entry.student, entry)

    async exams(entry: any) {
        const person = await repos.student.findById({ id: entry.student, select: "grade" })
        return studentExamRows(entry.student, person?.grade)
    }

    async lessons(entry: any) {
        const person = await repos.student.findById({ id: entry.student, select: "grade" })
        const lessons = await repos.lesson.findall({ filter: { published: true, grade: { $in: ["", person?.grade ?? ""] } }, sort: { week: 1, order: 1 } })
        const watch = await repos.watch.findall({ filter: { student: entry.student } })
        return Promise.all(lessons.map(async (lesson) => ({
            ...pick(lesson, LESSON_CARD),
            partsCount: lesson.parts.length,
            questionsCount: lesson.questions.filter((question: any) => question.isActive).length,
            durationSeconds: sum(lesson.parts, (part: any) => part.durationSeconds),
            access: await lessonAccess(lesson, entry.student, entry),
            watchedSeconds: sum(watch.filter((row) => sameId(row.lesson, lesson._id)), (row) => row.seconds),
        })))
    }

    async lesson(lesson: any, entry: any) {
        const access = await lessonAccess(lesson, entry.student, entry)
        const open = access.state === "free" || access.state === "granted"
        const [answers, progress, teacher] = await Promise.all([
            repos.lessonAnswer.findall({ filter: { lesson: lesson._id, student: entry.student } }),
            repos.watch.findall({ filter: { lesson: lesson._id, student: entry.student } }),
            runAsPlatform(() => repos.teacher.findById({ id: lesson.teacher })),
        ])
        return {
            ...pick(lesson, ["_id", "title", "description", "week", "isFree", "price", "accessHours", "viewsIfPaid", "viewsIfAttended"]),
            teacher: teacherPublic(teacher),
            access,
            // Video links leave the server only while access is open.
            parts: lesson.parts.map((part: any) => ({ ...part, url: open ? part.url : null })),
            questions: open
                ? lesson.questions.filter((question: any) => question.isActive).map((question: any) => {
                    const answer = answers.find((item) => sameId(item.question, question._id))
                    return { ...question, correct: answer ? question.correct : undefined, answer: answer ?? null }
                })
                : [],
            progress,
        }
    }

    async unlock(teacherId: string, lesson: any, entry: any, studentId: string) {
        const startedAt = new Date()
        const expiresAt = new Date(startedAt.getTime() + lesson.accessHours * 3600000)
        const grant = (method: string, maxViews: number) => repos.lessonGrant.create({ lesson: lesson._id, student: entry.student, method, maxViews, startedAt, expiresAt })
        // Both unlocks of a double tap write the same enrollment, so the loser is retried here and finds the grant.
        const balance = await withTransaction(async () => {
            const access = await lessonAccess(lesson, entry.student, entry)
            if (access.state === "free" || access.state === "granted") return null
            if (access.state === "available") {
                await grant("attended", lesson.viewsIfAttended)
                return null
            }
            const updated = await repos.enrollment.findOneAndUpdate({
                filter: { _id: entry._id, balance: { $gte: lesson.price } },
                data: { $inc: { balance: -lesson.price } },
            })
            if (!updated) throw new ConflictError(`Not enough balance. The lesson costs ${lesson.price} and you have ${entry.balance}.`, { code: "INSUFFICIENT_BALANCE" })
            await repos.transaction.create({ student: entry.student, amount: -lesson.price, type: "lesson", reason: `Lesson unlocked · ${lesson.title}`, by: studentId })
            await grant("paid", lesson.viewsIfPaid)
            return updated.balance as number
        })
        if (balance !== null) await markActive(teacherId, entry.student, "lesson")
        const current = balance ?? entry.balance
        return { access: await lessonAccess(lesson, entry.student, { ...entry, balance: current }), balance: current }
    }

    async progress(lesson: any, entry: any, body: any) {
        const access: any = await lessonAccess(lesson, entry.student, entry)
        if (body.start && access.state === "granted") {
            const grant = await repos.lessonGrant.findById({ id: access.grantId })
            const set: any = {}
            if (!grant.startedAt) {
                set.startedAt = new Date()
                set.expiresAt = new Date(Date.now() + (grant.hours || lesson.accessHours) * 3600000)
            }
            await repos.lessonGrant.updateone({ filter: { _id: grant._id }, data: { $inc: { viewsUsed: 1 }, ...(grant.startedAt ? {} : { $set: set }) } })
        }
        if (body.part) {
            await repos.watch.updateone({
                filter: { lesson: lesson._id, student: entry.student, part: body.part },
                data: { $max: { seconds: Number(body.seconds) || 0 } },
                options: { upsert: true },
            }).catch((error) => {
                if (error?.code !== 11000) throw error
            })
        }
        return { access: await lessonAccess(lesson, entry.student, entry) }
    }

    async answer(lesson: any, entry: any, questionId: string, body: any) {
        const question = lesson.questions.find((item: any) => sameId(item._id, questionId))
        const existing = await repos.lessonAnswer.findone({ filter: { question: questionId, student: entry.student } })
        if (existing) return { ...existing, correct: question.correct }
        const answer: any = { question: questionId, lesson: lesson._id, student: entry.student, choice: body.choice ?? null, imageUrl: body.imageUrl ?? "" }
        if (question.type === "mcq") {
            if (!body.choice) throw new BadRequestError("Choose an answer")
            const correct = body.choice === question.correct
            Object.assign(answer, { status: "answered", isCorrect: correct, points: correct ? question.bonusPoints : 0 })
        } else {
            if (!body.imageUrl && !body.text) throw new BadRequestError("Upload a photo of your answer")
            Object.assign(answer, { status: "pending", isCorrect: null, points: 0, text: body.text ?? "" })
        }
        const saved = await repos.lessonAnswer.create(answer).catch(async (error) => {
            if (error?.code === 11000) return repos.lessonAnswer.findone({ filter: { question: questionId, student: entry.student } })
            throw error
        })
        const row = saved.toObject ? saved.toObject() : saved
        if (saved.toObject && answer.points) {
            await repos.enrollment.updateone({ filter: { _id: entry._id }, data: { $inc: { points: answer.points } } })
            await repos.pointsLog.create({ student: entry.student, points: answer.points, reason: `Video question · ${lesson.title}`, by: "system" })
        }
        return { ...row, correct: question.correct }
    }

    async homework(entry: any) {
        const person = await repos.student.findById({ id: entry.student, select: "grade" })
        const list = await repos.homework.findall({ filter: { grade: { $in: ["", person?.grade ?? ""] } }, sort: { order: -1 } })
        const subs = await repos.submission.findall({ filter: { student: entry.student } })
        return Promise.all(list.map(async (hw) => ({ ...(await homeworkView(hw)), submission: subs.find((sub) => sameId(sub.homework, hw._id)) ?? null })))
    }

    async submitHomework(hw: any, entry: any, body: any) {
        if (new Date(hw.endDate).getTime() + DAY < Date.now()) throw new BadRequestError("The deadline for this homework has passed")
        const existing = await repos.submission.findone({ filter: { homework: hw._id, student: entry.student } })
        if (existing && existing.status !== "submitted") throw new ConflictError("Your homework was already corrected")
        if (hw.submissionType === "upload" && !body.files?.length) throw new BadRequestError("Upload at least one photo or PDF")
        await repos.submission.updateone({
            filter: { homework: hw._id, student: entry.student },
            data: { $set: { files: body.files ?? [], comment: body.comment ?? "", link: body.link ?? "", status: "submitted", submittedAt: new Date() } },
            options: { upsert: true },
        })
        return { submitted: true }
    }

    async booklets(entry: any) {
        const person = await repos.student.findById({ id: entry.student, select: "grade" })
        const booklets = await repos.booklet.findall({ filter: { isActive: true, grade: { $in: ["", person?.grade ?? ""] } } })
        const orders = await repos.bookletOrder.findall({ filter: { student: entry.student }, sort: { createdAt: -1 } })
        return booklets.map((booklet) => ({
            booklet: pick(booklet, ["_id", "name", "sellPrice", "grade", "stock"]),
            order: orders.find((order) => sameId(order.booklet, booklet._id)) ?? null,
        }))
    }

    async reserve(booklet: any, entry: any, body: any) {
        if (await repos.bookletOrder.exists({ booklet: booklet._id, student: entry.student, status: { $ne: "rejected" } })) throw new ConflictError("You already reserved this booklet")
        const transfer = body.method === "transfer"
        if (transfer && !body.receiptUrl) throw new BadRequestError("Upload the transfer receipt")
        const order = await repos.bookletOrder.create({
            booklet: booklet._id, student: entry.student, price: booklet.sellPrice,
            paid: transfer ? booklet.sellPrice : 0, method: transfer ? "transfer" : "center",
            status: "pending", receiptUrl: body.receiptUrl ?? "", reference: body.reference ?? "",
        })
        return order.toObject()
    }

    async transactions(entry: any) {
        return transactionViews(await repos.transaction.findall({ filter: { student: entry.student }, sort: { createdAt: -1 }, limit: 300 }))
    }

    async board(entry: any) {
        const rows = await leaderboard()
        return rows.map((row) => {
            const mine = sameId(row.student._id, entry.student)
            return {
                rank: row.rank,
                // Classmates are shown by first name and initial only.
                name: mine ? personName(row.student) : `${row.student.firstName ?? ""} ${String(row.student.lastName ?? "").charAt(0)}.`,
                points: row.points,
                isMe: mine,
                centerName: row.centerName,
            }
        })
    }

    async recharge(studentId: string, code: string) {
        const key = code.trim().toUpperCase()
        const found = await repos.rechargeCode.findone({ filter: { code: key } })
        if (!found) throw new NotFoundError("This code doesn't exist. Check it and try again.")
        if (found.used) throw new ConflictError("This code was already used")
        const teacherId = String(found.teacher)
        const entry = await repos.enrollment.findone({ filter: { teacher: teacherId, student: studentId, status: "active", archived: false } })
        if (!entry) throw new ForbiddenError("This code belongs to a teacher you're not subscribed to")
        const balance = await withTransaction(async () => {
            // Claiming the code first means it can only ever be redeemed once.
            const claimed = await repos.rechargeCode.findOneAndUpdate({
                filter: { _id: found._id, used: false },
                data: { $set: { used: true, usedBy: studentId, usedAt: new Date() } },
            })
            if (!claimed) throw new ConflictError("This code was already used")
            const updated = await repos.enrollment.findByIdAndUpdate({ id: entry._id, data: { $inc: { balance: found.amount } } })
            await repos.transaction.create({ teacher: teacherId, student: studentId, amount: found.amount, type: "recharge", reason: `Recharge code ${found.code}`, by: studentId })
            return updated.balance
        })
        await runWithTeacher(teacherId, () => markActive(teacherId, studentId, "recharge"))
        return { amount: found.amount, balance, teacher: teacherPublic(await repos.teacher.findById({ id: teacherId })) }
    }

    async topup(entry: any, body: any) {
        const row = await repos.topup.create({
            student: entry.student, amount: body.amount, method: body.method ?? "Transfer",
            reference: body.reference ?? "", receiptUrl: body.receiptUrl,
        })
        return row.toObject()
    }

    async parentReport(studentId: string, teacherId?: string) {
        const entries = await repos.enrollment.findall({ filter: { student: studentId, status: "active", archived: false } })
        const entry = entries.find((item) => sameId(item.teacher, teacherId)) ?? entries[0]
        const teachers = await repos.teacher.findall({ filter: { _id: { $in: entries.map((item) => item.teacher) } } })
        if (!entry) return { teachers: [], teacher: null }
        const id = String(entry.teacher)
        return runWithTeacher(id, async () => {
            const person = await repos.student.findById({ id: studentId, select: "grade" })
            const [sessions, exams, transactions, warnings, comment, assistant, centers] = await Promise.all([
                studentSessionRows(studentId, entry),
                studentExamRows(studentId, person?.grade),
                repos.transaction.findall({ filter: { student: studentId }, sort: { createdAt: -1 }, limit: 30 }),
                repos.warning.findall({ filter: { student: studentId } }),
                repos.followComment.findone({ filter: { student: studentId }, sort: { createdAt: -1 } }),
                entry.followUpAssistant ? repos.assistant.findById({ id: entry.followUpAssistant }) : Promise.resolve(null),
                centerNames([entry.center]),
            ])
            const teacher = teachers.find((item) => sameId(item._id, id))
            return {
                teachers: teachers.map(teacherPublic),
                teacher: teacherPublic(teacher),
                balance: entry.balance,
                points: entry.points,
                isBlocked: entry.isBlocked,
                centerName: entry.center ? centers.get(String(entry.center)) ?? "" : "",
                stats: studentStats(sessions, exams),
                sessions,
                exams,
                transactions: await transactionViews(transactions),
                warnings: warnings.map((warning) => ({ reason: warning.reason, createdAt: warning.createdAt })),
                followUp: {
                    assistant: assistant ? { name: personName(assistant), phone: assistant.phone } : null,
                    lastComment: comment ? { comment: comment.comment, createdAt: comment.createdAt } : null,
                    teacherPhone: teacher?.phone,
                },
            }
        })
    }
}

export default new StudentService()
