import { Router } from "express"
import { z } from "zod"
import { send } from "../../common/exceptions/successresponce"
import { pick, sameId } from "../../common/service/helpers"
import { centerNames, missingStudent, peopleRefs, refOf, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { objectId, optionalId, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { sessionLabel } from "../shared/views"

const router: Router = Router()
const commentSchema = z.object({ student: objectId, session: optionalId, comment: z.string().trim().min(1).max(2000) })
const assignSchema = z.object({ assistant: optionalId, students: z.array(objectId).max(5000) })

router.use("/follow-up", requireFeature("follow_up"), can("follow_up"))

router.get("/follow-up", send(async (req) => {
    const sessions = await repos.session.findall({ filter: { status: "normal" }, sort: { date: -1 }, limit: 40 })
    const session = (req.query.session && sessions.find((item) => sameId(item._id, req.query.session))) || sessions.find((item) => !item.active) || sessions[0]
    const mine = req.actor.role === "assistant" && req.query.mine === "1"
    const filter: any = { status: "active", archived: false }
    if (session?.center) filter.center = session.center
    if (mine) filter.followUpAssistant = req.actor.id
    const roster = await repos.enrollment.findall({ filter })
    const ids = roster.map((entry) => entry.student)
    const recent = sessions.filter((item) => !session?.center || sameId(item.center, session.center)).slice(0, 4)
    const [students, people, attendance, recentRows, exam, comments, assistants, centers] = await Promise.all([
        studentRefs(ids),
        peopleRefs(roster.map((entry) => entry.followUpAssistant)),
        session ? repos.attendance.findall({ filter: { session: session._id } }) : Promise.resolve([]),
        repos.attendance.findall({ filter: { session: { $in: recent.map((item) => item._id) }, student: { $in: ids } }, select: "session student" }),
        session ? repos.exam.findone({ filter: { session: session._id } }) : Promise.resolve(null),
        repos.followComment.aggregate([
            { $match: { student: { $in: ids } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: "$student", comment: { $first: "$comment" }, by: { $first: "$by" }, createdAt: { $first: "$createdAt" } } },
        ]),
        repos.assistant.findall({ select: "firstName lastName userName phone" }),
        centerNames([session?.center]),
    ])
    const commenters = await peopleRefs(comments.map((row) => row.by))
    return {
        sessions: sessions.map((item) => ({ _id: item._id, label: sessionLabel(item), date: item.date })),
        session: session ? { _id: session._id, label: sessionLabel(session), date: session.date, centerName: session.center ? centers.get(String(session.center)) ?? "" : "" } : null,
        exam: exam ? pick(exam, ["_id", "name", "maxScore"]) : null,
        assistants: assistants.map((assistant) => ({ _id: assistant._id, name: [assistant.firstName, assistant.lastName].filter(Boolean).join(" ") || assistant.userName, phone: assistant.phone })),
        rows: roster.map((entry) => {
            const row = attendance.find((item) => sameId(item.student, entry.student))
            const comment = comments.find((item) => sameId(item._id, entry.student))
            const attendedRecent = recentRows.filter((item) => sameId(item.student, entry.student)).length
            return {
                student: missingStudent(students, entry.student),
                balance: entry.balance,
                attended: Boolean(row),
                homeworkStatus: row?.homeworkStatus ?? null,
                examScore: exam ? exam.results.find((result: any) => sameId(result.student, entry.student))?.score ?? null : undefined,
                absences: recent.length - attendedRecent,
                assignedTo: refOf(people, entry.followUpAssistant),
                lastComment: comment ? { comment: comment.comment, byName: refOf(commenters, comment.by)?.name, createdAt: comment.createdAt } : null,
            }
        }),
    }
}))
router.post("/follow-up/comments", validation(commentSchema), send(async (req) => {
    const item = await repos.followComment.create({ ...req.body, by: req.actor.id })
    const people = await peopleRefs([req.actor.id])
    return { ...item.toObject(), byName: refOf(people, req.actor.id)?.name }
}, "Note saved", 201))
router.put("/follow-up/assign", validation(assignSchema), send(async (req) => {
    const result = await repos.enrollment.updateMany({ filter: { student: { $in: req.body.students } }, data: { $set: { followUpAssistant: req.body.assistant } } })
    return { updated: result.modifiedCount }
}))

export default router
