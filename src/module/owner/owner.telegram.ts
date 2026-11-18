import { NotFoundError } from "../../common/exceptions/error.exceptions"
import { escapeRegex, personName, sameId } from "../../common/service/helpers"
import { repos } from "../../db/repository"

// Who opened the bot and which student each chat receives messages for.
export const handleTelegramLinks = async (query: any) => {
    const search = String(query.search ?? "").trim().slice(0, 60)
    const filter: any = {}
    if (search) {
        const pattern = new RegExp(escapeRegex(search), "i")
        const students = await repos.student.findall({ filter: { $or: [{ firstName: pattern }, { lastName: pattern }, { userID: pattern }, { phone: pattern }, { parentPhone: pattern }] }, select: "_id", limit: 500 })
        filter.$or = [{ student: { $in: students.map((row) => row._id) } }, { phone: pattern }, { telegramName: pattern }, { telegramUsername: pattern }]
    }
    const links = await repos.telegramLink.findall({ filter, sort: { createdAt: -1 }, limit: 300 })
    const students = await repos.student.findall({ filter: { _id: { $in: links.map((link) => link.student) } }, select: "firstName lastName userID phone parentPhone" })
    return links.map((link) => {
        const student = students.find((row) => sameId(row._id, link.student))
        return {
            _id: link._id,
            kind: link.kind,
            phone: link.phone ?? "",
            telegramName: link.telegramName ?? "",
            telegramUsername: link.telegramUsername ?? "",
            createdAt: link.createdAt,
            student: student ? { _id: student._id, name: personName(student), userID: student.userID, phone: student.phone, parentPhone: student.parentPhone } : null,
        }
    })
}

export const removeTelegramLink = async (id: string) => {
    const link = await repos.telegramLink.findById({ id })
    if (!link) throw new NotFoundError("Link not found")
    await repos.telegramLink.deleteById(id)
    return { _id: id }
}
