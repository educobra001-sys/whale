import { Router } from "express"
import { z } from "zod"
import { send } from "../../common/exceptions/successresponce"
import { DAY, inRangeFilter, sum } from "../../common/service/helpers"
import { centerNames } from "../../common/service/lookups"
import { validation } from "../../common/service/validation"
import { dateText, money, params, text } from "../../common/service/zodTypes"
import { repos } from "../../db/repository"
import { can, requireFeature } from "../../middleware/auth.middleware"
import { leaderboard } from "../shared/reports"
import { closingTotals, sessionLabel } from "../shared/views"
import teacherService from "../teacher/teacher.service"

const router: Router = Router()
const expenseSchema = z.object({ amount: money, reason: z.string().trim().min(1).max(300), category: text(60).optional(), date: dateText.optional() })
const finance = [requireFeature("finance"), can("finance")]
const dayKey = (value: any) => new Date(value).toISOString().slice(0, 10)

router.get("/finance", finance, send(async (req) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10))
    const to = String(req.query.to || new Date().toISOString().slice(0, 10))
    const range = inRangeFilter(from, to)
    const [txs, sessions, orders, expenses, assistants] = await Promise.all([
        repos.transaction.findall({ filter: { createdAt: range } }),
        repos.session.findall({ filter: { status: "normal", date: range }, sort: { date: -1 } }),
        repos.bookletOrder.findall({ filter: { status: { $ne: "rejected" }, createdAt: range } }),
        repos.expense.findall({ filter: { date: range } }),
        repos.assistant.findall({}),
    ])
    const salaryRows = await Promise.all(assistants.map(async (assistant) => {
        if ((assistant.salary?.type ?? "fixed") === "fixed") return 0
        return teacherService.salary(assistant, await teacherService.staffEntries(assistant._id, from, to))
    }))
    const salaries = sum(salaryRows, (value) => value)
    const closings = sessions.map((session) => closingTotals(session)?.total ?? 0)
    const centerCosts = sum(closings, (value) => value)
    const byType = (type: string) => sum(txs.filter((tx) => tx.type === type), (tx) => tx.amount)
    const cash = byType("payment")
    const recharge = byType("recharge")
    const topups = byType("topup")
    const booklets = sum(orders, (order) => order.paid)
    const expenseTotal = sum(expenses, (expense) => expense.amount)
    const income = cash + recharge + topups + booklets
    const days: any[] = []
    for (let time = new Date(from).getTime(); time <= new Date(to).getTime() && days.length < 400; time += DAY) {
        const day = new Date(time).toISOString().slice(0, 10)
        days.push({
            date: day,
            income: sum(txs.filter((tx) => ["payment", "recharge", "topup"].includes(tx.type) && dayKey(tx.createdAt) === day), (tx) => tx.amount)
                + sum(orders.filter((order) => dayKey(order.createdAt) === day), (order) => order.paid),
            expenses: sum(expenses.filter((expense) => dayKey(expense.date) === day), (expense) => expense.amount),
        })
    }
    const names = await centerNames(sessions.map((session) => session.center))
    return {
        from, to,
        totals: { cash, recharge, topups, booklets, income, expenses: expenseTotal, centerCosts, salaries, net: income - expenseTotal - centerCosts - salaries, charged: -byType("attendance") },
        byDay: days,
        sessions: sessions.map((session, index) => ({
            _id: session._id, label: sessionLabel(session), date: session.date,
            centerName: session.center ? names.get(String(session.center)) ?? "" : "",
            present: session.presentCount, collected: session.collected,
            charged: -sum(txs.filter((tx) => tx.type === "attendance" && String(tx.session) === String(session._id)), (tx) => tx.amount),
            centerCost: closings[index],
        })),
    }
}))
router.get("/expenses", finance, send((req) => {
    const range = inRangeFilter(req.query.from, req.query.to)
    return repos.expense.findall({ filter: range ? { date: range } : {}, sort: { date: -1 }, limit: 1000 })
}))
router.post("/expenses", finance, validation(expenseSchema), send(async (req) => {
    const expense = await repos.expense.create({ ...req.body, date: req.body.date ? new Date(req.body.date) : new Date() })
    return expense.toObject()
}, "Expense added", 201))
router.delete("/expenses/:id", finance, send(async (req) => {
    await repos.expense.deleteone({ filter: { _id: params(req.params.id) } })
    return { id: req.params.id }
}))
router.get("/leaderboard", requireFeature("leaderboard"), send(() => leaderboard()))

export default router
