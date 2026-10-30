import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { call, login, makeStudent, makeTeacher, ownerToken, startServer, stopServer } from "./helpers"

let owner = ""
before(async () => {
    await startServer()
    owner = await ownerToken()
})
after(stopServer)

test("teacher needs email code, then a human, before going live", async () => {
    const body = { firstName: "New", userName: "newteacher", email: "new@test.local", phone: "01099999999", password: "Teacher@123" }
    const signup = await call("POST", "/signup/teacher", null, body)
    assert.equal(signup.status, 201)
    assert.ok(signup.data.devCode)

    assert.equal((await call("POST", "/login/teacher", null, { identifier: body.email, password: body.password })).status, 403)
    assert.equal((await call("POST", "/verify-acc", null, { identifier: body.email, otp: "000000" })).status, 400)
    assert.equal((await call("POST", "/verify-acc", null, { identifier: body.email, otp: signup.data.devCode })).status, 200)

    const waiting = await call("POST", "/login/teacher", null, { identifier: body.email, password: body.password })
    assert.equal(waiting.status, 403)
    assert.equal(waiting.body.cause.code, "PENDING_APPROVAL")

    const list = await call("GET", "/owner/teachers?status=pending_approval", owner)
    const row = list.data.find((item: any) => item.email === body.email)
    assert.ok(row)
    assert.equal((await call("PATCH", `/owner/teachers/${row._id}/status`, owner, { status: "active" })).status, 200)
    assert.ok(await login("teacher", body.email, body.password))
})

test("the same email cannot register twice and gets a clear answer", async () => {
    const teacher = await makeTeacher(owner)
    const again = await call("POST", "/signup/teacher", null, { firstName: "X", userName: "other1", email: teacher.email, phone: "01055555555", password: "Teacher@123" })
    assert.equal(again.status, 409)
    assert.match(again.message, /Email/)
})

test("a student has one global id and a second teacher is told about it", async () => {
    const a = await makeTeacher(owner)
    const b = await makeTeacher(owner)
    const student = await makeStudent(a.token, { phone: "01277777777" })

    const duplicate = await call("POST", "/teacher/myStudents", b.token, { firstName: "Same", lastName: "Person", phone: "+201277777777" })
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.cause.code, "STUDENT_EXISTS")
    assert.equal(duplicate.body.cause.userID, student.userID)
    assert.ok(duplicate.message.includes(student.userID))

    const sameName = await makeStudent(a.token, { firstName: "Mohamed", lastName: "Ali", parentPhone: "01288888888" })
    const byName = await call("POST", "/teacher/myStudents", b.token, { firstName: "mohamed ", lastName: "ALI", phone: "01266666666", parentPhone: "01288888888" })
    assert.equal(byName.status, 409)
    assert.equal(byName.body.cause.userID, sameName.userID)

    const linked = await call("POST", "/teacher/myStudents/link", b.token, { identifier: student.userID })
    assert.equal(linked.status, 201)
    assert.equal(linked.data.userID, student.userID)
    assert.equal(linked.data.balance, 0)
})

test("student ids stay unique under concurrent signups", async () => {
    const replies = await Promise.all(Array.from({ length: 25 }, (_, index) => call("POST", "/signup/student", null, {
        firstName: "Fast", lastName: `Student${index}`, phone: `0155500${String(index).padStart(4, "0")}`,
        parentPhone: `0155600${String(index).padStart(4, "0")}`, grade: "0", password: "Student@123",
    })))
    const ids = replies.map((reply) => reply.data?.userID)
    assert.ok(ids.every(Boolean), replies.find((reply) => !reply.data)?.message)
    assert.equal(new Set(ids).size, 25)
})

test("every account has a marketing id and center signup waits for approval", async () => {
    const signup = await call("POST", "/signup/center", null, { name: "Star Center", phone: "01011112222", password: "Center@123" })
    assert.equal(signup.status, 201)
    assert.equal((await call("POST", "/login/center", null, { identifier: "Star Center", password: "Center@123" })).status, 403)
    const centers = await call("GET", "/owner/centers", owner)
    const center = centers.data.find((row: any) => row.name === "Star Center")
    assert.match(center.referralId, /^EC-[A-Z0-9]{8}$/)
    await call("PATCH", `/owner/centers/${center._id}/status`, owner, { status: "active" })
    const token = await login("center", "Star Center", "Center@123")
    assert.equal((await call("GET", "/me/referral", token)).data.referralId, center.referralId)
})

test("wrong passwords lock the account for a while", async () => {
    const teacher = await makeTeacher(owner)
    for (let index = 0; index < 8; index += 1) {
        assert.equal((await call("POST", "/login/teacher", null, { identifier: teacher.email, password: "wrong-password" })).status, 401)
    }
    assert.equal((await call("POST", "/login/teacher", null, { identifier: teacher.email, password: "Teacher@123" })).status, 429)
})

test("suspending a teacher ends their access at once, including assistants", async () => {
    const teacher = await makeTeacher(owner)
    await call("POST", "/teacher/assistants", teacher.token, { userName: "helper9", email: "helper9@test.local", phone: "01212340000", password: "Assist@123" })
    const assistant = await login("assistant", "helper9", "Assist@123")
    assert.equal((await call("GET", "/assistant/profile", assistant)).status, 200)
    await call("PATCH", `/owner/teachers/${teacher.id}/status`, owner, { status: "suspended" })
    assert.equal((await call("GET", "/teacher/myStudents", teacher.token)).status, 401)
    assert.equal((await call("GET", "/teacher/dashboard", assistant)).status, 403)
})

test("changing a password ends other sessions", async () => {
    const teacher = await makeTeacher(owner)
    assert.equal((await call("PATCH", "/teacher/password", teacher.token, { currentPassword: "Teacher@123", newPassword: "Teacher@456" })).status, 200)
    assert.equal((await call("GET", "/teacher/profile", teacher.token)).status, 401)
    assert.ok(await login("teacher", teacher.email, "Teacher@456"))
})
