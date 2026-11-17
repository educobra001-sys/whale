import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { base, call, login, makeStudent, makeTeacher, ownerToken, startServer, startSession, stopServer } from "./helpers"

let owner = ""
before(async () => {
    await startServer()
    owner = await ownerToken()
})
after(stopServer)

const loginFrom = async (ip: string, role: string, identifier: string, password: string) => {
    const response = await fetch(`${base}/login/${role}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ identifier, password }),
    })
    return response.status
}

test("a stranger guessing passwords can't lock the real owner out of their account", async () => {
    const teacher = await makeTeacher(owner)
    for (let index = 0; index < 10; index += 1) assert.equal(await loginFrom("10.0.0.66", "teacher", teacher.email, "wrong-password"), 401)
    assert.equal(await loginFrom("10.0.0.66", "teacher", teacher.email, "Teacher@123"), 429)
    assert.equal(await loginFrom("10.0.0.7", "teacher", teacher.email, "Teacher@123"), 200)
})

test("guesses spread over many devices still hit the account-wide limit", async () => {
    const teacher = await makeTeacher(owner)
    for (let index = 0; index < 50; index += 1) await loginFrom(`10.1.${Math.floor(index / 5)}.${index % 5}`, "teacher", teacher.email, "wrong-password")
    assert.equal(await loginFrom("10.9.9.9", "teacher", teacher.email, "Teacher@123"), 429)
})

test("unknown accounts are answered exactly like wrong passwords", async () => {
    const reply = await call("POST", "/login/teacher", null, { identifier: "nobody-here@test.local", password: "whatever-123" })
    assert.equal(reply.status, 401)
    assert.equal(reply.message, "Incorrect sign-in details")
})

test("uploads must really be the file type they claim", async () => {
    const teacher = await makeTeacher(owner)
    const send = (bytes: Buffer, name: string, type: string) => {
        const form = new FormData()
        form.append("file", new Blob([new Uint8Array(bytes)], { type }), name)
        return fetch(`${base}/uploads`, { method: "POST", headers: { Authorization: `Bearer ${teacher.token}` }, body: form })
    }
    assert.equal((await send(Buffer.from("<script>alert(1)</script>"), "photo.png", "image/png")).status, 400)
    assert.equal((await send(Buffer.from("<?php system($_GET['c']); ?>"), "doc.pdf", "application/pdf")).status, 400)
    assert.equal((await send(Buffer.from("%PDF-1.7\n%test"), "doc.pdf", "application/pdf")).status, 201)
    assert.equal((await send(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), "a.jpg", "image/jpeg")).status, 201)
})

test("links must be web links and names can't carry HTML", async () => {
    const map = await call("POST", "/signup/center", null, { name: "Link Center", phone: "01077770001", password: "Center@123", Maplocation: "javascript:alert(document.cookie)" })
    assert.equal(map.status, 400)
    const ok = await call("POST", "/signup/center", null, { name: "Link Center", phone: "01077770001", password: "Center@123", Maplocation: "https://maps.google.com/?q=cairo" })
    assert.equal(ok.status, 201)
    const named = await call("POST", "/signup/student", null, { firstName: "<img src=x onerror=alert(1)>", lastName: "X", phone: "01077770002", parentPhone: "01077770003", grade: "0", password: "Student@123" })
    assert.equal(named.status, 400)
    const teacher = await makeTeacher(owner)
    assert.equal((await call("PATCH", "/teacher/profile", teacher.token, { profilepic: "javascript:alert(1)" })).status, 400)
    assert.equal((await call("PATCH", "/teacher/profile", teacher.token, { profilepic: "/files/abc.png" })).status, 200)
})

test("schools sign up, wait for approval and work exactly like centers", async () => {
    const signup = await call("POST", "/signup/school", null, { name: "Future School", phone: "01088880001", password: "School@123" })
    assert.equal(signup.status, 201)
    assert.equal(signup.data.kind, "school")
    assert.equal((await call("POST", "/login/school", null, { identifier: "Future School", password: "School@123" })).status, 403)

    const schools = await call("GET", "/owner/centers?kind=school", owner)
    const school = schools.data.find((row: any) => row.name === "Future School")
    assert.equal(school.kind, "school")
    const centers = await call("GET", "/owner/centers?kind=center", owner)
    assert.ok(!centers.data.some((row: any) => row.name === "Future School"))
    await call("PATCH", `/owner/centers/${school._id}/status`, owner, { status: "active" })
    assert.equal((await call("GET", "/owner/dashboard", owner)).data.counts.schools >= 1, true)

    // A school account signs in only as a school.
    assert.equal((await call("POST", "/login/center", null, { identifier: "Future School", password: "School@123" })).status, 401)
    const token = await login("school", "Future School", "School@123")
    assert.equal((await call("GET", "/center/profile", token)).status, 403)
    const profile = await call("GET", "/school/profile", token)
    assert.equal(profile.data.kind, "school")

    const teacher = await makeTeacher(owner)
    const found = await call("GET", "/centers/search?q=Future&kind=school")
    assert.ok(found.data.some((row: any) => row._id === school._id))
    assert.equal((await call("POST", `/teacher/centers/${school._id}/request`, teacher.token)).status, 201)
    assert.equal((await call("PATCH", `/school/teachers/${teacher.id}`, token, { status: "active" })).status, 200)
    const student = await makeStudent(teacher.token, { center: school._id, balance: 100 })
    const session = await startSession(teacher.token, { center: school._id })
    assert.equal((await call("POST", `/teacher/sessions/${session}/attendance`, teacher.token, { identifier: student.userID })).status, 201)
    const dashboard = await call("GET", "/school/dashboard", token)
    assert.equal(dashboard.data.counts.teachers, 1)
    assert.equal(dashboard.data.counts.students, 1)
    assert.ok(!JSON.stringify(dashboard.body).includes(student.phone), "a school must not see student phones")

    await call("PATCH", `/owner/centers/${school._id}/status`, owner, { status: "suspended" })
    assert.equal((await call("GET", "/school/profile", token)).status, 401)
})

test("a check-in accepted offline is recorded even after the session closed", async () => {
    const teacher = await makeTeacher(owner)
    const student = await makeStudent(teacher.token, { balance: 10, pricePerSession: 80 })
    const session = await startSession(teacher.token)
    await call("PATCH", `/teacher/sessions/${session}/active`, teacher.token, { active: false })
    assert.equal((await call("POST", `/teacher/sessions/${session}/attendance`, teacher.token, { identifier: student.userID })).status, 404)
    const scannedAt = new Date(Date.now() - 3600_000).toISOString()
    const offline = await call("POST", `/teacher/sessions/${session}/attendance`, teacher.token, { identifier: student.userID, payment: 20, offline: true, scannedAt })
    assert.equal(offline.status, 201)
    assert.equal(offline.data.balance, -50)
    const report = await call("GET", `/teacher/sessions/${session}`, teacher.token)
    const row = report.data.rows?.find((item: any) => String(item.student?._id ?? item.student) === student.id) ?? report.data.attendance?.[0]
    assert.ok(JSON.stringify(report.body).includes("Recorded offline"), "the offline note is kept")
    assert.ok(row)
    const replay = await call("POST", `/teacher/sessions/${session}/attendance`, teacher.token, { identifier: student.userID, offline: true, scannedAt })
    assert.equal(replay.status, 409)
})

test("starting a group twice in a row gives the same session", async () => {
    const teacher = await makeTeacher(owner)
    const slot = (await call("POST", "/teacher/schedule", teacher.token, { dayOfWeek: 1, startTime: "17:00", title: "Group A" })).data
    const [first, second] = await Promise.all([1, 2].map(() => call("POST", `/teacher/schedule/${slot._id}/start`, teacher.token, {})))
    const again = await call("POST", `/teacher/schedule/${slot._id}/start`, teacher.token, {})
    const ids = new Set([first, second, again].filter((reply) => reply.status === 201).map((reply) => reply.data._id))
    assert.equal(ids.size, 1)
    const sessions = await call("GET", "/teacher/sessions", teacher.token)
    assert.equal(sessions.data.length, 1)
})

test("a finished lesson part resumes from the start, an unfinished one where it stopped", async () => {
    const teacher = await makeTeacher(owner)
    const student = await makeStudent(teacher.token)
    const token = await login("student", student.userID, student.password)
    const lesson = (await call("POST", "/teacher/lessons", teacher.token, {
        title: "Resume", isFree: true, published: true,
        parts: [{ title: "a", url: "https://video.test/a.mp4", durationSeconds: 600 }, { title: "b", url: "https://video.test/b.mp4", durationSeconds: 600 }],
    })).data
    const opened = await call("GET", `/student/lessons/${lesson._id}`, token)
    const [a, b] = opened.data.parts
    await call("POST", `/student/lessons/${lesson._id}/progress`, token, { part: a._id, seconds: 598 })
    await call("POST", `/student/lessons/${lesson._id}/progress`, token, { part: b._id, seconds: 240 })
    const again = await call("GET", `/student/lessons/${lesson._id}`, token)
    assert.equal(again.data.resume[a._id], 0)
    assert.equal(again.data.resume[b._id], 240)
})
