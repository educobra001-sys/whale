import { ALL_FEATURE_KEYS } from "../../common/enum/feature.enum"
import { monthKey, sameId } from "../../common/service/helpers"
import { runAsPlatform } from "../../common/service/tenantContext"
import { repos } from "../../db/repository"

const matches = (rule: any, student: any, entry: any) => {
    const filters = rule.filters ?? {}
    if (filters.grades?.length && !filters.grades.includes(String(student?.grade))) return false
    if (filters.centers?.length && !filters.centers.some((center: unknown) => sameId(center, entry?.center))) return false
    if (filters.students?.length && !filters.students.includes(student?.userID)) return false
    const joined = entry?.joinedAt ? new Date(entry.joinedAt) : null
    if (filters.joinedAfter && !(joined && joined >= new Date(filters.joinedAfter))) return false
    if (filters.joinedBefore && !(joined && joined <= new Date(filters.joinedBefore))) return false
    return true
}

class BillingService {
    // Prices a month for one teacher. Each active student is charged by the first matching rule, or the plan price.
    compute(teacher: any, month: string) {
        return runAsPlatform(async () => {
            const teacherId = teacher._id
            const [active, totalStudents, rules] = await Promise.all([
                repos.monthlyActive.findall({ filter: { teacher: teacherId, month }, select: "student" }),
                repos.enrollment.count({ teacher: teacherId, status: "active", archived: false }),
                repos.pricingRule.findall({ filter: { teacher: teacherId, isActive: true }, sort: { priority: -1, createdAt: 1 } }),
            ])
            const ids = active.map((row) => row.student)
            const [students, entries] = await Promise.all([
                rules.length ? repos.student.findall({ filter: { _id: { $in: ids } }, select: "grade userID" }) : Promise.resolve([]),
                rules.length ? repos.enrollment.findall({ filter: { teacher: teacherId, student: { $in: ids } }, select: "student center joinedAt" }) : Promise.resolve([]),
            ])
            const studentById = new Map(students.map((student) => [String(student._id), student]))
            const entryById = new Map(entries.map((entry) => [String(entry.student), entry]))
            const groups = new Map<string, { label: string; price: number; count: number }>()
            for (const id of ids) {
                const rule = rules.find((item) => matches(item, studentById.get(String(id)), entryById.get(String(id))))
                const key = rule ? String(rule._id) : "plan"
                const group = groups.get(key) ?? { label: rule?.name ?? "Plan price", price: rule ? rule.price : teacher.pricePerStudent, count: 0 }
                group.count += 1
                groups.set(key, group)
            }
            const lines = [...groups.values()].map((group) => ({ ...group, amount: Math.round(group.count * group.price * 100) / 100 }))
            return {
                teacher: teacherId,
                month,
                activeStudents: ids.length,
                totalStudents,
                inactiveStudents: Math.max(0, totalStudents - ids.length),
                lines,
                total: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100,
            }
        })
    }

    async teacherView(teacherId: string) {
        return runAsPlatform(async () => {
            const teacher = await repos.teacher.findById({ id: teacherId })
            const month = monthKey()
            const [current, rules, invoices, features] = await Promise.all([
                this.compute(teacher, month),
                repos.pricingRule.findall({ filter: { teacher: teacherId, isActive: true }, sort: { priority: -1 } }),
                repos.invoice.findall({ filter: { teacher: teacherId }, sort: { month: -1 }, limit: 24 }),
                repos.feature.findall({ filter: { key: { $in: teacher.features } }, sort: { order: 1 } }),
            ])
            return {
                pricePerStudent: teacher.pricePerStudent,
                current,
                rules: rules.map((rule) => ({ _id: rule._id, name: rule.name, price: rule.price })),
                invoices,
                features,
            }
        })
    }

    // Writes invoices and affiliate earnings for a month. Paid ones stay untouched, so it's safe to run again.
    generateMonth(month: string) {
        return runAsPlatform(async () => {
            const teachers = await repos.teacher.findall({ filter: { status: { $in: ["active", "suspended"] } } })
            let invoices = 0
            let earnings = 0
            for (const teacher of teachers) {
                const bill = await this.compute(teacher, month)
                if (!bill.activeStudents && !bill.total) continue
                const paid = await repos.invoice.exists({ teacher: teacher._id, month, status: "paid" })
                if (!paid) {
                    await repos.invoice.updateone({
                        filter: { teacher: teacher._id, month },
                        data: { $set: { activeStudents: bill.activeStudents, totalStudents: bill.totalStudents, lines: bill.lines, total: bill.total } },
                        options: { upsert: true },
                    })
                    invoices += 1
                }
                const deal = teacher.affiliate
                if (deal?.code && deal.ratePerStudent > 0) {
                    const settled = await repos.affiliateEarning.exists({ code: deal.code, teacher: teacher._id, month, status: "paid" })
                    if (!settled) {
                        await repos.affiliateEarning.updateone({
                            filter: { code: deal.code, teacher: teacher._id, month },
                            data: { $set: { activeStudents: bill.activeStudents, rate: deal.ratePerStudent, amount: Math.round(bill.activeStudents * deal.ratePerStudent * 100) / 100 } },
                            options: { upsert: true },
                        })
                        earnings += 1
                    }
                }
            }
            return { month, invoices, earnings }
        })
    }

    planTotal(features: { key: string; price: number }[], selected: string[]) {
        const known = selected.filter((key) => ALL_FEATURE_KEYS.includes(key) || features.some((feature) => feature.key === key))
        return Math.round(features.filter((feature) => known.includes(feature.key)).reduce((sum, feature) => sum + feature.price, 0) * 100) / 100
    }
}

export default new BillingService()
