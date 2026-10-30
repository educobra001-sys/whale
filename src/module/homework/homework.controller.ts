import { Router } from "express"
import { z } from "zod"
import { NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { DAY, pick } from "../../common/service/helpers"
import { missingStudent, peopleRefs, refOf, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { dateText, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const homeworkSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: text(4000).optional(),
    startDate: dateText,
    endDate: dateText,
    submissionType: text(20).optional(),
    externalLink: text(2048).optional(),
    grade: z.string().max(4).optional(),
})
const gradeSchema = z.object({ status: z.enum(["complete", "incomplete", "no_steps", "not_done", "submitted"]).optional(), feedback: text(2000).optional() })
const FIELDS = ["title", "description", "startDate", "endDate", "submissionType", "externalLink", "grade"]

export const homeworkView = async (hw: any) => {
    const [submissionsCount, pendingCount] = await Promise.all([
        repos.submission.count({ homework: hw._id }),
        repos.submission.count({ homework: hw._id, status: "submitted" }),
    ])
    return { ...hw, submissionsCount, pendingCount, isOpen: new Date(hw.endDate).getTime() + DAY > Date.now() }
}

const own = async (homeworkId: string) => {
    const hw = await repos.homework.findById({ id: homeworkId })
    if (!hw) throw new NotFoundError("Homework not found")
    return hw
}

router.use("/homework", requireFeature("homework"), can("homework_online"))
router.get("/homework", send(async () => Promise.all((await repos.homework.findall({ sort: { order: -1 } })).map(homeworkView))))
router.post("/homework", validation(homeworkSchema), send(async (req) => {
    const order = (await repos.homework.count({})) + 1
    const hw = await repos.homework.create({ ...pick(req.body, FIELDS), order })
    return homeworkView(hw.toObject())
}, "Homework added", 201))
router.patch("/homework/submissions/:id", validation(gradeSchema), send(async (req) => {
    const sub = await repos.submission.findOneAndUpdate({
        filter: { _id: id(req) },
        data: { $set: { ...pick(req.body, ["status", "feedback"]), gradedAt: new Date(), gradedBy: req.actor.id } },
    })
    if (!sub) throw new NotFoundError("Submission not found")
    const [students, people] = await Promise.all([studentRefs([sub.student]), peopleRefs([sub.gradedBy])])
    return { ...sub, student: missingStudent(students, sub.student), gradedByName: refOf(people, sub.gradedBy)?.name }
}))
router.patch("/homework/:id", validation(homeworkSchema.partial()), send(async (req) => {
    await own(id(req))
    return homeworkView(await repos.homework.findByIdAndUpdate({ id: id(req), data: { $set: pick(req.body, FIELDS) } }))
}))
router.delete("/homework/:id", send(async (req) => {
    await own(id(req))
    await repos.homework.deleteById(id(req))
    await repos.submission.deleteMany({ filter: { homework: id(req) } })
    return { id: id(req) }
}))
router.get("/homework/:id/submissions", send(async (req) => {
    const hw = await own(id(req))
    const subs = await repos.submission.findall({ filter: { homework: hw._id }, sort: { submittedAt: -1 } })
    const [students, people] = await Promise.all([studentRefs(subs.map((sub) => sub.student)), peopleRefs(subs.map((sub) => sub.gradedBy))])
    return {
        homework: await homeworkView(hw),
        submissions: subs.map((sub) => ({ ...sub, student: missingStudent(students, sub.student), gradedByName: refOf(people, sub.gradedBy)?.name ?? "" })),
    }
}))

export default router
