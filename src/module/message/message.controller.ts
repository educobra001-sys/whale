import { NextFunction, RequestHandler, Response, Router } from "express"
import { z } from "zod"
import { send } from "../../common/exceptions/successresponce"
import { runWithTeacher } from "../../common/service/tenantContext"
import { validation } from "../../common/service/validation"
import { objectId, optionalId, params } from "../../common/service/zodTypes"
import { can } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import messageService, { MESSAGE_TYPES } from "./message.service"

const type = z.enum(MESSAGE_TYPES)
const recipient = z.enum(["parent", "student", "both"])
const template = z.string().max(4000).optional()
const previewSchema = z.object({
    audience: z.enum(["attended", "absent", "all", "selected"]).optional(),
    session: optionalId,
    type,
    recipient: recipient.optional(),
    template,
    grade: z.string().max(4).optional(),
    center: z.union([objectId, z.literal("none")]).optional(),
    students: z.array(objectId).max(5000).optional(),
})
const previewOneSchema = z.object({ session: optionalId, type, recipient: recipient.optional(), template, identifier: z.string().trim().min(1).max(80) })
const sendSchema = z.object({
    session: optionalId,
    type,
    channel: z.enum(["telegram", "whatsapp_api", "whatsapp_web", "whatsapp_link"]),
    items: z.array(z.object({
        student: optionalId,
        name: z.string().max(200),
        to: z.string().trim().max(40).optional().default(""),
        recipient: recipient.optional(),
        body: z.string().trim().min(1, "A message is empty").max(4096),
    })).min(1, "Add at least one student").max(5000),
})

// The same routes serve the teacher's team (/teacher/messages) and the owner acting for one teacher
// (/owner/teachers/:teacherId/messages). `owner` lifts the per-teacher channel limits.
export const messageRoutes = (permitted: RequestHandler, owner = false) => {
    const router: Router = Router({ mergeParams: true })
    const options = { owner }
    router.get("/messages/config", permitted, send((req) => messageService.config(req.teacherId, options)))
    router.get("/messages/sessions", permitted, send(() => messageService.sessions()))
    router.put("/messages/templates/:type", permitted, validation(z.object({ body: z.string().trim().min(1).max(4000) })), send((req) => messageService.saveTemplate(type.parse(req.params.type), req.body.body), "Template saved"))
    router.post("/messages/preview", permitted, validation(previewSchema), send((req) => messageService.preview(req.teacherId, req.body)))
    router.post("/messages/preview-one", permitted, validation(previewOneSchema), send((req) => messageService.previewOne(req.teacherId, req.body)))
    router.post("/messages/send", permitted, rateLimit({ name: "messages", windowSeconds: 60, max: 30 }), validation(sendSchema), send((req) => messageService.send(req.teacherId, req.actor.id, req.body, options), "Messages queued", 201))
    router.patch("/messages/items/:id", permitted, validation(z.object({ status: z.enum(["sent", "skipped"]) })), send((req) => messageService.reportLink(params(req.params.id), req.body.status)))
    router.get("/messages/batches", permitted, send(() => messageService.batches()))
    router.get("/messages/batches/:id", permitted, send((req) => messageService.batchItems(params(req.params.id))))
    return router
}

// For the owner: every query below runs inside the chosen teacher's data.
export const actAsTeacher = (req: any, res: Response, next: NextFunction) => {
    const teacherId = params(req.params.teacherId)
    req.teacherId = teacherId
    runWithTeacher(teacherId, next)
}

export default messageRoutes(can("messages"))
