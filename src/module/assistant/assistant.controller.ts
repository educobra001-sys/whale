import { Router } from "express"
import { z } from "zod"
import { send } from "../../common/exceptions/successresponce"
import { normalizePhone, sum, teacherPublic } from "../../common/service/helpers"
import { validation } from "../../common/service/validation"
import { text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { auth, requireRole, teacherScope } from "../../middleware/auth.middleware"
import { roleEnum } from "../../common/enum/user.enum"
import teacherService from "../teacher/teacher.service"

const router: Router = Router()
const updateSchema = z.object({
    firstName: text(80).optional(),
    lastName: text(80).optional(),
    phone: z.string().trim().min(6).max(32).optional(),
    profilepic: text(2048).optional(),
})

const profile = async (req: any) => {
    const assistant = await repos.assistant.findById({ id: req.actor.id })
    const teacher = await repos.teacher.findById({ id: assistant.teacher })
    return { ...(await teacherService.view(assistant)), teacher: teacherPublic(teacher), features: teacher.features }
}

router.use(auth, requireRole(roleEnum.Assistant), teacherScope)
router.get("/profile", send(profile))
router.patch("/profile", validation(updateSchema), send(async (req) => {
    if (req.body.phone) req.body.phone = normalizePhone(req.body.phone)
    await repos.assistant.updateone({ filter: { _id: req.actor.id }, data: { $set: req.body } })
    return profile(req)
}, "Profile saved"))
router.get("/work-log", send(async (req) => {
    const assistant = await repos.assistant.findById({ id: req.actor.id })
    const entries = await teacherService.staffEntries(req.actor.id, req.query.from, req.query.to)
    const [attendanceMarked, followUpStudents] = await Promise.all([
        repos.attendance.count({ markedBy: req.actor.id }),
        repos.enrollment.count({ followUpAssistant: req.actor.id, archived: false }),
    ])
    return {
        log: entries,
        minutes: sum(entries, (entry) => entry.minutes),
        sessionsWorked: entries.length,
        attendanceMarked,
        salary: assistant.salary,
        salaryEstimate: await teacherService.salary(assistant, entries),
        followUpStudents,
    }
}))

export default router
