import { NotFoundError } from "../../common/exceptions/error.exceptions"
import { centerPublic, escapeRegex, sameId, teacherPublic } from "../../common/service/helpers"
import { redisService } from "../../common/service/redisService"
import { repos } from "../../db/repository"

const activeCounts = async (teacherIds: unknown[]) => {
    const rows = await repos.enrollment.aggregate([
        { $match: { teacher: { $in: teacherIds }, status: "active", archived: false } },
        { $group: { _id: "$teacher", count: { $sum: 1 } } },
    ])
    return new Map(rows.map((row) => [String(row._id), row.count as number]))
}

class DirectoryService {
    // A student also finds private teachers they already belong to.
    private async visibleFilter(actor: any) {
        const base: any = { status: "active" }
        if (actor?.role === "student") {
            const mine = await repos.enrollment.distinct("teacher", { student: actor.id, archived: false })
            return { ...base, $or: [{ visibility: "public" }, { _id: { $in: mine } }] }
        }
        return { ...base, visibility: "public" }
    }

    async searchTeachers(query: any, actor: any) {
        const load = async () => {
            const filter: any = await this.visibleFilter(actor)
            const needle = String(query.q ?? "").trim().slice(0, 60)
            if (needle) {
                const pattern = new RegExp(escapeRegex(needle), "i")
                filter.$and = [{ $or: [{ firstName: pattern }, { lastName: pattern }, { userName: pattern }, { companyName: pattern }] }]
            }
            if (query.subject) filter.subject = String(query.subject)
            const teachers = await repos.teacher.findall({ filter, limit: 60, sort: { approvedAt: -1 } })
            const ids = teachers.map((teacher) => teacher._id)
            const [counts, links] = await Promise.all([
                activeCounts(ids),
                repos.centerLink.findall({ filter: { teacher: { $in: ids }, status: "active" }, populate: { path: "center", select: "name" } }),
            ])
            return teachers.map((teacher) => ({
                ...teacherPublic(teacher),
                studentsCount: counts.get(String(teacher._id)) ?? 0,
                centers: links.filter((link) => sameId(link.teacher, teacher._id)).map((link) => link.center?.name).filter(Boolean),
            }))
        }
        if (actor) return load()
        return redisService.cached(`directory:${String(query.q ?? "")}:${String(query.subject ?? "")}`, 60, load)
    }

    async teacher(id: string, actor: any) {
        const teacher = await repos.teacher.findone({ filter: { _id: id, ...(await this.visibleFilter(actor)) } })
        if (!teacher) throw new NotFoundError("Teacher not found")
        const [counts, links, schedule, lessons] = await Promise.all([
            activeCounts([teacher._id]),
            repos.centerLink.findall({ filter: { teacher: id, status: "active" }, populate: "center" }),
            repos.schedule.findall({ filter: { teacher: id, isActive: true } }),
            repos.lesson.findall({ filter: { teacher: id, published: true }, select: "title description week isFree price grade", sort: { week: 1, order: 1 }, limit: 100 }),
        ])
        const centers = links.map((link) => centerPublic(link.center)).filter(Boolean)
        return {
            ...teacherPublic(teacher),
            studentsCount: counts.get(String(teacher._id)) ?? 0,
            centers,
            schedule: schedule.map((slot) => ({
                ...slot,
                centerName: centers.find((center: any) => sameId(center._id, slot.center))?.name ?? "",
                teacher: teacherPublic(teacher),
            })),
            lessons,
        }
    }

    async searchCenters(query: any) {
        const needle = String(query.q ?? "").trim().slice(0, 60)
        const filter: any = { status: "active" }
        if (needle) {
            const pattern = new RegExp(escapeRegex(needle), "i")
            filter.$or = [{ name: pattern }, { textlocation: pattern }]
        }
        const centers = await repos.center.findall({ filter, limit: 60 })
        return centers.map(centerPublic)
    }
}

export default new DirectoryService()
