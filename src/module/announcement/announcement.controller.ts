import { Router } from "express"
import { z } from "zod"
import { ConflictError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { pick } from "../../common/service/helpers"
import { validation } from "../../common/service/validation"
import { params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const announcementSchema = z.object({
    title: z.string().trim().min(1).max(200),
    body: text(4000).optional(),
    imageUrl: text(2048).optional(),
    videoUrl: text(2048).optional(),
    linkUrl: text(2048).optional(),
    audience: z.object({ grades: z.array(z.string()).max(10).optional(), centers: z.array(z.string()).max(100).optional() }).optional(),
    isActive: z.boolean().optional(),
    pinned: z.boolean().optional(),
})
const FIELDS = ["title", "body", "imageUrl", "videoUrl", "linkUrl", "audience", "isActive", "pinned"]

const own = async (announcementId: string) => {
    const item = await repos.announcement.findById({ id: announcementId })
    if (!item) throw new NotFoundError("Announcement not found")
    return item
}

router.use("/announcements", requireFeature("announcements"), can("announcements"))
router.get("/announcements", send(() => repos.announcement.findall({ sort: { pinned: -1, createdAt: -1 } })))
router.post("/announcements", validation(announcementSchema), send(async (req) => (await repos.announcement.create(pick(req.body, FIELDS))).toObject(), "Announcement added", 201))
router.patch("/announcements/:id", validation(announcementSchema.partial()), send(async (req) => {
    const item = await own(id(req))
    // Editing an ad that was approved for the whole platform sends it back for review.
    const data: any = pick(req.body, FIELDS)
    if (item.platformStatus === "approved") data.platformStatus = "pending"
    return repos.announcement.findByIdAndUpdate({ id: id(req), data: { $set: data } })
}))
router.delete("/announcements/:id", send(async (req) => {
    await own(id(req))
    await repos.announcement.deleteById(id(req))
    return { id: id(req) }
}))
router.post("/announcements/:id/request-platform", send(async (req) => {
    const item = await own(id(req))
    if (item.platformStatus === "pending" || item.platformStatus === "approved") throw new ConflictError("This ad is already under review or approved")
    return repos.announcement.findByIdAndUpdate({ id: id(req), data: { $set: { platformStatus: "pending", platformNote: "" } } })
}, "Sent to EduCobra for review"))
router.post("/announcements/:id/withdraw-platform", send(async (req) => {
    await own(id(req))
    return repos.announcement.findByIdAndUpdate({ id: id(req), data: { $set: { platformStatus: "none" } } })
}))

export default router
