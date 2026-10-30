import { repos } from "../../db/repository"
import { personName, studentRefOf, STUDENT_REF_SELECT } from "./helpers"

const unique = (ids: unknown[]) => [...new Set(ids.filter((id) => id && id !== "system").map(String))]

// Batched lookups: a page loads every related name in one query instead of one query per row.
export const centerNames = async (ids: unknown[]) => {
    const list = unique(ids)
    if (!list.length) return new Map<string, string>()
    const rows = await repos.center.findall({ filter: { _id: { $in: list } }, select: "name" })
    return new Map(rows.map((row) => [String(row._id), row.name as string]))
}

export const studentRefs = async (ids: unknown[]) => {
    const list = unique(ids)
    if (!list.length) return new Map<string, any>()
    const rows = await repos.student.findall({ filter: { _id: { $in: list } }, select: STUDENT_REF_SELECT })
    return new Map(rows.map((row) => [String(row._id), studentRefOf(row)]))
}

// Names of whoever did something: a teacher, an assistant, a student or the system.
export const peopleRefs = async (ids: unknown[]) => {
    const list = unique(ids)
    const found = new Map<string, any>([["system", { _id: "system", name: "System" }]])
    if (!list.length) return found
    const select = "firstName lastName userName name"
    const filter = { _id: { $in: list } }
    const groups = await Promise.all([
        repos.teacher.findall({ filter, select }),
        repos.assistant.findall({ filter, select }),
        repos.student.findall({ filter, select: "firstName lastName" }),
    ])
    for (const person of groups.flat()) found.set(String(person._id), { _id: person._id, name: personName(person) })
    return found
}

export const refOf = (map: Map<string, any>, id: unknown) => {
    if (!id) return null
    return map.get(String(id)) ?? { _id: id, name: "—" }
}

export const missingStudent = (map: Map<string, any>, id: unknown) => map.get(String(id)) ?? studentRefOf(null, id)
