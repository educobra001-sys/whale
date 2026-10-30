import { Router } from "express"
import { send } from "../../common/exceptions/successresponce"
import { teacherOnly } from "../../middleware/auth.middleware"
import billingService from "./billing.service"

const router: Router = Router()

router.get("/billing", teacherOnly, send((req) => billingService.teacherView(req.teacherId)))

export default router
