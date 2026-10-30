import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { call, login, makeStudent, makeTeacher, ownerToken, startServer, startSession, stopServer } from "./helpers"

let owner = ""
let t: any
before(async () => {
    await startServer()
    owner = await ownerToken()
    t = await makeTeacher(owner)
})
after(stopServer)

const balanceOf = async (token: string, id: string) => (await call("GET", `/teacher/myStudents/${id}`, token)).data.balance

test("check-in charges the session price and writes the transactions", async () => {
    const student = await makeStudent(t.token, { balance: 100, pricePerSession: 80 })
    const session = await startSession(t.token)
    const reply = await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID })
    assert.equal(reply.status, 201)
    assert.equal(reply.data.balance, 20)
    assert.equal(reply.data.charged, 80)
    const again = await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID })
    assert.equal(again.status, 409)
    assert.equal(await balanceOf(t.token, student.id), 20)
})

test("insufficient balance is refused unless forced, blocked students too", async () => {
    const student = await makeStudent(t.token, { balance: 10, pricePerSession: 80 })
    const session = await startSession(t.token)
    const refused = await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.cause.code, "INSUFFICIENT_BALANCE")
    assert.equal(await balanceOf(t.token, student.id), 10)
    const paying = await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID, payment: 70 })
    assert.equal(paying.status, 201)
    assert.equal(paying.data.balance, 0)

    const blocked = await makeStudent(t.token, { balance: 500, pricePerSession: 80 })
    await call("PATCH", `/teacher/myStudents/${blocked.id}/block`, t.token, { blocked: true })
    const stopped = await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: blocked.userID })
    assert.equal(stopped.status, 403)
    assert.equal(stopped.body.cause.code, "BLOCKED")
    assert.equal((await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: blocked.userID, force: true })).status, 201)
})

test("many scanners at once: the same student is charged exactly once", async () => {
    const student = await makeStudent(t.token, { balance: 1000, pricePerSession: 100 })
    const session = await startSession(t.token)
    const replies = await Promise.all(Array.from({ length: 12 }, () => call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID })))
    assert.equal(replies.filter((reply) => reply.status === 201).length, 1)
    assert.ok(replies.every((reply) => reply.status === 201 || reply.status === 409), JSON.stringify(replies.map((reply) => [reply.status, reply.message])))
    assert.equal(await balanceOf(t.token, student.id), 900)
    assert.equal((await call("GET", `/teacher/sessions/${session}`, t.token)).data.presentCount, 1)
})

test("a hundred students checked in at once all land correctly", async () => {
    const students = []
    for (let index = 0; index < 100; index += 1) students.push(await makeStudent(t.token, { balance: 200, pricePerSession: 50 }))
    const session = await startSession(t.token)
    const replies = await Promise.all(students.map((student) => call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: student.userID })))
    assert.equal(replies.filter((reply) => reply.status === 201).length, 100)
    const report = await call("GET", `/teacher/sessions/${session}`, t.token)
    assert.equal(report.data.presentCount, 100)
    assert.equal(report.data.attendance.length, 100)
})

test("a recharge code works once, even when redeemed twice at the same moment", async () => {
    const student = await makeStudent(t.token)
    const token = await login("student", student.userID, student.password)
    const [code] = (await call("POST", "/teacher/recharge-codes", t.token, { count: 1, amount: 150 })).data
    const replies = await Promise.all(Array.from({ length: 8 }, () => call("POST", "/student/recharge", token, { code: code.code })))
    assert.equal(replies.filter((reply) => reply.status === 200).length, 1)
    assert.equal(await balanceOf(t.token, student.id), 150)
})

test("a code from another teacher can't be used", async () => {
    const other = await makeTeacher(owner)
    const [code] = (await call("POST", "/teacher/recharge-codes", other.token, { count: 1, amount: 100 })).data
    const student = await makeStudent(t.token)
    const token = await login("student", student.userID, student.password)
    assert.equal((await call("POST", "/student/recharge", token, { code: code.code })).status, 403)
})

test("cancelling a session refunds everyone; removing attendance refunds that row", async () => {
    const one = await makeStudent(t.token, { balance: 100, pricePerSession: 40 })
    const two = await makeStudent(t.token, { balance: 100, pricePerSession: 60 })
    const session = await startSession(t.token)
    await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: one.userID })
    await call("POST", `/teacher/sessions/${session}/attendance`, t.token, { identifier: two.userID })
    assert.equal((await call("DELETE", `/teacher/sessions/${session}/attendance/${two.id}`, t.token)).status, 200)
    assert.equal(await balanceOf(t.token, two.id), 100)
    assert.equal((await call("PATCH", `/teacher/sessions/${session}`, t.token, { status: "cancelled" })).status, 200)
    assert.equal(await balanceOf(t.token, one.id), 100)
    assert.equal((await call("PATCH", `/teacher/sessions/${session}`, t.token, { status: "normal" })).status, 200)
    assert.equal(await balanceOf(t.token, one.id), 100)
})

test("a transfer top-up adds money once, only when approved, and references are unique", async () => {
    const student = await makeStudent(t.token)
    const token = await login("student", student.userID, student.password)
    const topup = await call("POST", `/student/teachers/${t.id}/topups`, token, { amount: 200, reference: "REF-1", receiptUrl: "/files/x.png" })
    assert.equal(topup.status, 201)
    assert.equal(await balanceOf(t.token, student.id), 0)
    assert.equal((await call("POST", `/student/teachers/${t.id}/topups`, token, { amount: 200, reference: "REF-1", receiptUrl: "/files/x.png" })).status, 409)
    const replies = await Promise.all([1, 2, 3].map(() => call("PATCH", `/teacher/topups/${topup.data._id}`, t.token, { status: "approved" })))
    assert.equal(replies.filter((reply) => reply.status === 200).length, 1)
    assert.equal(await balanceOf(t.token, student.id), 200)
})

test("lesson video links stay hidden until access is paid, and a double tap pays once", async () => {
    const student = await makeStudent(t.token, { balance: 100 })
    const token = await login("student", student.userID, student.password)
    const lesson = (await call("POST", "/teacher/lessons", t.token, { title: "L", price: 30, published: true, parts: [{ title: "p1", url: "https://video.test/secret" }], questions: [{ type: "mcq", text: "2+2", options: ["3", "4"], correct: "4", bonusPoints: 5, isActive: true }] })).data
    const locked = await call("GET", `/student/lessons/${lesson._id}`, token)
    assert.equal(locked.data.parts[0].url, null)
    assert.equal(locked.data.questions.length, 0)
    const replies = await Promise.all([1, 2].map(() => call("POST", `/student/lessons/${lesson._id}/unlock`, token, {})))
    assert.ok(replies.every((reply) => reply.status === 200))
    assert.equal(await balanceOf(t.token, student.id), 70)
    const open = await call("GET", `/student/lessons/${lesson._id}`, token)
    assert.equal(open.data.parts[0].url, "https://video.test/secret")
    assert.equal(open.data.questions[0].correct, undefined)

    const answer = await call("POST", `/student/questions/${open.data.questions[0]._id}/answer`, token, { choice: "4" })
    assert.equal(answer.data.isCorrect, true)
    await call("POST", `/student/questions/${open.data.questions[0]._id}/answer`, token, { choice: "4" })
    assert.equal((await call("GET", `/teacher/myStudents/${student.id}`, t.token)).data.points, 5)
})

test("three warnings block the student; booklets and homework follow the contract", async () => {
    const student = await makeStudent(t.token)
    for (const reason of ["1", "2", "3"]) await call("POST", `/teacher/myStudents/${student.id}/warnings`, t.token, { reason })
    assert.equal((await call("GET", `/teacher/myStudents/${student.id}`, t.token)).data.isBlocked, true)

    const token = await login("student", student.userID, student.password)
    const booklet = (await call("POST", "/teacher/booklets", t.token, { name: "B", sellPrice: 20, stock: 1 })).data
    assert.equal((await call("POST", `/student/booklets/${booklet._id}/reserve`, token, { method: "center" })).status, 201)
    assert.equal((await call("POST", `/student/booklets/${booklet._id}/reserve`, token, { method: "center" })).status, 409)
    const hw = (await call("POST", "/teacher/homework", t.token, { title: "H", startDate: "2026-01-01", endDate: "2099-01-01" })).data
    assert.equal((await call("POST", `/student/homework/${hw._id}/submit`, token, { files: [] })).status, 400)
    assert.equal((await call("POST", `/student/homework/${hw._id}/submit`, token, { files: ["/files/a.png"] })).status, 200)
    const subs = await call("GET", `/teacher/homework/${hw._id}/submissions`, t.token)
    assert.equal(subs.data.submissions.length, 1)
    assert.equal((await call("PATCH", `/teacher/homework/submissions/${subs.data.submissions[0]._id}`, t.token, { status: "complete" })).status, 200)
    assert.equal((await call("POST", `/student/homework/${hw._id}/submit`, token, { files: ["/files/b.png"] })).status, 409)
})
