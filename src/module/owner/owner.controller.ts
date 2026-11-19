import { Router } from "express"
import { z } from "zod"
import { roleEnum } from "../../common/enum/user.enum"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { params } from "../../common/service/zodTypes"
import { auth, platformScope, requireRole } from "../../middleware/auth.middleware"
import billingService from "../billing/billing.service"
import { BadRequestError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { repos } from "../../db/repository"
import { actAsTeacher, messageRoutes } from "../message/message.controller"
import { handleTelegramLinks, removeTelegramLink } from "./owner.telegram"
import { removeTelegram, repairTelegram, setupTelegram, telegramStatus } from "../message/telegram.service"
import { linkWhatsapp, PLATFORM, unlinkWhatsapp, whatsappState } from "../message/whatsappWeb.service"
import ownerService from "./owner.service"
import { hiddenSections, setHiddenSections } from "../../common/service/sections"
import { ALL_FEATURE_KEYS } from "../../common/enum/feature.enum"
import * as schema from "./owner.validation"

const router: Router = Router()
const id = (req: any, key = "id") => params(req.params[key])

router.use(auth, requireRole(roleEnum.Owner), platformScope)

router.get("/profile", send((req) => ownerService.profile(req.actor.id)))
router.get("/dashboard", send(() => ownerService.dashboard()))

router.get("/teachers", send((req) => ownerService.teachers(req.query)))
router.get("/teachers/:id", send((req) => ownerService.teacher(id(req))))
router.patch("/teachers/:id/status", validation(schema.statusSchema), send((req) => ownerService.setTeacherStatus(req.actor, id(req), req.body), "Status updated"))
router.patch("/teachers/:id/channels", validation(schema.channelsSchema), send((req) => ownerService.setChannels(req.actor, id(req), req.body), "Channels saved"))
router.patch("/teachers/:id/affiliate", validation(schema.affiliateSchema), send((req) => ownerService.setAffiliate(req.actor, id(req), req.body), "Affiliate saved"))
router.post("/teachers/:id/rules", validation(schema.ruleSchema), send((req) => ownerService.addRule(req.actor, id(req), req.body), "Rule added", 201))
router.patch("/teachers/:id/rules/:ruleId", validation(schema.ruleSchema.partial()), send((req) => ownerService.updateRule(req.actor, id(req), id(req, "ruleId"), req.body)))
router.delete("/teachers/:id/rules/:ruleId", send((req) => ownerService.removeRule(req.actor, id(req), id(req, "ruleId"))))

router.get("/features", send(() => ownerService.features()))
router.patch("/features/:id", validation(schema.featureSchema), send((req) => ownerService.updateFeature(req.actor, id(req), req.body), "Section saved"))
router.post("/plans/confirm", validation(schema.planSchema), send((req) => ownerService.confirmPlan(req.actor, req.body), "Plan confirmed"))

router.get("/centers", send((req) => ownerService.centers(req.query)))
router.post("/centers", validation(schema.createCenterSchema), send((req) => ownerService.createCenter(req.actor, req.body), "Center created", 201))
router.patch("/centers/:id/status", validation(schema.statusSchema), send((req) => ownerService.setCenterStatus(req.actor, id(req), req.body), "Status updated"))

router.get("/billing", send((req) => ownerService.billing(req.query)))
router.post("/billing/generate", validation(schema.monthSchema), send((req) => billingService.generateMonth(req.body.month), "Invoices generated"))
router.patch("/invoices/:id", validation(schema.invoiceSchema), send((req) => ownerService.setInvoice(req.actor, id(req), req.body), "Invoice updated"))

router.get("/affiliates", send((req) => ownerService.affiliates(req.query)))
router.get("/referrals/:code", send((req) => ownerService.lookupReferral(String(req.params.code))))
router.patch("/affiliates/:id", validation(z.object({ status: z.enum(["due", "paid"]) })), send((req) => ownerService.setEarning(req.actor, id(req), req.body.status)))

router.get("/ads", send((req) => ownerService.ads(req.query)))
router.patch("/ads/:id", validation(schema.adReviewSchema), send((req) => ownerService.reviewAd(req.actor, id(req), req.body), "Ad reviewed"))

router.get("/messaging", send(() => ownerService.messaging()))
router.patch("/messaging", validation(schema.messagingSchema), send((req) => ownerService.updateMessaging(req.actor, req.body), "Settings saved"))
// WhatsApp numbers linked by QR: "platform" is the owner's number, a teacher id is that teacher's own number.
const whatsappAccount = async (req: any) => {
    const account = String(req.params.account ?? PLATFORM)
    if (account === PLATFORM) return account
    const teacherId = params(account, "teacher")
    if (!(await repos.teacher.exists({ _id: teacherId }))) throw new NotFoundError("Teacher not found")
    return teacherId
}
const unlink = async (account: string) => {
    try {
        return await unlinkWhatsapp(account)
    } catch (error: any) {
        throw new BadRequestError(error.message)
    }
}
router.get("/whatsapp", send(() => whatsappState(PLATFORM)))
router.post("/whatsapp/connect", send(() => linkWhatsapp(PLATFORM)))
router.post("/whatsapp/logout", send(() => unlink(PLATFORM)))
router.get("/whatsapp/:account", send(async (req) => whatsappState(await whatsappAccount(req))))
router.post("/whatsapp/:account/connect", send(async (req) => linkWhatsapp(await whatsappAccount(req))))
router.post("/whatsapp/:account/logout", send(async (req) => unlink(await whatsappAccount(req)), "WhatsApp unlinked"))

router.get("/telegram", send(() => telegramStatus()))
router.put("/telegram", validation(z.object({ token: z.string().trim().regex(/^\d{5,15}:[\w-]{30,60}$/, "That doesn't look like a bot token from @BotFather") })), send(async (req) => {
    try {
        const status = await setupTelegram(req.body.token)
        await ownerService.audit(req.actor, "telegram.setup", "settings", { username: status.username })
        return status
    } catch (error: any) {
        throw new BadRequestError(error.message)
    }
}, "Telegram bot connected"))
router.delete("/telegram", send(async (req) => {
    await ownerService.audit(req.actor, "telegram.remove", "settings", {})
    return removeTelegram()
}, "Telegram bot removed"))
router.post("/telegram/repair", send(async (req) => {
    try {
        const status = await repairTelegram()
        await ownerService.audit(req.actor, "telegram.repair", "settings", { username: status.username })
        return status
    } catch (error: any) {
        throw new BadRequestError(error.message)
    }
}, "Telegram bot repaired"))
router.get("/telegram/links", send((req) => handleTelegramLinks(req.query)))
router.delete("/telegram/links/:id", send((req) => removeTelegramLink(id(req)), "Link removed"))

router.get("/audit", send(() => ownerService.audits()))

// Sections hidden from everyone until the owner publishes them.
router.get("/sections", send(async () => ({ hidden: await hiddenSections() })))
router.put("/sections", validation(z.object({ hidden: z.array(z.enum(ALL_FEATURE_KEYS as [string, ...string[]])).max(50) })), send(async (req) => {
    const hidden = await setHiddenSections(req.body.hidden)
    await ownerService.audit(req.actor, "sections.hidden", "settings", { hidden })
    return { hidden }
}, "Sections saved"))

// Messages for one teacher's students, written by the owner (same screens and rules as the teacher's own page).
const ownerMessages: Router = Router({ mergeParams: true })
ownerMessages.use("/messages", actAsTeacher)
ownerMessages.use(messageRoutes((req, res, next) => next(), true))
router.use("/teachers/:teacherId", ownerMessages)

export default router
