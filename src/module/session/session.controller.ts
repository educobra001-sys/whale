import { Router } from "express"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { params } from "../../common/service/zodTypes"
import { can, requireFeature } from "../../middleware/auth.middleware"
import sessionService from "./session.service"
import * as schema from "./session.validation"

const router: Router = Router()
const id = (req: any, key = "id") => params(req.params[key])
const view = can("sessions_view", "scan_attendance", "scan_homework", "door_check", "exams", "follow_up", "lessons")
const manage = can("sessions_manage")
const scan = can("scan_attendance")

router.use(["/sessions", "/scan"], requireFeature("sessions", "scan"))

router.get("/sessions", view, send(() => sessionService.list()))
router.post("/sessions", manage, validation(schema.createSessionSchema), send((req) => sessionService.create(req.body), "Session created", 201))
router.get("/sessions/:id", view, send((req) => sessionService.get(id(req))))
router.patch("/sessions/:id/active", can("sessions_manage", "scan_attendance"), validation(schema.setSessionActiveSchema), send((req) => sessionService.setActive(id(req), req.body.active)))
router.patch("/sessions/:id", manage, validation(schema.updateSessionSchema), send((req) => sessionService.update(id(req), req.body, req.actor.id)))
router.delete("/sessions/:id", manage, send((req) => sessionService.remove(id(req))))
router.post("/sessions/:id/attendance", scan, validation(schema.markAttendanceSchema), send((req) => sessionService.markAttendance(req.teacherId, id(req), req.body, req.actor.id), "Attendance recorded", 201))
router.patch("/sessions/:id/attendance/:studentId", can("sessions_manage", "scan_attendance"), validation(schema.updateAttendanceSchema), send((req) => sessionService.updateAttendance(id(req), id(req, "studentId"), req.body, req.actor.id)))
router.delete("/sessions/:id/attendance/:studentId", can("sessions_manage"), send((req) => sessionService.removeAttendance(id(req), id(req, "studentId"), req.actor.id)))
router.post("/sessions/:id/homework", can("scan_homework"), validation(schema.homeworkCheckSchema), send((req) => sessionService.checkHomework(id(req), req.body, req.actor.id)))
router.put("/sessions/:id/closing", manage, validation(schema.closingSchema), send((req) => sessionService.saveClosing(id(req), req.body)))
router.post("/sessions/:id/staff", manage, validation(schema.staffCreateSchema), send((req) => sessionService.staffCheckIn(id(req), req.body), "Checked in", 201))
router.patch("/sessions/:id/staff/:entryId", manage, validation(schema.staffUpdateSchema), send((req) => sessionService.staffUpdate(id(req), id(req, "entryId"), req.body)))
router.delete("/sessions/:id/staff/:entryId", manage, send((req) => sessionService.staffRemove(id(req), id(req, "entryId"))))
router.get("/scan/lookup", can("scan_attendance", "scan_homework", "door_check"), send((req) => sessionService.lookup(String(req.query.identifier ?? ""))))

export default router
