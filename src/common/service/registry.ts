import { ConflictError } from "../exceptions/error.exceptions"
import { repos } from "../../db/repository"
import { nameKey, normalizePhone, personName } from "./helpers"

// The platform-wide student registry. A student has one account and one id, whichever teacher added them.
export const nextStudentId = async () => {
    const counter = await repos.counter.findOneAndUpdate({
        filter: { _id: "studentUserID" },
        data: { $inc: { sequence: 1 } },
        options: { upsert: true },
    })
    return `STU-${String(counter.sequence).padStart(6, "0")}`
}

// Same phone, or same name with the same parent phone, is the same person.
export const findExistingStudent = (data: { phone?: string; parentPhone?: string; firstName?: string; lastName?: string }) => {
    const phone = normalizePhone(data.phone)
    const parentPhone = normalizePhone(data.parentPhone)
    const or: any[] = []
    if (phone) or.push({ phone })
    if (parentPhone) or.push({ nameKey: nameKey(data.firstName, data.lastName), parentPhone })
    return or.length ? repos.student.findone({ filter: { $or: or } }) : Promise.resolve(null)
}

export const duplicateStudentError = (student: any) =>
    new ConflictError(`This student is already registered on EduCobra. Their ID is ${student.userID}.`, {
        code: "STUDENT_EXISTS",
        userID: student.userID,
        name: personName(student),
    })
