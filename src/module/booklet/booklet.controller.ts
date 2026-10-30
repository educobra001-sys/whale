import { Router } from "express"
import { z } from "zod"
import { ConflictError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { pick, sum } from "../../common/service/helpers"
import { missingStudent, studentRefs } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { money, objectId, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"

const router: Router = Router()
const id = (req: any) => params(req.params.id)

const bookletSchema = z.object({
    name: z.string().trim().min(1).max(200),
    grade: z.string().max(4).optional(),
    printPrice: money.optional(),
    sellPrice: money,
    stock: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
})
const orderSchema = z.object({ booklet: objectId, student: objectId, price: money.optional(), paid: money.optional(), delivered: z.boolean().optional() })
const orderUpdateSchema = z.object({ paid: money.optional(), price: money.optional(), delivered: z.boolean().optional(), status: text(20).optional() })
const FIELDS = ["name", "grade", "printPrice", "sellPrice", "stock", "isActive"]

const bookletView = async (booklet: any) => {
    const orders = await repos.bookletOrder.findall({ filter: { booklet: booklet._id, status: { $ne: "rejected" } } })
    return {
        ...booklet,
        sold: orders.length,
        delivered: orders.filter((order) => order.delivered).length,
        collected: sum(orders, (order) => order.paid),
        outstanding: sum(orders, (order) => order.price - order.paid),
    }
}

const orderViews = async (orders: any[]) => {
    const students = await studentRefs(orders.map((order) => order.student))
    return orders.map((order) => ({ ...order, student: missingStudent(students, order.student) }))
}

const own = async (bookletId: string) => {
    const booklet = await repos.booklet.findById({ id: bookletId })
    if (!booklet) throw new NotFoundError("Booklet not found")
    return booklet
}

router.use("/booklets", requireFeature("booklets"), can("booklets"))
router.get("/booklets/orders", send(async () => orderViews(await repos.bookletOrder.findall({ sort: { createdAt: -1 }, populate: { path: "booklet", select: "name sellPrice" } }))))
router.post("/booklets/orders", validation(orderSchema), send(async (req) => {
    const booklet = await own(req.body.booklet)
    const exists = await repos.bookletOrder.exists({ booklet: booklet._id, student: req.body.student, status: { $ne: "rejected" } })
    if (exists) throw new ConflictError("This student already has this booklet")
    const order = await repos.bookletOrder.create({
        booklet: booklet._id, student: req.body.student,
        price: req.body.price ?? booklet.sellPrice, paid: req.body.paid ?? 0,
        delivered: Boolean(req.body.delivered), deliveredAt: req.body.delivered ? new Date() : null,
        method: "center", status: "verified",
    })
    if (order.delivered) await repos.booklet.updateone({ filter: { _id: booklet._id, stock: { $gt: 0 } }, data: { $inc: { stock: -1 } } })
    return (await orderViews([{ ...order.toObject(), booklet: pick(booklet, ["_id", "name", "sellPrice"]) }]))[0]
}, "Order added", 201))
router.patch("/booklets/orders/:id", validation(orderUpdateSchema), send(async (req) => {
    const order = await repos.bookletOrder.findById({ id: id(req) })
    if (!order) throw new NotFoundError("Order not found")
    const data: any = pick(req.body, ["paid", "price", "delivered", "status"])
    if (req.body.delivered === true && !order.delivered) {
        data.deliveredAt = new Date()
        await repos.booklet.updateone({ filter: { _id: order.booklet, stock: { $gt: 0 } }, data: { $inc: { stock: -1 } } })
    }
    const updated = await repos.bookletOrder.findByIdAndUpdate({ id: id(req), data: { $set: data }, populate: { path: "booklet", select: "name sellPrice" } })
    return (await orderViews([updated]))[0]
}))
router.get("/booklets", send(async () => Promise.all((await repos.booklet.findall({ sort: { createdAt: -1 } })).map(bookletView))))
router.post("/booklets", validation(bookletSchema), send(async (req) => bookletView((await repos.booklet.create(pick(req.body, FIELDS))).toObject()), "Booklet added", 201))
router.patch("/booklets/:id", validation(bookletSchema.partial()), send(async (req) => {
    await own(id(req))
    return bookletView(await repos.booklet.findByIdAndUpdate({ id: id(req), data: { $set: pick(req.body, FIELDS) } }))
}))
router.delete("/booklets/:id", send(async (req) => {
    await own(id(req))
    if (await repos.bookletOrder.exists({ booklet: id(req) })) throw new ConflictError("This booklet has orders. Hide it instead of deleting it.")
    await repos.booklet.deleteById(id(req))
    return { id: id(req) }
}))

export default router
