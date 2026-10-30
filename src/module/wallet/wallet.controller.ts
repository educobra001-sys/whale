import crypto from "node:crypto"
import { Router } from "express"
import { z } from "zod"
import { ConflictError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { markActive } from "../../common/service/activity"
import { send } from "../../common/exceptions/successresponce"
import { inRangeFilter } from "../../common/service/helpers"
import { missingStudent, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { money, params, text } from "../../common/service/zodTypes"
import { withTransaction } from "../../db/connection"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { transactionViews } from "../shared/views"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const codesSchema = z.object({
    count: z.coerce.number().int().min(1).max(200),
    amount: money.refine((value) => value > 0, "Enter a positive amount"),
    prefix: text(12).optional(),
    batch: text(120).optional(),
})
const reviewSchema = z.object({ status: z.enum(["approved", "rejected"]), amount: money.optional(), reason: text(300).optional() })
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const randomCode = () => Array.from(crypto.randomBytes(10), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("")

const wallet = [requireFeature("wallet"), can("wallet")]

router.get("/recharge-codes", wallet, send(async () => {
    const codes = await repos.rechargeCode.findall({ sort: { used: 1, createdAt: -1 }, limit: 2000 })
    const students = await studentRefs(codes.map((code) => code.usedBy))
    return codes.map((code) => ({ ...code, usedBy: code.usedBy ? missingStudent(students, code.usedBy) : null }))
}))
router.post("/recharge-codes", wallet, validation(codesSchema), send(async (req) => {
    const prefix = String(req.body.prefix || "EC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "EC"
    const batch = req.body.batch || `Batch ${new Date().toLocaleDateString("en-GB")}`
    const rows = Array.from({ length: req.body.count }, () => ({ code: `${prefix}-${randomCode()}`, amount: req.body.amount, batch }))
    return repos.rechargeCode.insertMany(rows)
}, "Codes created", 201))
router.delete("/recharge-codes/:id", wallet, send(async (req) => {
    const code = await repos.rechargeCode.findById({ id: id(req) })
    if (!code) throw new NotFoundError("Code not found")
    if (code.used) throw new ConflictError("Used codes can't be deleted")
    await repos.rechargeCode.deleteById(id(req))
    return { id: id(req) }
}))

router.get("/topups", wallet, send(async () => {
    const rows = await repos.topup.findall({ sort: { createdAt: -1 }, limit: 500 })
    const students = await studentRefs(rows.map((row) => row.student))
    return rows.map((row) => ({ ...row, student: missingStudent(students, row.student) }))
}))
router.patch("/topups/:id", wallet, validation(reviewSchema), send(async (req) => {
    const updated = await withTransaction(async () => {
        const topup = await repos.topup.findOneAndUpdate({
            filter: { _id: id(req), status: "pending" },
            data: { $set: { status: req.body.status, reason: req.body.reason ?? "", ...(req.body.amount ? { amount: req.body.amount } : {}) } },
        })
        if (!topup) throw new ConflictError("This request was already reviewed")
        if (topup.status === "approved") {
            await repos.enrollment.updateone({ filter: { student: topup.student }, data: { $inc: { balance: topup.amount } } })
            await repos.transaction.create({ student: topup.student, amount: topup.amount, type: "topup", reason: `Transfer ${topup.reference || ""} approved`.trim(), by: req.actor.id })
        }
        return topup
    })
    if (updated.status === "approved") await markActive(req.teacherId, updated.student, "topup")
    const students = await studentRefs([updated.student])
    return { ...updated, student: missingStudent(students, updated.student) }
}))
router.get("/transactions", can("wallet", "finance", "students_view"), send(async (req) => {
    const filter: any = {}
    if (req.query.type) filter.type = String(req.query.type)
    if (req.query.student) filter.student = params(req.query.student, "student")
    const range = inRangeFilter(req.query.from, req.query.to)
    if (range) filter.createdAt = range
    const limit = Math.min(Number(req.query.limit) || 300, 1000)
    return transactionViews(await repos.transaction.findall({ filter, sort: { createdAt: -1 }, limit }))
}))

export default router
