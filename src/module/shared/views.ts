import { centerPublic, sameId, studentPublic, sum, teacherPublic } from "../../common/service/helpers"
import { centerNames, peopleRefs, missingStudent, refOf, studentRefs } from "../../common/service/lookups"
import { repos } from "../../db/repository"

export const sessionLabel = (session: any) => `Week ${session?.week ?? "?"} · #${session?.number ?? "?"} · ${session?.sequence ?? ""}`

export const closingTotals = (session: any) => {
    const closing = session.closing
    if (!closing) return null
    const present = session.presentCount ?? 0
    const reduced = Math.min(present, Number(closing.reducedCount) || 0)
    const normal = present - reduced
    return {
        ...closing,
        present,
        normalCount: normal,
        reducedCount: reduced,
        total: normal * (Number(closing.normalCost) || 0) + reduced * (Number(closing.reducedCost) || 0),
    }
}

// Student fields merged with this teacher's enrollment, for many students at once.
export const studentViews = async (entries: any[]) => {
    if (!entries.length) return []
    const ids = entries.map((entry) => entry.student)
    const [students, centers, people, warnings, attended] = await Promise.all([
        repos.student.findall({ filter: { _id: { $in: ids } } }),
        centerNames(entries.map((entry) => entry.center)),
        peopleRefs(entries.map((entry) => entry.followUpAssistant)),
        repos.warning.aggregate([{ $match: { student: { $in: ids } } }, { $group: { _id: "$student", count: { $sum: 1 } } }]),
        repos.attendance.aggregate([{ $match: { student: { $in: ids } } }, { $group: { _id: "$student", last: { $max: "$markedAt" } } }]),
    ])
    const byStudent = new Map(students.map((student) => [String(student._id), student]))
    const warningCount = new Map(warnings.map((row) => [String(row._id), row.count]))
    const lastSeen = new Map(attended.map((row) => [String(row._id), row.last]))
    return entries.map((entry) => ({
        ...studentPublic(byStudent.get(String(entry.student))),
        enrollmentId: entry._id,
        status: entry.status,
        balance: entry.balance,
        points: entry.points,
        isBlocked: entry.isBlocked,
        pricePerSession: entry.pricePerSession,
        center: entry.center,
        centerName: entry.center ? centers.get(String(entry.center)) ?? "" : "",
        adminNote: entry.adminNote,
        followUpAssistant: entry.followUpAssistant,
        followUpAssistantName: refOf(people, entry.followUpAssistant)?.name ?? "",
        warningsCount: warningCount.get(String(entry.student)) ?? 0,
        joinedAt: entry.joinedAt,
        lastAttendedAt: lastSeen.get(String(entry.student)) ?? null,
    }))
}

export const studentView = async (entry: any) => (await studentViews([entry]))[0]

export const attendanceRows = async (rows: any[]) => {
    const [students, people] = await Promise.all([
        studentRefs(rows.map((row) => row.student)),
        peopleRefs(rows.map((row) => row.markedBy)),
    ])
    return rows.map((row) => ({ ...row, student: missingStudent(students, row.student), markedBy: refOf(people, row.markedBy) }))
}

export const sessionView = async (session: any, { withRows = true } = {}) => {
    const [names, assistants, rows] = await Promise.all([
        centerNames([session.center]),
        repos.assistant.findall({ filter: { _id: { $in: (session.staff ?? []).map((row: any) => row.assistant) } }, select: "firstName lastName userName phone" }),
        withRows ? repos.attendance.findall({ filter: { session: session._id }, sort: { markedAt: 1 } }) : Promise.resolve([]),
    ])
    return {
        ...session,
        centerName: session.center ? names.get(String(session.center)) ?? "" : "",
        attendance: await attendanceRows(rows),
        staff: (session.staff ?? []).map((row: any) => ({
            ...row,
            assistant: assistants.find((item) => sameId(item._id, row.assistant)) ?? { _id: row.assistant },
            minutes: row.checkIn && row.checkOut ? Math.round((new Date(row.checkOut).getTime() - new Date(row.checkIn).getTime()) / 60000) : null,
        })),
        closing: closingTotals(session),
    }
}

export const slotViews = async (slots: any[]) => {
    const names = await centerNames(slots.map((slot) => slot.center))
    const teachers = await repos.teacher.findall({ filter: { _id: { $in: slots.map((slot) => slot.teacher) } } })
    return slots.map((slot) => ({
        ...slot,
        centerName: slot.center ? names.get(String(slot.center)) ?? "" : "",
        teacher: teacherPublic(teachers.find((teacher) => sameId(teacher._id, slot.teacher))),
    }))
}

export const transactionViews = async (transactions: any[]) => {
    const [students, people] = await Promise.all([
        studentRefs(transactions.map((row) => row.student)),
        peopleRefs(transactions.map((row) => row.by)),
    ])
    return transactions.map((row) => ({ ...row, student: missingStudent(students, row.student), byName: refOf(people, row.by)?.name ?? "" }))
}

export const examStats = (results: any[]) => {
    const scores = results.map((row) => row.score).filter((score) => score !== null && score !== undefined)
    if (!scores.length) return { count: 0, avg: 0, max: 0, min: 0 }
    return {
        count: scores.length,
        avg: Math.round((sum(scores, (score) => score) / scores.length) * 10) / 10,
        max: Math.max(...scores),
        min: Math.min(...scores),
    }
}

export { centerPublic, teacherPublic }
