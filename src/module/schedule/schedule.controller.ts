import { Router } from "express"
import { z } from "zod"
import { NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { pick } from "../../common/service/helpers"
import { validation } from "../../common/service/validation"
import { optionalId, params, text } from "../../common/service/zodTypes"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { sessionView, slotViews } from "../shared/views"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const slotSchema = z.object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}/, "Use HH:MM").transform((value) => value.slice(0, 5)),
    durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
    center: optionalId,
    grade: z.string().max(4).optional(),
    title: text(120).optional(),
    isActive: z.boolean().optional(),
    notes: text(500).optional(),
})
const startSchema = z.object({
    sequence: text(160).optional(),
    week: z.coerce.number().int().min(1).max(60).optional(),
    number: z.coerce.number().int().min(1).max(999).optional(),
})

const ownSlot = async (slotId: string) => {
    const slot = await repos.schedule.findById({ id: slotId })
    if (!slot) throw new NotFoundError("Schedule slot not found")
    return slot
}

const list = async () => slotViews(await repos.schedule.findall({ sort: { dayOfWeek: 1, startTime: 1 } }))
const FIELDS = ["dayOfWeek", "startTime", "durationMinutes", "center", "grade", "title", "isActive", "notes"]

router.use("/schedule", requireFeature("schedule"))
router.get("/schedule", can("schedule", "sessions_view"), send(list))
router.post("/schedule", can("schedule"), validation(slotSchema), send(async (req) => {
    const slot = await repos.schedule.create(req.body)
    return (await slotViews([slot.toObject()]))[0]
}, "Group added", 201))
router.patch("/schedule/:id", can("schedule"), validation(slotSchema.partial()), send(async (req) => {
    await ownSlot(id(req))
    const slot = await repos.schedule.findByIdAndUpdate({ id: id(req), data: { $set: pick(req.body, FIELDS) } })
    return (await slotViews([slot]))[0]
}))
router.delete("/schedule/:id", can("schedule"), send(async (req) => {
    await ownSlot(id(req))
    await repos.schedule.deleteById(id(req))
    return { id: id(req) }
}))
router.post("/schedule/:id/start", can("sessions_manage", "schedule"), validation(startSchema), send(async (req) => {
    const slot = await ownSlot(id(req))
    const latest = await repos.session.findone({ filter: {}, sort: { date: -1 } })
    const session = await withTransaction(async () => {
        await repos.session.updateMany({ filter: { active: true }, data: { $set: { active: false } } })
        return repos.session.create({
            sequence: req.body.sequence || slot.title,
            week: req.body.week ?? latest?.week ?? 1,
            number: req.body.number ?? (latest?.number ?? 0) + 1,
            date: new Date(),
            center: slot.center,
            grade: slot.grade,
            active: true,
        })
    })
    return sessionView(session.toObject())
}, "Session started", 201))

export default router
