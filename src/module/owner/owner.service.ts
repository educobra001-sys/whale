import { BadRequestError, ConflictError, NotFoundError } from "../../common/exceptions/error.exceptions"
import { genertateHash } from "../../common/security/security"
import { forgetActor, forgetTeacherTeam } from "../../common/service/actorService"
import { monthKey, normalizePhone, personName, pick, sameId, sum, teacherPublic } from "../../common/service/helpers"
import { getMessagingSettings, saveMessagingSettings } from "../../common/service/settings"
import { repos } from "../../db/repository"
import billingService from "../billing/billing.service"

const TEACHER_ADMIN_FIELDS = ["email", "phone", "status", "statusNote", "confirmEmail", "referralId", "features", "pricePerStudent", "affiliate", "channels", "approvedAt"]

class OwnerService {
    private audit(actor: any, action: string, target: string, details?: unknown) {
        return repos.auditLog.create({ actor: actor.id, actorRole: actor.role, action, target, details })
    }

    async profile(id: string) {
        const owner = await repos.owner.findById({ id })
        return { ...pick(owner, ["_id", "name", "userName", "email", "referralId"]) }
    }

    async dashboard() {
        const month = monthKey()
        const [teachers, centers, students, enrollments, pendingAds, activeRows, invoices, earnings] = await Promise.all([
            repos.teacher.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            repos.center.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
            repos.student.count({}),
            repos.enrollment.count({ status: "active", archived: false }),
            repos.announcement.count({ platformStatus: "pending" }),
            repos.monthlyActive.aggregate([{ $match: { month } }, { $group: { _id: "$student" } }, { $count: "count" }]),
            repos.invoice.findall({ filter: { month }, select: "total status" }),
            repos.affiliateEarning.findall({ filter: { status: "due" }, select: "amount" }),
        ])
        const countOf = (rows: any[], key: string) => rows.find((row) => row._id === key)?.count ?? 0
        const list = await this.teachers({})
        return {
            month,
            counts: {
                teachers: countOf(teachers, "active"),
                pendingTeachers: countOf(teachers, "pending_approval"),
                pendingEmail: countOf(teachers, "pending_email"),
                centers: countOf(centers, "active"),
                pendingCenters: countOf(centers, "pending_approval"),
                students,
                enrollments,
                activeStudents: activeRows[0]?.count ?? 0,
                pendingAds,
            },
            estimate: sum(list, (row) => row.estimate),
            invoiced: sum(invoices, (row) => row.total),
            collected: sum(invoices.filter((row) => row.status === "paid"), (row) => row.total),
            affiliatesDue: sum(earnings, (row) => row.amount),
            top: [...list].sort((a, b) => b.activeStudents - a.activeStudents).slice(0, 8),
        }
    }

    private async teacherRows(teachers: any[], month: string): Promise<any[]> {
        return Promise.all(teachers.map(async (teacher) => {
            const bill = await billingService.compute(teacher, month)
            return {
                ...teacherPublic(teacher),
                ...pick(teacher, TEACHER_ADMIN_FIELDS),
                activeStudents: bill.activeStudents,
                totalStudents: bill.totalStudents,
                inactiveStudents: bill.inactiveStudents,
                estimate: bill.total,
                lines: bill.lines,
            }
        }))
    }

    async teachers(query: any) {
        const filter: any = {}
        if (query.status) filter.status = String(query.status)
        const teachers = await repos.teacher.findall({ filter, sort: { createdAt: -1 }, limit: 500 })
        return this.teacherRows(teachers, String(query.month || monthKey()))
    }

    private async own(id: string) {
        const teacher = await repos.teacher.findById({ id })
        if (!teacher) throw new NotFoundError("Teacher not found")
        return teacher
    }

    async teacher(id: string) {
        const teacher = await this.own(id)
        const [rows, rules, invoices, links] = await Promise.all([
            this.teacherRows([teacher], monthKey()),
            repos.pricingRule.findall({ filter: { teacher: id }, sort: { priority: -1 }, populate: { path: "filters.centers", select: "name" } }),
            repos.invoice.findall({ filter: { teacher: id }, sort: { month: -1 }, limit: 24 }),
            repos.centerLink.findall({ filter: { teacher: id, status: "active" }, populate: { path: "center", select: "name" } }),
        ])
        return { ...rows[0], rules, invoices, centers: links.map((link) => link.center) }
    }

    async setTeacherStatus(actor: any, id: string, { status, note }: any) {
        const teacher = await this.own(id)
        const set: any = { status, statusNote: note ?? "" }
        if (status === "active" && !teacher.approvedAt) set.approvedAt = new Date()
        if (status === "active" && !teacher.confirmEmail) throw new BadRequestError("This teacher hasn't verified their email yet")
        await repos.teacher.updateone({ filter: { _id: id }, data: { $set: set, ...(status === "suspended" ? { $inc: { tokenVersion: 1 } } : {}) } })
        await forgetTeacherTeam(id)
        await this.audit(actor, `teacher.${status}`, id, { note })
        return this.teacher(id)
    }

    features() {
        return repos.feature.findall({ sort: { order: 1 } })
    }

    async updateFeature(actor: any, id: string, data: any) {
        const feature = await repos.feature.findByIdAndUpdate({ id, data: { $set: data } })
        if (!feature) throw new NotFoundError("Section not found")
        await this.audit(actor, "feature.update", feature.key, data)
        return feature
    }

    // Confirming the plan gives the teacher only the ticked sections, at the sum of their prices per student.
    async confirmPlan(actor: any, { email, features }: any) {
        const teacher = await repos.teacher.findone({ filter: { email } })
        if (!teacher) throw new NotFoundError("No teacher has that email")
        const catalogue = await repos.feature.findall({})
        const selected = features.filter((key: string) => catalogue.some((feature) => feature.key === key))
        const pricePerStudent = billingService.planTotal(catalogue, selected)
        await repos.teacher.updateone({ filter: { _id: teacher._id }, data: { $set: { features: selected, pricePerStudent } } })
        await forgetTeacherTeam(String(teacher._id))
        await this.audit(actor, "plan.confirm", String(teacher._id), { features: selected, pricePerStudent })
        return { teacher: personName(teacher), features: selected, pricePerStudent }
    }

    async setChannels(actor: any, id: string, channels: any) {
        await this.own(id)
        const set = Object.fromEntries(Object.entries(channels).map(([key, value]) => [`channels.${key}`, value]))
        await repos.teacher.updateone({ filter: { _id: id }, data: { $set: set } })
        await this.audit(actor, "teacher.channels", id, channels)
        return this.teacher(id)
    }

    async setAffiliate(actor: any, id: string, { code, ratePerStudent }: any) {
        await this.own(id)
        if (code && !(await repos.referral.exists({ code }))) throw new NotFoundError("No account has that marketing id")
        const affiliate = code ? { code, ratePerStudent: ratePerStudent ?? 0, since: new Date() } : { code: undefined, ratePerStudent: 0, since: undefined }
        await repos.teacher.updateone({ filter: { _id: id }, data: { $set: { affiliate } } })
        await this.audit(actor, "teacher.affiliate", id, { code, ratePerStudent })
        return this.teacher(id)
    }

    async addRule(actor: any, teacherId: string, data: any) {
        await this.own(teacherId)
        const rule = await repos.pricingRule.create({ ...data, teacher: teacherId })
        await this.audit(actor, "pricing.add", teacherId, data)
        return rule.toObject()
    }

    async updateRule(actor: any, teacherId: string, ruleId: string, data: any) {
        const rule = await repos.pricingRule.findOneAndUpdate({ filter: { _id: ruleId, teacher: teacherId }, data: { $set: data } })
        if (!rule) throw new NotFoundError("Rule not found")
        await this.audit(actor, "pricing.update", teacherId, data)
        return rule
    }

    async removeRule(actor: any, teacherId: string, ruleId: string) {
        await repos.pricingRule.deleteone({ filter: { _id: ruleId, teacher: teacherId } })
        await this.audit(actor, "pricing.remove", teacherId, { ruleId })
        return { id: ruleId }
    }

    async centers(query: any) {
        const filter: any = {}
        if (query.status) filter.status = String(query.status)
        const centers = await repos.center.findall({ filter, sort: { createdAt: -1 }, limit: 500 })
        const links = await repos.centerLink.aggregate([
            { $match: { status: "active" } },
            { $group: { _id: "$center", count: { $sum: 1 } } },
        ])
        return centers.map((center) => ({
            ...pick(center, ["_id", "name", "phone", "localphone", "textlocation", "status", "statusNote", "referralId", "createdAt"]),
            teachers: links.find((row) => sameId(row._id, center._id))?.count ?? 0,
        }))
    }

    async createCenter(actor: any, data: any) {
        const phone = normalizePhone(data.phone)
        if (await repos.center.exists({ $or: [{ phone }, { name: data.name }] })) throw new ConflictError("A center with this name or phone exists")
        const center = await repos.center.create({ ...data, phone, password: await genertateHash({ plainText: data.password }), status: "active" })
        await this.audit(actor, "center.create", String(center._id))
        return pick(center.toObject(), ["_id", "name", "phone", "status", "referralId"])
    }

    async setCenterStatus(actor: any, id: string, { status, note }: any) {
        const center = await repos.center.findByIdAndUpdate({
            id,
            data: { $set: { status, statusNote: note ?? "" }, ...(status === "suspended" ? { $inc: { tokenVersion: 1 } } : {}) },
        })
        if (!center) throw new NotFoundError("Center not found")
        await forgetActor("center", id)
        await this.audit(actor, `center.${status}`, id, { note })
        return pick(center, ["_id", "name", "status"])
    }

    async billing(query: any) {
        const month = String(query.month || monthKey())
        const [rows, invoices] = await Promise.all([this.teachers({ month }), repos.invoice.findall({ filter: { month } })])
        return {
            month,
            rows: rows.filter((row) => row.status === "active" || row.activeStudents).map((row) => ({
                ...row,
                invoice: invoices.find((invoice) => sameId(invoice.teacher, row._id)) ?? null,
            })),
        }
    }

    async setInvoice(actor: any, id: string, { status, note }: any) {
        const invoice = await repos.invoice.findByIdAndUpdate({ id, data: { $set: { status, note: note ?? "", paidAt: status === "paid" ? new Date() : null } } })
        if (!invoice) throw new NotFoundError("Invoice not found")
        await this.audit(actor, `invoice.${status}`, id)
        return invoice
    }

    async affiliates(query: any) {
        const month = String(query.month || monthKey())
        const [teachers, earnings] = await Promise.all([
            repos.teacher.findall({ filter: { "affiliate.code": { $exists: true, $nin: ["", null] } } }),
            repos.affiliateEarning.findall({ filter: { month } }),
        ])
        const codes = [...new Set(teachers.map((teacher) => teacher.affiliate.code as string))]
        const owners = await repos.referral.findall({ filter: { code: { $in: codes } } })
        const rows = await Promise.all(teachers.map(async (teacher) => {
            const bill = await billingService.compute(teacher, month)
            const earning = earnings.find((row) => row.code === teacher.affiliate.code && sameId(row.teacher, teacher._id))
            return {
                code: teacher.affiliate.code,
                ownerRole: owners.find((owner) => owner.code === teacher.affiliate.code)?.role ?? "",
                teacher: teacherPublic(teacher),
                ratePerStudent: teacher.affiliate.ratePerStudent,
                activeStudents: bill.activeStudents,
                amount: Math.round(bill.activeStudents * teacher.affiliate.ratePerStudent * 100) / 100,
                earning: earning ?? null,
            }
        }))
        return { month, rows, total: sum(rows, (row) => row.amount) }
    }

    async lookupReferral(code: string) {
        const row = await repos.referral.findone({ filter: { code: code.toUpperCase() } })
        if (!row) throw new NotFoundError("No account has that marketing id")
        const repo = (repos as any)[row.role]
        const account = await repo.findById({ id: row.account })
        return { code: row.code, role: row.role, name: personName(account) || account?.userID }
    }

    async setEarning(actor: any, id: string, status: string) {
        const earning = await repos.affiliateEarning.findByIdAndUpdate({ id, data: { $set: { status, paidAt: status === "paid" ? new Date() : null } } })
        if (!earning) throw new NotFoundError("Earning not found")
        await this.audit(actor, `affiliate.${status}`, id)
        return earning
    }

    async ads(query: any) {
        const filter: any = { platformStatus: query.status ? String(query.status) : { $ne: "none" } }
        const ads = await repos.announcement.findall({ filter, sort: { updatedAt: -1 }, limit: 200, populate: { path: "teacher" } })
        return ads.map((ad) => ({ ...ad, teacher: teacherPublic(ad.teacher) }))
    }

    async reviewAd(actor: any, id: string, { status, note }: any) {
        const ad = await repos.announcement.findByIdAndUpdate({ id, data: { $set: { platformStatus: status, platformNote: note ?? "" } } })
        if (!ad) throw new NotFoundError("Ad not found")
        await this.audit(actor, `ad.${status}`, id, { note })
        return ad
    }

    async messaging() {
        const settings = await getMessagingSettings()
        return { ...settings, whatsappApi: { ...settings.whatsappApi, accessToken: settings.whatsappApi.accessToken ? "••••••" : "" } }
    }

    async updateMessaging(actor: any, data: any) {
        const patch = { ...data }
        if (patch.whatsappApi?.accessToken === "••••••" || patch.whatsappApi?.accessToken === "") delete patch.whatsappApi.accessToken
        await saveMessagingSettings(patch)
        await this.audit(actor, "messaging.update", "settings", { delaySeconds: data.delaySeconds, maxChars: data.maxChars })
        return this.messaging()
    }

    audits() {
        return repos.auditLog.findall({ sort: { createdAt: -1 }, limit: 200 })
    }
}

export default new OwnerService()
