// Per-student reports shared by the teacher, student and parent portals. All of them run inside a teacher scope.
import { sameId, sum } from "../../common/service/helpers"
import { centerNames, peopleRefs, refOf } from "../../common/service/lookups"
import { repos } from "../../db/repository"
import { examStats } from "./views"

export const studentSessionRows = async (studentId: any, entry: any) => {
    const filter: any = entry?.center
        ? { $or: [{ center: entry.center }, { center: null }] }
        : {}
    const [sessions, rows] = await Promise.all([
        repos.session.findall({ filter, sort: { date: -1 }, limit: 200 }),
        repos.attendance.findall({ filter: { student: studentId }, sort: { markedAt: -1 }, limit: 400 }),
    ])
    const known = new Set(sessions.map((session) => String(session._id)))
    const extra = rows.filter((row) => !known.has(String(row.session))).map((row) => row.session)
    const others = extra.length ? await repos.session.findall({ filter: { _id: { $in: extra } } }) : []
    const all = [...sessions, ...others].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const byId = new Map(rows.map((row) => [String(row.session), row]))
    const [centers, people] = await Promise.all([
        centerNames([...all.map((session) => session.center), ...rows.map((row) => row.location)]),
        peopleRefs(rows.map((row) => row.markedBy)),
    ])
    const joined = entry?.joinedAt ? new Date(entry.joinedAt).getTime() : 0
    return all
        .filter((session) => byId.has(String(session._id)) || new Date(session.date).getTime() >= joined)
        .map((session) => {
            const row = byId.get(String(session._id))
            return {
                session: { _id: session._id, sequence: session.sequence, week: session.week, number: session.number, date: session.date, centerName: session.center ? centers.get(String(session.center)) ?? "" : "" },
                status: session.status === "cancelled" ? "cancelled" : row ? "present" : session.active ? "pending" : "absent",
                markedAt: row?.markedAt ?? null,
                payment: row?.payment ?? 0,
                charged: row?.charged ?? 0,
                comment: row?.comment ?? "",
                homeworkStatus: row?.homeworkStatus ?? null,
                location: row?.location ? centers.get(String(row.location)) ?? "" : "",
                markedBy: row ? refOf(people, row.markedBy) : null,
            }
        })
}

export const studentExamRows = async (studentId: any, grade: string | undefined) => {
    const exams = await repos.exam.findall({
        filter: { $or: [{ grade: "" }, { grade: grade ?? "" }, { "results.student": studentId }] },
        sort: { date: -1 },
        limit: 200,
    })
    return exams.map((exam) => {
        const row = exam.results.find((item: any) => sameId(item.student, studentId))
        const ranked = exam.results.filter((item: any) => item.score !== null).sort((a: any, b: any) => b.score - a.score)
        return {
            exam: { _id: exam._id, name: exam.name, maxScore: exam.maxScore, date: exam.date },
            score: row ? row.score : null,
            rank: row ? ranked.findIndex((item: any) => sameId(item.student, studentId)) + 1 : null,
            participants: ranked.length,
            stats: examStats(exam.results),
        }
    })
}

export const studentStats = (sessionRows: any[], examRows: any[]) => {
    const counted = sessionRows.filter((row) => row.status === "present" || row.status === "absent")
    const present = counted.filter((row) => row.status === "present")
    const checked = present.filter((row) => row.homeworkStatus)
    const exams = examRows.filter((row) => row.score !== null)
    return {
        present: present.length,
        absent: counted.length - present.length,
        attendanceRate: counted.length ? Math.round((present.length / counted.length) * 100) : 0,
        homeworkRate: checked.length ? Math.round((checked.filter((row) => row.homeworkStatus === "complete").length / checked.length) * 100) : 0,
        examAvg: exams.length ? Math.round(sum(exams, (row) => (row.score / row.exam.maxScore) * 100) / exams.length) : 0,
    }
}

export const lessonAccess = async (lesson: any, studentId: any, entry?: any) => {
    if (lesson.isFree) return { state: "free" }
    const grant = await repos.lessonGrant.findone({ filter: { lesson: lesson._id, student: studentId }, sort: { createdAt: -1 } })
    if (grant) {
        if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) return { state: "expired", grantId: grant._id, price: lesson.price }
        if (grant.viewsUsed >= grant.maxViews) return { state: "exhausted", grantId: grant._id, price: lesson.price }
        return { state: "granted", grantId: grant._id, method: grant.method, viewsLeft: grant.maxViews - grant.viewsUsed, maxViews: grant.maxViews, expiresAt: grant.expiresAt, startsOnOpen: !grant.startedAt }
    }
    if (lesson.sessions?.length && await repos.attendance.exists({ student: studentId, session: { $in: lesson.sessions } })) {
        return { state: "available", method: "attended", views: lesson.viewsIfAttended, hours: lesson.accessHours }
    }
    return { state: "locked", price: lesson.price, views: lesson.viewsIfPaid, hours: lesson.accessHours, balance: entry?.balance ?? 0 }
}

export const leaderboard = async () => {
    const entries = await repos.enrollment.findall({
        filter: { status: "active", archived: false },
        select: "student points center",
        sort: { points: -1 },
        limit: 500,
    })
    const [students, centers] = await Promise.all([
        repos.student.findall({ filter: { _id: { $in: entries.map((entry) => entry.student) } }, select: "userID firstName lastName grade profilepic" }),
        centerNames(entries.map((entry) => entry.center)),
    ])
    return entries.map((entry, index) => ({
        rank: index + 1,
        student: students.find((student) => sameId(student._id, entry.student)) ?? { _id: entry.student },
        points: entry.points,
        centerName: entry.center ? centers.get(String(entry.center)) ?? "" : "",
    }))
}

export const announcementsFor = async (entry: any, grade?: string) => {
    const items = await repos.announcement.findall({ filter: { isActive: true }, sort: { pinned: -1, createdAt: -1 }, limit: 50 })
    return items
        .filter((item) => !item.audience?.grades?.length || item.audience.grades.includes(String(grade)))
        .filter((item) => !item.audience?.centers?.length || item.audience.centers.includes(String(entry?.center)))
}
