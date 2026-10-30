import { Router } from "express"
import { z } from "zod"
import { BadRequestError, ConflictError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { roleEnum } from "../../common/enum/user.enum"
import { send } from "../../common/exceptions/successresponce"
import { centerPublic, DAY, inRangeFilter, normalizePhone, personName, sameId, sum, teacherPublic } from "../../common/service/helpers"
import { validation } from "../../common/service/validation"
import { params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { activeCenter, auth, platformScope, requireRole } from "../../middleware/auth.middleware"
import { closingTotals, slotViews } from "../shared/views"

const router: Router = Router()
const updateSchema = z.object({
    name: text(120).optional(),
    phone: z.string().trim().min(6).max(32).optional(),
    localphone: text(32).optional(),
    textlocation: text(300).optional(),
    Maplocation: text(1000).optional(),
})
const inviteSchema = z.object({ identifier: z.string().trim().min(1).max(254) })
const answerSchema = z.object({ status: z.enum(["active", "rejected"]) })

// A center sees counts and closings. It never receives student personal data.
const teacherView = async (link: any) => {
    const [teacher, studentsCount, sessions, slots] = await Promise.all([
        repos.teacher.findById({ id: link.teacher }),
        repos.enrollment.count({ teacher: link.teacher, center: link.center, status: "active", archived: false }),
        repos.session.findall({ filter: { teacher: link.teacher, center: link.center, status: "normal" }, select: "date presentCount", sort: { date: -1 }, limit: 1000 }),
        repos.schedule.findall({ filter: { teacher: link.teacher, center: link.center, isActive: true } }),
    ])
    return {
        teacher: { ...teacherPublic(teacher), phone: teacher?.phone },
        status: link.status,
        requestedBy: link.requestedBy,
        createdAt: link.createdAt,
        studentsCount,
        sessionsCount: sessions.length,
        attendanceCount: sum(sessions, (session) => session.presentCount),
        lastSessionAt: sessions[0]?.date ?? null,
        slots: await slotViews(slots),
    }
}

const linkOf = async (centerId: string, teacherId: string) => {
    const link = await repos.centerLink.findone({ filter: { center: centerId, teacher: teacherId } })
    if (!link) throw new NotFoundError("Request not found")
    return link
}

router.use(auth, requireRole(roleEnum.Center), platformScope, activeCenter)

router.get("/profile", send(async (req) => {
    const center = await repos.center.findById({ id: req.actor.id })
    return { ...centerPublic(center), referralId: center.referralId }
}))
router.patch("/profile", validation(updateSchema), send(async (req) => {
    if (req.body.phone) req.body.phone = normalizePhone(req.body.phone)
    return centerPublic(await repos.center.findByIdAndUpdate({ id: req.actor.id, data: { $set: req.body } }))
}, "Profile saved"))

router.get("/teachers", send(async (req) => {
    const links = await repos.centerLink.findall({ filter: { center: req.actor.id, status: { $ne: "rejected" } } })
    return Promise.all(links.map(teacherView))
}))
router.post("/teachers/invite", validation(inviteSchema), send(async (req) => {
    const needle = req.body.identifier
    const or: any[] = [{ userName: needle }, { email: needle.toLowerCase() }, { phone: normalizePhone(needle) }]
    if (/^[a-f\d]{24}$/i.test(needle)) or.push({ _id: needle })
    const teacher = await repos.teacher.findone({ filter: { $or: or, status: "active" } })
    if (!teacher) throw new NotFoundError("Teacher not found")
    const filter = { teacher: teacher._id, center: req.actor.id }
    const existing = await repos.centerLink.findone({ filter })
    if (existing?.status === "active") throw new ConflictError("This teacher already works with your center")
    const answersTeacher = existing?.status === "pending" && existing.requestedBy === "teacher"
    const link = await repos.centerLink.findOneAndUpdate({
        filter,
        data: { $set: answersTeacher ? { status: "active" } : { status: "pending", requestedBy: "center" } },
        options: { upsert: true },
    })
    return teacherView(link)
}, "Invitation sent", 201))
router.patch("/teachers/:id", validation(answerSchema), send(async (req) => {
    const link = await linkOf(req.actor.id, params(req.params.id))
    if (link.requestedBy !== "teacher") throw new BadRequestError("Waiting for the teacher to answer your invitation")
    return teacherView(await repos.centerLink.findByIdAndUpdate({ id: link._id, data: { $set: { status: req.body.status } } }))
}))
router.delete("/teachers/:id", send(async (req) => {
    await repos.centerLink.deleteone({ filter: { center: req.actor.id, teacher: params(req.params.id) } })
    return { id: req.params.id }
}))

const linkedTeachers = (centerId: string) => repos.centerLink.distinct("teacher", { center: centerId, status: "active" })

router.get("/schedule", send(async (req) => {
    const teachers = await linkedTeachers(req.actor.id)
    return slotViews(await repos.schedule.findall({ filter: { center: req.actor.id, teacher: { $in: teachers } } }))
}))
router.get("/sessions", send(async (req) => {
    const filter: any = { center: req.actor.id }
    const range = inRangeFilter(req.query.from, req.query.to)
    if (range) filter.date = range
    const sessions = await repos.session.findall({ filter, sort: { date: -1 }, limit: 500, populate: { path: "teacher" } })
    return sessions.map((session) => ({
        _id: session._id, sequence: session.sequence, week: session.week, number: session.number, date: session.date,
        status: session.status, active: session.active, teacher: teacherPublic(session.teacher),
        presentCount: session.presentCount, closing: closingTotals(session),
    }))
}))
router.get("/dashboard", send(async (req) => {
    const cid = req.actor.id
    const links = await repos.centerLink.findall({ filter: { center: cid } })
    const active = links.filter((link) => link.status === "active").map((link) => link.teacher)
    const weekAgo = new Date(Date.now() - 7 * DAY)
    const [sessions, students, today, teachers] = await Promise.all([
        repos.session.findall({ filter: { center: cid, status: "normal" }, sort: { date: -1 }, limit: 300 }),
        repos.enrollment.distinct("student", { center: cid, teacher: { $in: active }, status: "active", archived: false }),
        repos.schedule.findall({ filter: { center: cid, dayOfWeek: new Date().getDay(), isActive: true, teacher: { $in: active } } }),
        repos.teacher.findall({ filter: { _id: { $in: active } } }),
    ])
    const thisWeek = sessions.filter((session) => new Date(session.date) >= weekAgo)
    const nameOf = (id: unknown) => teacherPublic(teachers.find((teacher) => sameId(teacher._id, id)))
    return {
        counts: {
            teachers: active.length,
            pending: links.filter((link) => link.status === "pending" && link.requestedBy === "teacher").length,
            invitations: links.filter((link) => link.status === "pending" && link.requestedBy === "center").length,
            sessionsThisWeek: thisWeek.length,
            attendanceThisWeek: sum(thisWeek, (session) => session.presentCount),
            students: students.length,
        },
        closingsDue: sum(thisWeek, (session) => closingTotals(session)?.total ?? 0),
        today: await slotViews(today),
        activeSessions: sessions.filter((session) => session.active).map((session) => ({ _id: session._id, sequence: session.sequence, teacher: nameOf(session.teacher), presentCount: session.presentCount })),
        byTeacher: teachers.map((teacher) => ({ label: personName(teacher), value: sum(sessions.filter((session) => sameId(session.teacher, teacher._id)), (session) => session.presentCount) })),
        recentSessions: sessions.slice(0, 6).map((session) => ({ _id: session._id, sequence: session.sequence, date: session.date, teacher: nameOf(session.teacher), presentCount: session.presentCount, closing: closingTotals(session) })),
    }
}))

export default router
