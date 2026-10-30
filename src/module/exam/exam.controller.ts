import { Router } from "express"
import { z } from "zod"
import { BadRequestError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { pick } from "../../common/service/helpers"
import { missingStudent, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { dateText, objectId, optionalId, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { examStats, sessionLabel } from "../shared/views"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const examSchema = z.object({
    name: z.string().trim().min(1).max(160),
    maxScore: z.coerce.number().positive().max(100000),
    date: dateText.optional(),
    session: optionalId,
    grade: z.string().max(4).optional(),
})
const scoresSchema = z.object({
    scores: z.array(z.object({ student: objectId, score: z.union([z.number(), z.string(), z.null()]).optional() })).max(20000),
})

const examViews = async (exams: any[]) => {
    const [students, sessions] = await Promise.all([
        studentRefs(exams.flatMap((exam) => exam.results.map((row: any) => row.student))),
        repos.session.findall({ filter: { _id: { $in: exams.map((exam) => exam.session).filter(Boolean) } } }),
    ])
    return exams.map((exam) => {
        const session = sessions.find((item) => String(item._id) === String(exam.session))
        return {
            ...exam,
            sessionLabel: exam.session ? sessionLabel(session) : "",
            results: exam.results.map((row: any) => ({ ...row, student: missingStudent(students, row.student) })),
            stats: examStats(exam.results),
        }
    })
}

const own = async (examId: string) => {
    const exam = await repos.exam.findById({ id: examId })
    if (!exam) throw new NotFoundError("Exam not found")
    return exam
}

router.use("/exams", requireFeature("exams"), can("exams"))
router.get("/exams", send(async () => examViews(await repos.exam.findall({ sort: { date: -1 } }))))
router.post("/exams", validation(examSchema), send(async (req) => {
    const exam = await repos.exam.create({ ...req.body, date: req.body.date ? new Date(req.body.date) : new Date() })
    return (await examViews([exam.toObject()]))[0]
}, "Exam added", 201))
router.get("/exams/:id", send(async (req) => (await examViews([await own(id(req))]))[0]))
router.patch("/exams/:id", validation(examSchema.partial()), send(async (req) => {
    await own(id(req))
    const data: any = pick(req.body, ["name", "maxScore", "session", "grade"])
    if (req.body.date) data.date = new Date(req.body.date)
    return (await examViews([await repos.exam.findByIdAndUpdate({ id: id(req), data: { $set: data } })]))[0]
}))
router.delete("/exams/:id", send(async (req) => {
    await own(id(req))
    await repos.exam.deleteById(id(req))
    return { id: id(req) }
}))
router.put("/exams/:id/scores", validation(scoresSchema), send(async (req) => {
    const exam = await own(id(req))
    const results = req.body.scores
        .filter((row: any) => row.score !== null && row.score !== "" && row.score !== undefined)
        .map((row: any) => ({ student: row.student, score: Number(row.score) }))
    if (results.some((row: any) => !(row.score >= 0 && row.score <= exam.maxScore))) throw new BadRequestError(`Scores must be between 0 and ${exam.maxScore}`)
    return (await examViews([await repos.exam.findByIdAndUpdate({ id: id(req), data: { $set: { results } } })]))[0]
}))

export default router
