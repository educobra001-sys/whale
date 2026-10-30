import { Router } from "express"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { params } from "../../common/service/zodTypes"
import { can, requireFeature, teacherOnly } from "../../middleware/auth.middleware"
import teacherService from "./teacher.service"
import * as schema from "./teacher.validation"

const router: Router = Router()
const id = (req: any, key = "id") => params(req.params[key])
const students = requireFeature("students")
const view = can("students_view", "scan_attendance", "scan_homework", "door_check", "follow_up", "sessions_view", "exams", "lessons", "booklets", "wallet")
const manage = can("students_manage")
const balance = can("students_balance")

router.get("/profile", send((req) => teacherService.profile(req.teacherId)))
router.patch("/profile", teacherOnly, validation(schema.updateProfileSchema), send((req) => teacherService.updateProfile(req.teacherId, req.body), "Profile saved"))
router.delete("/profile", teacherOnly, send((req) => teacherService.closeAccount(req.teacherId), "Account closed"))
router.get("/dashboard", can("dashboard"), send((req) => teacherService.dashboard(req.teacherId)))

router.get("/myStudents", students, view, send(() => teacherService.students()))
router.post("/myStudents", students, manage, validation(schema.createStudentSchema), send((req) => teacherService.createStudent(req.body, req.actor.id), "Student added", 201))
router.post("/myStudents/link", students, manage, validation(schema.linkStudentSchema), send((req) => teacherService.linkStudent(req.body), "Student linked", 201))
router.post("/myStudents/import", students, manage, validation(schema.importStudentsSchema), send((req) => teacherService.importStudents(req.body.students, req.actor.id)))
router.get("/myStudents/:id/history", students, view, send((req) => teacherService.history(id(req))))
router.get("/myStudents/:id", students, view, send((req) => teacherService.student(id(req))))
router.patch("/myStudents/:id", students, manage, validation(schema.updateStudentSchema), send((req) => teacherService.updateStudent(id(req), req.body), "Student saved"))
router.delete("/myStudents/:id", students, manage, validation(schema.reasonSchema), send((req) => teacherService.removeStudent(id(req), req.body.reason), "Student removed"))
router.post("/myStudents/:id/balance", students, balance, validation(schema.balanceSchema), send((req) => teacherService.adjustBalance(id(req), req.body, req.actor.id)))
router.post("/myStudents/:id/points", students, balance, validation(schema.pointsSchema), send((req) => teacherService.addPoints(id(req), req.body, req.actor.id)))
router.post("/myStudents/:id/warnings", students, can("warnings"), validation(schema.reasonSchema), send((req) => teacherService.addWarning(id(req), req.body.reason, req.actor.id)))
router.delete("/myStudents/:id/warnings/:warningId", students, can("warnings"), send((req) => teacherService.removeWarning(id(req), id(req, "warningId"))))
router.patch("/myStudents/:id/block", students, can("warnings"), validation(schema.blockSchema), send((req) => teacherService.setBlocked(id(req), req.body.blocked)))
router.get("/requests", students, view, send(() => teacherService.requests()))
router.patch("/requests/:id", students, manage, validation(schema.requestAnswerSchema), send((req) => teacherService.answerRequest(id(req), req.body.status)))
router.get("/archive", students, view, send(() => teacherService.archive()))
router.post("/archive/:id/restore", students, manage, send((req) => teacherService.restore(id(req))))

const team = requireFeature("assistants")
router.get("/assistants", can("sessions_view", "follow_up", "scan_attendance", "students_view"), send(() => teacherService.assistants()))
router.post("/assistants", team, teacherOnly, validation(schema.assistantCreateSchema), send((req) => teacherService.addAssistant(req.teacherId, req.body), "Assistant added", 201))
router.get("/assistants/:id/stats", team, teacherOnly, send((req) => teacherService.assistantStats(id(req), req.query)))
router.patch("/assistants/:id", team, teacherOnly, validation(schema.assistantUpdateSchema), send((req) => teacherService.updateAssistant(id(req), req.body), "Assistant saved"))
router.delete("/assistants/:id", team, teacherOnly, send((req) => teacherService.removeAssistant(id(req)), "Assistant removed"))

const centers = requireFeature("centers")
router.get("/centers", send((req) => teacherService.centers(req.teacherId)))
router.post("/centers/:id/request", centers, teacherOnly, send((req) => teacherService.requestCenter(req.teacherId, id(req)), "Request sent", 201))
router.patch("/centers/:id", centers, teacherOnly, validation(schema.answerLinkSchema), send((req) => teacherService.answerCenter(req.teacherId, id(req), req.body.status)))
router.delete("/centers/:id", centers, teacherOnly, send((req) => teacherService.leaveCenter(req.teacherId, id(req))))

router.get("/links", teacherOnly, send((req) => teacherService.links(req.teacherId)))
router.post("/links", teacherOnly, validation(schema.teacherLinkSchema), send((req) => teacherService.requestLink(req.teacherId, req.body.userName), "Request sent", 201))
router.patch("/links/:id", teacherOnly, send((req) => teacherService.answerLink(req.teacherId, id(req), req.body?.accept === true)))
router.delete("/links/:id", teacherOnly, send((req) => teacherService.removeLink(req.teacherId, id(req))))

export default router
