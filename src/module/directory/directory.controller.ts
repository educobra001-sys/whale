import { Router } from "express"
import { send } from "../../common/exceptions/successresponce"
import { auth, optionalAuth, platformScope } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import { uploadFile } from "../../common/service/upload"
import { BadRequestError } from "../../common/exceptions/error.exceptions"
import directoryService from "./directory.service"

const router: Router = Router()
const publicLimit = rateLimit({ name: "directory", windowSeconds: 60, max: 120 })

router.get("/teachers/search", optionalAuth, publicLimit, platformScope, send((req) => directoryService.searchTeachers(req.query, req.actor)))
router.get("/teachers/:id", optionalAuth, publicLimit, platformScope, send((req) => directoryService.teacher(req.params.id, req.actor)))
router.get("/centers/search", optionalAuth, publicLimit, platformScope, send((req) => directoryService.searchCenters(req.query)))

router.post("/uploads", auth, rateLimit({ name: "uploads", windowSeconds: 60, max: 30 }), uploadFile.single("file"), send((req) => {
    if (!req.file) throw new BadRequestError("No file uploaded")
    return { url: `/files/${req.file.filename}` }
}, "Uploaded", 201))

export default router
