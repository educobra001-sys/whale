import { Router } from "express"
import { z } from "zod"
import { ConflictError, ForbiddenError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { roleEnum } from "../../common/enum/user.enum"
import { send } from "../../common/exceptions/successresponce"
import { normalizePhone, sameId, studentPublic, teacherPublic } from "../../common/service/helpers"
import { validation } from "../../common/service/validation"
import { params } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { auth, platformScope, requireRole } from "../../middleware/auth.middleware"
import studentService from "../student/student.service"

const router: Router = Router()
const linkSchema = z.object({ code: z.string().trim().min(1).max(32) })

const childView = async (studentId: unknown) => {
    const [student, entries] = await Promise.all([
        repos.student.findById({ id: studentId }),
        repos.enrollment.findall({ filter: { student: studentId, status: "active", archived: false }, populate: { path: "teacher" } }),
    ])
    return { ...studentPublic(student), teachers: entries.map((entry) => teacherPublic(entry.teacher)) }
}

const parentOf = async (id: string) => {
    const parent = await repos.parent.findById({ id })
    if (!parent) throw new NotFoundError("Parent account not found")
    return parent
}

router.use(auth, requireRole(roleEnum.Parent), platformScope)
router.get("/profile", send(async (req) => {
    const parent = await parentOf(req.actor.id)
    return { _id: parent._id, name: parent.name, phone: parent.phone, referralId: parent.referralId, children: await Promise.all(parent.children.map(childView)) }
}))
router.post("/children", validation(linkSchema), send(async (req) => {
    const parent = await parentOf(req.actor.id)
    const student = await repos.student.findone({ filter: { userID: req.body.code.toUpperCase() } })
    if (!student) throw new NotFoundError("Student not found")
    if (normalizePhone(student.parentPhone) !== parent.phone) throw new ForbiddenError("This student registered a different parent phone number")
    if (parent.children.some((child: unknown) => sameId(child, student._id))) throw new ConflictError("This child is already linked")
    await repos.parent.updateone({ filter: { _id: parent._id }, data: { $addToSet: { children: student._id } } })
    return childView(student._id)
}, "Child linked", 201))
router.delete("/children/:id", send(async (req) => {
    await repos.parent.updateone({ filter: { _id: req.actor.id }, data: { $pull: { children: params(req.params.id) } } })
    return { id: req.params.id }
}))
router.get("/children/:id/report", send(async (req) => {
    const id = params(req.params.id)
    const parent = await parentOf(req.actor.id)
    if (!parent.children.some((child: unknown) => sameId(child, id))) throw new NotFoundError("Child not found")
    const report = await studentService.parentReport(id, req.query.teacher ? String(req.query.teacher) : undefined)
    return { student: await childView(id), ...report }
}))

export default router
