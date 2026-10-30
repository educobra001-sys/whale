import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import mongoose from "mongoose"
import { runAsPlatform, runWithTeacher } from "../common/service/tenantContext"
import { repos } from "../db/repository"
import { call, login, makeStudent, makeTeacher, ownerToken, startServer, startSession, stopServer } from "./helpers"

let owner = ""
let a: any
let b: any
let shared: any
let secretA: any
const SECRET = "SECRET-OF-TEACHER-A"
const ids: Record<string, string> = {}

before(async () => {
    await startServer()
    owner = await ownerToken()
    a = await makeTeacher(owner)
    b = await makeTeacher(owner)

    shared = await makeStudent(a.token)
    await call("POST", "/teacher/myStudents/link", b.token, { identifier: shared.userID })
    secretA = await makeStudent(a.token, { firstName: SECRET })
    await call("POST", `/teacher/myStudents/${shared.id}/balance`, a.token, { amount: 777, reason: SECRET })
    await call("POST", `/teacher/myStudents/${shared.id}/warnings`, a.token, { reason: SECRET })
    await call("PATCH", `/teacher/myStudents/${shared.id}`, a.token, { adminNote: SECRET })

    const session = await startSession(a.token, { sequence: SECRET })
    ids.session = session
    await call("POST", `/teacher/sessions/${session}/attendance`, a.token, { identifier: shared.userID, comment: SECRET })
    ids.exam = (await call("POST", "/teacher/exams", a.token, { name: SECRET, maxScore: 10 })).data._id
    ids.homework = (await call("POST", "/teacher/homework", a.token, { title: SECRET, startDate: "2026-01-01", endDate: "2099-01-01" })).data._id
    ids.lesson = (await call("POST", "/teacher/lessons", a.token, { title: SECRET, published: true, parts: [{ title: "p", url: `https://video.test/${SECRET}` }] })).data._id
    ids.booklet = (await call("POST", "/teacher/booklets", a.token, { name: SECRET, sellPrice: 10 })).data._id
    ids.slot = (await call("POST", "/teacher/schedule", a.token, { dayOfWeek: 1, startTime: "10:00", title: SECRET })).data._id
    ids.announcement = (await call("POST", "/teacher/announcements", a.token, { title: SECRET })).data._id
    ids.code = (await call("POST", "/teacher/recharge-codes", a.token, { count: 1, amount: 50, batch: SECRET })).data[0]._id
    ids.expense = (await call("POST", "/teacher/expenses", a.token, { amount: 1, reason: SECRET })).data._id
    ids.assistant = (await call("POST", "/teacher/assistants", a.token, { firstName: SECRET, userName: "assistantA", email: "assistanta@test.local", phone: "01200000001", password: "Assist@123" })).data._id
    await call("POST", "/teacher/follow-up/comments", a.token, { student: shared.id, comment: SECRET })
})
after(stopServer)

test("teacher B sees nothing of teacher A on any list or detail page", async () => {
    const reads = [
        "/teacher/profile", "/teacher/dashboard", "/teacher/myStudents", `/teacher/myStudents/${shared.id}`, `/teacher/myStudents/${shared.id}/history`,
        `/teacher/myStudents/${secretA.id}`, `/teacher/myStudents/${secretA.id}/history`, "/teacher/requests", "/teacher/archive",
        "/teacher/sessions", `/teacher/sessions/${ids.session}`, `/teacher/scan/lookup?identifier=${shared.userID}`, `/teacher/scan/lookup?identifier=${secretA.userID}`,
        "/teacher/schedule", "/teacher/exams", `/teacher/exams/${ids.exam}`, "/teacher/homework", `/teacher/homework/${ids.homework}/submissions`,
        "/teacher/lessons", `/teacher/lessons/${ids.lesson}`, `/teacher/lessons/${ids.lesson}/answers`, "/teacher/booklets", "/teacher/booklets/orders",
        "/teacher/recharge-codes", "/teacher/topups", "/teacher/transactions", `/teacher/transactions?student=${shared.id}`, "/teacher/announcements",
        "/teacher/follow-up", "/teacher/assistants", `/teacher/assistants/${ids.assistant}/stats`, "/teacher/centers", "/teacher/finance",
        "/teacher/expenses", "/teacher/leaderboard", "/teacher/billing", "/teacher/messages/config", "/teacher/messages/batches", "/teacher/links",
    ]
    for (const path of reads) {
        const reply = await call("GET", path, b.token)
        assert.notEqual(reply.status, 500, `${path}: ${reply.message}`)
        const text = JSON.stringify(reply.body)
        assert.ok(!text.includes(SECRET), `${path} leaked teacher A's data`)
        assert.ok(!text.includes(secretA.userID), `${path} leaked a student of teacher A`)
    }
})

test("shared student: B sees the person but none of A's money, notes or warnings", async () => {
    const reply = await call("GET", `/teacher/myStudents/${shared.id}`, b.token)
    assert.equal(reply.status, 200)
    assert.equal(reply.data.balance, 0)
    assert.equal(reply.data.warningsCount, 0)
    assert.equal(reply.data.adminNote, "")
    assert.equal(reply.data.lastAttendedAt, null)
})

test("teacher B cannot change anything of teacher A", async () => {
    const writes: [string, string, any][] = [
        ["PATCH", `/teacher/sessions/${ids.session}`, { sequence: "hacked" }],
        ["PATCH", `/teacher/sessions/${ids.session}/active`, { active: true }],
        ["DELETE", `/teacher/sessions/${ids.session}`, undefined],
        ["POST", `/teacher/sessions/${ids.session}/attendance`, { identifier: shared.userID }],
        ["DELETE", `/teacher/sessions/${ids.session}/attendance/${shared.id}`, undefined],
        ["PUT", `/teacher/sessions/${ids.session}/closing`, { normalCost: 1 }],
        ["PATCH", `/teacher/exams/${ids.exam}`, { name: "hacked" }],
        ["DELETE", `/teacher/exams/${ids.exam}`, undefined],
        ["PATCH", `/teacher/homework/${ids.homework}`, { title: "hacked" }],
        ["DELETE", `/teacher/homework/${ids.homework}`, undefined],
        ["PATCH", `/teacher/lessons/${ids.lesson}`, { title: "hacked" }],
        ["DELETE", `/teacher/lessons/${ids.lesson}`, undefined],
        ["PATCH", `/teacher/booklets/${ids.booklet}`, { name: "hacked" }],
        ["DELETE", `/teacher/booklets/${ids.booklet}`, undefined],
        ["PATCH", `/teacher/schedule/${ids.slot}`, { title: "hacked" }],
        ["PATCH", `/teacher/announcements/${ids.announcement}`, { title: "hacked" }],
        ["DELETE", `/teacher/recharge-codes/${ids.code}`, undefined],
        ["PATCH", `/teacher/assistants/${ids.assistant}`, { role: "Admin" }],
        ["DELETE", `/teacher/assistants/${ids.assistant}`, undefined],
        ["POST", `/teacher/myStudents/${secretA.id}/balance`, { amount: 100 }],
        ["PATCH", `/teacher/myStudents/${secretA.id}`, { adminNote: "hacked" }],
        ["DELETE", `/teacher/myStudents/${secretA.id}`, {}],
    ]
    for (const [method, path, body] of writes) {
        const reply = await call(method, path, b.token, body)
        assert.equal(reply.status, 404, `${method} ${path} returned ${reply.status}: ${reply.message}`)
    }
    assert.equal((await call("GET", `/teacher/sessions/${ids.session}`, a.token)).data.sequence, SECRET)
    assert.equal((await call("GET", `/teacher/exams/${ids.exam}`, a.token)).data.name, SECRET)
})

test("a query with no tenant scope is refused, it never reads everything", async () => {
    await assert.rejects(() => repos.session.findall({}), /Unscoped access/)
    await assert.rejects(() => repos.transaction.count({}), /Unscoped access/)
    await assert.rejects(() => repos.enrollment.aggregate([{ $match: {} }]), /Unscoped access/)
    await assert.rejects(() => repos.session.create({ sequence: "x", week: 1, number: 1 }), /Unscoped access/)
})

test("inside a teacher scope, a filter asking for another teacher is overridden and cross writes are refused", async () => {
    const rows = await runWithTeacher(b.id, () => repos.session.findall({ filter: { teacher: a.id } }))
    assert.equal(rows.length, 0)
    await assert.rejects(() => runWithTeacher(b.id, () => repos.session.create({ teacher: a.id, sequence: "x", week: 1, number: 1 })), /Cross-teacher/)
    const ownerView = await runAsPlatform(() => repos.session.count({ teacher: a.id }))
    assert.ok(ownerView >= 1)
})

test("every teacher-owned model is under the tenant guard", () => {
    const unguarded = ["Teacher", "Student", "Center", "Parent", "Owner", "Counter", "ReferralCode", "CenterLink", "TeacherLink", "Feature", "PricingRule", "Invoice", "AffiliateEarning", "PlatformSetting", "TelegramLink", "AuditLog"]
    for (const [name, model] of Object.entries(mongoose.models)) {
        if (unguarded.includes(name)) continue
        assert.ok(model.schema.path("teacher"), `${name} has no teacher field`)
    }
})

test("a student only reaches teachers they belong to", async () => {
    const token = await login("student", secretA.userID, secretA.password)
    assert.equal((await call("GET", `/student/teachers/${a.id}/overview`, token)).status, 200)
    assert.equal((await call("GET", `/student/teachers/${b.id}/overview`, token)).status, 403)
    assert.equal((await call("GET", `/student/teachers/${b.id}/lessons`, token)).status, 403)
    const other = await makeTeacher(owner)
    const lesson = (await call("POST", "/teacher/lessons", other.token, { title: "private", published: true })).data._id
    assert.equal((await call("GET", `/student/lessons/${lesson}`, token)).status, 403)
})

test("a center gets numbers but never student details", async () => {
    await call("POST", "/signup/center", null, { name: "Iso Center", phone: "01033334444", password: "Center@123" })
    const list = await call("GET", "/owner/centers", owner)
    const center = list.data.find((row: any) => row.name === "Iso Center")
    await call("PATCH", `/owner/centers/${center._id}/status`, owner, { status: "active" })
    const token = await login("center", "Iso Center", "Center@123")
    await call("POST", `/teacher/centers/${center._id}/request`, a.token)
    await call("PATCH", `/center/teachers/${a.id}`, token, { status: "active" })
    await call("PATCH", `/teacher/myStudents/${secretA.id}`, a.token, { center: center._id })
    const session = await call("POST", "/teacher/sessions", a.token, { sequence: "at center", week: 2, number: 77, center: center._id })
    await call("PATCH", `/teacher/sessions/${session.data._id}/active`, a.token, { active: true })
    await call("POST", `/teacher/sessions/${session.data._id}/attendance`, a.token, { identifier: secretA.userID, force: true })
    for (const path of ["/center/teachers", "/center/sessions", "/center/dashboard", "/center/schedule"]) {
        const reply = await call("GET", path, token)
        assert.equal(reply.status, 200)
        const text = JSON.stringify(reply.body)
        assert.ok(!text.includes(secretA.userID), `${path} exposed a student code`)
        assert.ok(!text.includes(secretA.phone), `${path} exposed a student phone`)
    }
    assert.equal((await call("GET", "/center/dashboard", token)).data.counts.students, 1)
})

test("roles can't enter each other's routes", async () => {
    const student = await login("student", secretA.userID, secretA.password)
    for (const path of ["/teacher/myStudents", "/owner/dashboard", "/center/dashboard", "/parent/profile", "/assistant/profile"]) {
        assert.ok([403].includes((await call("GET", path, student)).status), path)
    }
    assert.equal((await call("GET", "/owner/dashboard", a.token)).status, 403)
    assert.equal((await call("GET", "/owner/dashboard")).status, 401)
})
