import { NextFunction, Response, Router } from "express"
import { z } from "zod"
import { ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { roleEnum } from "../../common/enum/user.enum"
import { send } from "../../common/exceptions/successresponce"
import { runAsPlatform, runWithTeacher } from "../../common/service/tenantContext"
import { validation } from "../../common/service/validation"
import { money, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { auth, platformScope, requireRole } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import studentService from "./student.service"

const router: Router = Router()
const profileSchema = z.object({
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    parentPhone: text(32).optional(),
    schoolName: text(160).optional(),
    profilepic: text(2048).optional(),
    gender: z.enum(["male", "female"]).optional(),
})
const progressSchema = z.object({ start: z.boolean().optional(), part: text(40).optional(), seconds: z.coerce.number().min(0).optional() })
const answerSchema = z.object({ choice: text(500).optional(), imageUrl: text(2048).optional(), text: text(4000).optional() })
const submitSchema = z.object({ files: z.array(text(2048)).max(20).optional(), comment: text(2000).optional(), link: text(2048).optional() })
const reserveSchema = z.object({ method: z.enum(["center", "transfer"]).optional(), receiptUrl: text(2048).optional(), reference: text(120).optional() })
const topupSchema = z.object({ amount: money.refine((value) => value > 0, "Enter a positive amount"), method: text(60).optional(), reference: text(120).optional(), receiptUrl: z.string().trim().min(1).max(2048) })
const rechargeSchema = z.object({ code: z.string().trim().min(1).max(40) })

const activeEntry = async (teacherId: unknown, studentId: string) => {
    const entry = await repos.enrollment.findone({ filter: { teacher: teacherId, student: studentId, status: "active", archived: false } })
    if (!entry) throw new ForbiddenError("You're not subscribed to this teacher yet")
    return entry
}

// Enters a teacher's scope only after confirming the student is really in that class.
const inClass = async (req: any, res: Response, next: NextFunction) => {
    const teacherId = params(req.params.id, "teacher")
    req.entry = await activeEntry(teacherId, req.actor.id)
    runWithTeacher(teacherId, next)
}

const loadOwned = (repo: any, label: string) => async (req: any, res: Response, next: NextFunction) => {
    const record = await repo.findById({ id: params(req.params.id) })
    if (!record) throw new NotFoundError(`${label} not found`)
    req.record = record
    req.entry = await activeEntry(record.teacher, req.actor.id)
    runWithTeacher(record.teacher, next)
}

router.use(auth, requireRole(roleEnum.Student), platformScope, rateLimit({ name: "student", windowSeconds: 60, max: 300 }))

router.get("/profile", send((req) => studentService.profile(req.actor.id)))
router.patch("/profile", validation(profileSchema), send((req) => studentService.updateProfile(req.actor.id, req.body), "Profile saved"))
router.get("/teachers", send((req) => studentService.teachers(req.actor.id)))
router.post("/teachers/:id/request", send((req) => studentService.request(req.actor.id, params(req.params.id)), "Request sent", 201))
router.delete("/teachers/:id/request", send((req) => studentService.cancelRequest(req.actor.id, params(req.params.id))))

router.get("/teachers/:id/overview", inClass, send((req) => studentService.overview(req.entry)))
router.get("/teachers/:id/sessions", inClass, send((req) => studentService.sessions(req.entry)))
router.get("/teachers/:id/lessons", inClass, send((req) => studentService.lessons(req.entry)))
router.get("/teachers/:id/homework", inClass, send((req) => studentService.homework(req.entry)))
router.get("/teachers/:id/exams", inClass, send((req) => studentService.exams(req.entry)))
router.get("/teachers/:id/booklets", inClass, send((req) => studentService.booklets(req.entry)))
router.get("/teachers/:id/transactions", inClass, send((req) => studentService.transactions(req.entry)))
router.get("/teachers/:id/leaderboard", inClass, send((req) => studentService.board(req.entry)))
router.post("/teachers/:id/topups", inClass, validation(topupSchema), send((req) => studentService.topup(req.entry, req.body), "Request sent", 201))

const lesson = loadOwned(repos.lesson, "Lesson")
router.get("/lessons/:id", lesson, send((req) => {
    if (!req.record.published) throw new NotFoundError("Lesson not found")
    return studentService.lesson(req.record, req.entry)
}))
router.post("/lessons/:id/unlock", lesson, send((req) => studentService.unlock(String(req.record.teacher), req.record, req.entry, req.actor.id)))
router.post("/lessons/:id/progress", lesson, validation(progressSchema), send((req) => studentService.progress(req.record, req.entry, req.body)))
router.post("/questions/:id/answer", async (req: any, res, next) => {
    const questionId = params(req.params.id, "question")
    const record = await runAsPlatform(() => repos.lesson.findone({ filter: { "questions._id": questionId } }))
    if (!record) throw new NotFoundError("Question not found")
    req.record = record
    req.entry = await activeEntry(record.teacher, req.actor.id)
    runWithTeacher(record.teacher, next)
}, validation(answerSchema), send((req) => studentService.answer(req.record, req.entry, req.params.id, req.body)))

router.post("/homework/:id/submit", loadOwned(repos.homework, "Homework"), validation(submitSchema), send((req) => studentService.submitHomework(req.record, req.entry, req.body), "Homework submitted"))
router.post("/booklets/:id/reserve", loadOwned(repos.booklet, "Booklet"), validation(reserveSchema), send((req) => studentService.reserve(req.record, req.entry, req.body), "Reserved", 201))
router.post("/recharge", rateLimit({ name: "recharge", windowSeconds: 600, max: 20 }), validation(rechargeSchema), send((req) => studentService.recharge(req.actor.id, req.body.code), "Balance added"))

export default router
