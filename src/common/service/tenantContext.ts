import { AsyncLocalStorage } from "node:async_hooks"
import { Types } from "mongoose"

interface TenantStore {
    teacherId?: string
    platform?: boolean
}

const storage = new AsyncLocalStorage<TenantStore>()

export const currentTenant = () => storage.getStore()

// Every query on a teacher-owned collection inside `fn` is forced onto this teacher.
export const runWithTeacher = <T>(teacherId: string | Types.ObjectId, fn: () => T): T =>
    storage.run({ teacherId: String(teacherId) }, fn)

// Deliberately leaves the teacher scope. Use only where a query must cross teachers:
// sign-in, the global student registry, the owner portal, the student's own list of teachers.
export const runAsPlatform = <T>(fn: () => T): T => storage.run({ platform: true }, fn)
