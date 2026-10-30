import { Router } from "express"
import { z } from "zod"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { objectId, optionalId, params } from "../../common/service/zodTypes"
import { can } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import messageService from "./message.service"

const router: Router = Router()
const type = z.enum(["attendance", "absence"])
const previewSchema = z.object({ session: objectId, type })
const previewOneSchema = previewSchema.extend({ identifier: z.string().trim().min(1).max(80) })
const sendSchema = z.object({
    session: optionalId,
    type,
    channel: z.enum(["telegram", "whatsapp_api", "whatsapp_web", "whatsapp_link"]),
    items: z.array(z.object({
        student: optionalId,
        name: z.string().max(200),
        to: z.string().trim().min(1, "Every row needs a phone number").max(40),
        body: z.string().trim().min(1, "A message is empty").max(4096),
    })).min(1, "Add at least one student").max(5000),
})
const permitted = can("messages")

router.get("/messages/config", permitted, send((req) => messageService.config(req.teacherId)))
router.put("/messages/templates/:type", permitted, validation(z.object({ body: z.string().trim().min(1).max(4000) })), send((req) => messageService.saveTemplate(type.parse(req.params.type), req.body.body), "Template saved"))
router.post("/messages/preview", permitted, validation(previewSchema), send((req) => messageService.preview(req.teacherId, req.body)))
router.post("/messages/preview-one", permitted, validation(previewOneSchema), send((req) => messageService.previewOne(req.teacherId, req.body)))
router.post("/messages/send", permitted, rateLimit({ name: "messages", windowSeconds: 60, max: 30 }), validation(sendSchema), send((req) => messageService.send(req.teacherId, req.actor.id, req.body), "Messages queued", 201))
router.patch("/messages/items/:id", permitted, validation(z.object({ status: z.enum(["sent", "skipped"]) })), send((req) => messageService.reportLink(params(req.params.id), req.body.status)))
router.get("/messages/batches", permitted, send(() => messageService.batches()))
router.get("/messages/batches/:id", permitted, send((req) => messageService.batchItems(params(req.params.id))))

export default router
