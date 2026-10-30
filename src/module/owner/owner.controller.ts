import { Router } from "express"
import { z } from "zod"
import { roleEnum } from "../../common/enum/user.enum"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { params } from "../../common/service/zodTypes"
import { auth, platformScope, requireRole } from "../../middleware/auth.middleware"
import billingService from "../billing/billing.service"
import { requestWhatsapp, whatsappState } from "../message/whatsappWeb.service"
import ownerService from "./owner.service"
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
router.get("/whatsapp", send(() => whatsappState()))
router.post("/whatsapp/connect", send(async () => {
    await requestWhatsapp("connect")
    return whatsappState()
}))
router.post("/whatsapp/logout", send(async () => {
    await requestWhatsapp("logout")
    return whatsappState()
}))

router.get("/audit", send(() => ownerService.audits()))

export default router
