import { Router } from "express"
import { Types } from "mongoose"
import { z } from "zod"
import { NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { pick, sameId, sum } from "../../common/service/helpers"
import { missingStudent, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { money, objectId, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { sessionLabel } from "../shared/views"

const router: Router = Router()
const id = (req: any, key = "id") => params(req.params[key])

const partSchema = z.object({
    _id: z.string().optional(),
    category: text(40).optional(),
    title: text(200).optional(),
    url: text(2048).optional(),
    durationSeconds: z.coerce.number().min(0).optional(),
})
const questionSchema = z.object({
    _id: z.string().optional(),
    type: z.enum(["mcq", "essay"]),
    text: text(4000).optional(),
    imageUrl: text(2048).optional(),
    options: z.array(text(500)).max(10).optional(),
    correct: text(500).optional(),
    bonusPoints: z.coerce.number().min(0).max(100000).optional(),
    triggerSeconds: z.coerce.number().min(0).optional(),
    part: text(40).optional(),
    isActive: z.boolean().optional(),
    solutionUrl: text(2048).optional(),
})
const lessonSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: text(4000).optional(),
    week: z.coerce.number().int().min(0).max(100).optional(),
    order: z.coerce.number().int().min(0).max(10000).optional(),
    grade: z.string().max(4).optional(),
    isFree: z.boolean().optional(),
    price: money.optional(),
    viewsIfAttended: z.coerce.number().int().min(0).max(1000).optional(),
    viewsIfPaid: z.coerce.number().int().min(0).max(1000).optional(),
    accessHours: z.coerce.number().min(0).max(100000).optional(),
    sessions: z.array(objectId).max(100).optional(),
    published: z.boolean().optional(),
    parts: z.array(partSchema).max(100).optional(),
    questions: z.array(questionSchema).max(200).optional(),
})
const grantSchema = z.object({ student: objectId, maxViews: z.coerce.number().int().min(0).optional(), hours: z.coerce.number().min(0).optional() })
const gradeSchema = z.object({ isCorrect: z.boolean().optional(), points: z.coerce.number().min(0).max(100000).optional() })
const FIELDS = ["title", "description", "week", "order", "grade", "isFree", "price", "viewsIfAttended", "viewsIfPaid", "accessHours", "sessions", "published"]

const validId = (value?: string) => (value && Types.ObjectId.isValid(value) ? value : new Types.ObjectId())

const normalized = (body: any) => {
    const out: any = {}
    if (body.parts) out.parts = body.parts.map((part: any, index: number) => ({ ...part, _id: validId(part._id), category: part.category || "explanation", title: part.title || `Part ${index + 1}`, url: part.url ?? "", durationSeconds: part.durationSeconds ?? 0, order: index + 1 }))
    if (body.questions) out.questions = body.questions.map((question: any) => ({ ...question, _id: validId(question._id), bonusPoints: question.bonusPoints ?? 0, triggerSeconds: question.triggerSeconds ?? 0 }))
    return out
}

const lessonView = async (lesson: any) => {
    const [sessions, grants, viewers, pendingAnswers] = await Promise.all([
        repos.session.findall({ filter: { _id: { $in: lesson.sessions } } }),
        repos.lessonGrant.findall({ filter: { lesson: lesson._id } }),
        repos.watch.distinct("student", { lesson: lesson._id }),
        repos.lessonAnswer.count({ lesson: lesson._id, status: "pending" }),
    ])
    const students = await studentRefs(grants.map((grant) => grant.student))
    return {
        ...lesson,
        sessionLabels: lesson.sessions.map((sessionId: unknown) => {
            const session = sessions.find((item) => sameId(item._id, sessionId))
            return { _id: sessionId, label: session ? sessionLabel(session) : "Removed session" }
        }),
        grants: grants.map((grant) => ({ ...grant, student: missingStudent(students, grant.student) })),
        stats: { viewers: viewers.length, grants: grants.length, pendingAnswers, durationSeconds: sum(lesson.parts, (part: any) => part.durationSeconds) },
    }
}

const own = async (lessonId: string) => {
    const lesson = await repos.lesson.findById({ id: lessonId })
    if (!lesson) throw new NotFoundError("Lesson not found")
    return lesson
}

router.use("/lessons", requireFeature("lessons"), can("lessons"))
router.get("/lessons", send(async () => Promise.all((await repos.lesson.findall({ sort: { week: 1, order: 1 } })).map(lessonView))))
router.post("/lessons", validation(lessonSchema), send(async (req) => {
    const order = req.body.order ?? (await repos.lesson.count({})) + 1
    const lesson = await repos.lesson.create({ ...pick(req.body, FIELDS), ...normalized(req.body), order })
    return lessonView(lesson.toObject())
}, "Lesson added", 201))
router.patch("/lessons/answers/:id", validation(gradeSchema), send(async (req) => {
    const answer = await repos.lessonAnswer.findById({ id: id(req) })
    if (!answer) throw new NotFoundError("Answer not found")
    const points = req.body.points ?? 0
    await repos.enrollment.updateone({ filter: { student: answer.student }, data: { $inc: { points: points - (answer.points || 0) } } })
    return repos.lessonAnswer.findByIdAndUpdate({
        id: answer._id,
        data: { $set: { isCorrect: Boolean(req.body.isCorrect), points, status: "graded", gradedBy: req.actor.id, gradedAt: new Date() } },
    })
}))
router.get("/lessons/:id/answers", send(async (req) => {
    const lesson = await own(id(req))
    const answers = await repos.lessonAnswer.findall({ filter: { lesson: lesson._id }, sort: { createdAt: -1 } })
    const students = await studentRefs(answers.map((answer) => answer.student))
    return answers.map((answer) => ({
        ...answer,
        student: missingStudent(students, answer.student),
        question: pick(lesson.questions.find((question: any) => sameId(question._id, answer.question)) ?? {}, ["_id", "text", "type", "bonusPoints", "correct"]),
    }))
}))
router.get("/lessons/:id", send(async (req) => lessonView(await own(id(req)))))
router.patch("/lessons/:id", validation(lessonSchema.partial()), send(async (req) => {
    await own(id(req))
    const lesson = await repos.lesson.findByIdAndUpdate({ id: id(req), data: { $set: { ...pick(req.body, FIELDS), ...normalized(req.body) } } })
    return lessonView(lesson)
}))
router.delete("/lessons/:id", send(async (req) => {
    await own(id(req))
    await repos.lesson.deleteById(id(req))
    return { id: id(req) }
}))
router.post("/lessons/:id/grants", validation(grantSchema), send(async (req) => {
    const lesson = await own(id(req))
    await repos.lessonGrant.create({
        lesson: lesson._id, student: req.body.student, method: "admin_free",
        maxViews: req.body.maxViews ?? lesson.viewsIfPaid, hours: req.body.hours ?? lesson.accessHours,
    })
    return lessonView(lesson)
}, "Access granted", 201))
router.delete("/lessons/:id/grants/:grantId", send(async (req) => {
    const lesson = await own(id(req))
    await repos.lessonGrant.deleteone({ filter: { _id: id(req, "grantId"), lesson: lesson._id } })
    return lessonView(lesson)
}))

export default router
