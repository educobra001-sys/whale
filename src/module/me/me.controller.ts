import { Router } from "express"
import { send } from "../../common/exceptions/successresponce"
import { sameId, sum, teacherPublic } from "../../common/service/helpers"
import { repos } from "../../db/repository"
import { auth, platformScope } from "../../middleware/auth.middleware"
import { telegramDeepLink } from "../message/telegram.service"

const router: Router = Router()

const accountRepo: Record<string, any> = {
    owner: repos.owner, teacher: repos.teacher, assistant: repos.assistant,
    center: repos.center, student: repos.student, parent: repos.parent,
}

router.use(auth, platformScope)

// Every account has a marketing id, whether or not it is ever used.
router.get("/referral", send(async (req) => {
    const account = await accountRepo[req.actor.role].findById({ id: req.actor.id, select: "referralId" })
    const code = account?.referralId
    const [teachers, earnings] = await Promise.all([
        repos.teacher.findall({ filter: { "affiliate.code": code } }),
        repos.affiliateEarning.findall({ filter: { code }, sort: { month: -1 }, limit: 60 }),
    ])
    return {
        referralId: code,
        deals: teachers.map((teacher) => ({ teacher: teacherPublic(teacher), ratePerStudent: teacher.affiliate.ratePerStudent, since: teacher.affiliate.since })),
        earnings: earnings.map((row) => ({ ...row, teacher: teacherPublic(teachers.find((teacher) => sameId(teacher._id, row.teacher))) })),
        totals: {
            earned: sum(earnings, (row) => row.amount),
            due: sum(earnings.filter((row) => row.status === "due"), (row) => row.amount),
            paid: sum(earnings.filter((row) => row.status === "paid"), (row) => row.amount),
        },
    }
}))

// Ads the owner approved to appear outside a teacher's own course.
router.get("/platform-ads", send(async () => {
    const ads = await repos.announcement.findall({ filter: { platformStatus: "approved", isActive: true }, sort: { updatedAt: -1 }, limit: 12, populate: { path: "teacher" } })
    return ads.map((ad) => ({ ...ad, teacher: teacherPublic(ad.teacher) }))
}))

router.get("/telegram", send(async (req) => {
    const children = req.actor.role === "student"
        ? [req.actor.id]
        : req.actor.role === "parent" ? (await repos.parent.findById({ id: req.actor.id }))?.children ?? [] : []
    const links = await repos.telegramLink.findall({ filter: { student: { $in: children } } })
    const students = await repos.student.findall({ filter: { _id: { $in: children } }, select: "firstName lastName" })
    return students.map((student) => ({
        student,
        linked: links.some((link) => sameId(link.student, student._id)),
        url: telegramDeepLink(String(student._id), req.actor.role),
    }))
}))

export default router
