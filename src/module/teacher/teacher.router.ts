import { Router } from "express"
import { auth, teacherScope } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import AnnouncementRouter from "../announcement/announcement.controller"
import BillingRouter from "../billing/billing.controller"
import BookletRouter from "../booklet/booklet.controller"
import ExamRouter from "../exam/exam.controller"
import FinanceRouter from "../finance/finance.controller"
import FollowUpRouter from "../followUp/followUp.controller"
import HomeworkRouter from "../homework/homework.controller"
import LessonRouter from "../lesson/lesson.controller"
import MessageRouter from "../message/message.controller"
import ScheduleRouter from "../schedule/schedule.controller"
import SessionRouter from "../session/session.controller"
import WalletRouter from "../wallet/wallet.controller"
import TeacherRouter from "./teacher.controller"

const router: Router = Router()

router.use(auth, rateLimit({ name: "teacher", windowSeconds: 60, max: 1200 }), teacherScope)
router.use(TeacherRouter)
router.use(SessionRouter)
router.use(ScheduleRouter)
router.use(ExamRouter)
router.use(HomeworkRouter)
router.use(LessonRouter)
router.use(BookletRouter)
router.use(WalletRouter)
router.use(AnnouncementRouter)
router.use(FollowUpRouter)
router.use(FinanceRouter)
router.use(BillingRouter)
router.use(MessageRouter)

export default router
