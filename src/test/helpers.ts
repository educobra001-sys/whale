process.env.DB_NAME = "educobra_test"
process.env.RUN_WORKER = "false"
process.env.BCRYPT_ROUNDS = "4"
process.env.RATE_LIMIT_OFF = "true"
process.env.CLOUDINARY_CLOUD_NAME = ""
process.env.REDIS_URL = "redis://127.0.0.1:6479/1"

import { AddressInfo } from "node:net"
import { Server } from "node:http"
import mongoose from "mongoose"
import { createApp } from "../app.controller"
import { genertateHash } from "../common/security/security"
import { redisService } from "../common/service/redisService"
import { runAsPlatform } from "../common/service/tenantContext"
import { dbconnection } from "../db/connection"
import { repos } from "../db/repository"
import { closeQueues } from "../module/message/message.queue"
import { seedFeatures } from "../module/owner/plan.service"
import { ALL_FEATURE_KEYS } from "../common/enum/feature.enum"

let server: Server
export let base = ""

export const startServer = async () => {
    await redisService.connectRedis()
    await redisService.clear()
    await dbconnection()
    await mongoose.connection.dropDatabase()
    await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()))
    await seedFeatures()
    server = createApp().listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await runAsPlatform(async () => repos.owner.create({ name: "Owner", userName: "owner", email: "owner@test.local", password: await genertateHash({ plainText: "Owner@12345" }) }))
}

export const stopServer = async () => {
    await closeQueues()
    server.close()
    server.closeAllConnections()
    await mongoose.disconnect()
    await redisService.disconnect()
}

export interface Reply { status: number; body: any; data: any; message: string }

export const call = async (method: string, path: string, token?: string | null, body?: unknown): Promise<Reply> => {
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const parsed: any = await response.json().catch(() => ({}))
    return { status: response.status, body: parsed, data: parsed.data, message: parsed.message }
}

export const login = async (role: string, identifier: string, password: string) => {
    const reply = await call("POST", `/login/${role}`, null, { identifier, password })
    if (reply.status !== 200) throw new Error(`login ${role} failed: ${reply.status} ${reply.message}`)
    return reply.data.accessToken as string
}

export const ownerToken = () => login("owner", "owner", "Owner@12345")

let counter = 0
export const unique = () => {
    counter += 1
    return counter
}

// Registers a teacher through the real flow and returns a working token.
export const makeTeacher = async (owner: string, { features = ALL_FEATURE_KEYS, visibility = "public" }: { features?: string[]; visibility?: string } = {}) => {
    const n = unique()
    const email = `teacher${n}@test.local`
    const signup = await call("POST", "/signup/teacher", null, {
        firstName: `Teacher${n}`, lastName: "Test", userName: `teacher${n}`, email,
        phone: `0100000${String(n).padStart(4, "0")}`, password: "Teacher@123", subject: ["Physics"], teachingLanguage: "Arabic",
    })
    if (signup.status !== 201) throw new Error(`signup failed: ${signup.message}`)
    await call("POST", "/verify-acc", null, { identifier: email, otp: signup.data.devCode })
    const profile = await runAsPlatform(() => repos.teacher.findone({ filter: { email } }))
    await call("PATCH", `/owner/teachers/${profile._id}/status`, owner, { status: "active" })
    await call("POST", "/owner/plans/confirm", owner, { email, features })
    const token = await login("teacher", email, "Teacher@123")
    await call("PATCH", "/teacher/profile", token, { visibility })
    return { token, id: String(profile._id), email, userName: `teacher${n}` }
}

export const makeStudent = async (token: string, extra: any = {}) => {
    const n = unique()
    const reply = await call("POST", "/teacher/myStudents", token, {
        firstName: `Student${n}`, lastName: "Test", phone: `0111000${String(n).padStart(4, "0")}`,
        parentPhone: `0122000${String(n).padStart(4, "0")}`, grade: "1", ...extra,
    })
    if (reply.status !== 201) throw new Error(`student failed: ${reply.message}`)
    return { id: String(reply.data.student._id), userID: reply.data.userID as string, password: reply.data.password as string, phone: reply.data.student.phone as string, parentPhone: reply.data.student.parentPhone as string }
}

export const startSession = async (token: string, extra: any = {}) => {
    const created = await call("POST", "/teacher/sessions", token, { sequence: "Lesson", week: 1, number: unique() % 900 + 1, ...extra })
    if (created.status !== 201) throw new Error(`session failed: ${created.message}`)
    await call("PATCH", `/teacher/sessions/${created.data._id}/active`, token, { active: true })
    return String(created.data._id)
}
