import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { monthKey } from "../common/service/helpers"
import { runAsPlatform } from "../common/service/tenantContext"
import { repos } from "../db/repository"
import { base, call, login, makeStudent, makeTeacher, ownerToken, startServer, startSession, stopServer } from "./helpers"

let owner = ""
before(async () => {
    await startServer()
    owner = await ownerToken()
})
after(stopServer)

const attend = async (token: string, students: any[]) => {
    const session = await startSession(token)
    for (const student of students) await call("POST", `/teacher/sessions/${session}/attendance`, token, { identifier: student.userID, force: true })
    return session
}

test("the plan page sets sections and the price as the sum of what's ticked", async () => {
    const teacher = await makeTeacher(owner, { features: [] })
    const features = (await call("GET", "/owner/features", owner)).data
    const students = features.find((row: any) => row.key === "students")
    const exams = features.find((row: any) => row.key === "exams")
    await call("PATCH", `/owner/features/${students._id}`, owner, { price: 4 })
    await call("PATCH", `/owner/features/${exams._id}`, owner, { price: 1.5 })
    const plan = await call("POST", "/owner/plans/confirm", owner, { email: teacher.email, features: ["students", "exams"] })
    assert.equal(plan.status, 200)
    assert.equal(plan.data.pricePerStudent, 5.5)

    assert.equal((await call("GET", "/teacher/myStudents", teacher.token)).status, 200)
    assert.equal((await call("GET", "/teacher/exams", teacher.token)).status, 200)
    const locked = await call("GET", "/teacher/lessons", teacher.token)
    assert.equal(locked.status, 403)
    assert.equal(locked.body.cause.code, "FEATURE_LOCKED")
    assert.equal((await call("GET", "/teacher/finance", teacher.token)).status, 403)
    assert.equal((await call("GET", "/teacher/profile", teacher.token)).data.pricePerStudent, 5.5)
})

test("a locked section is locked for the teacher's assistants too", async () => {
    const teacher = await makeTeacher(owner, { features: ["students", "assistants"] })
    await call("POST", "/teacher/assistants", teacher.token, { userName: "planhelper", email: "planhelper@test.local", phone: "01200000077", password: "Assist@123", role: "Admin" })
    const token = await login("assistant", "planhelper", "Assist@123")
    assert.equal((await call("GET", "/teacher/myStudents", token)).status, 200)
    assert.equal((await call("GET", "/teacher/exams", token)).status, 403)
})

test("assistants only do what they were permitted", async () => {
    const teacher = await makeTeacher(owner)
    await call("POST", "/teacher/assistants", teacher.token, { userName: "limited", email: "limited@test.local", phone: "01200000078", password: "Assist@123", permissions: ["students_view"] })
    const token = await login("assistant", "limited", "Assist@123")
    assert.equal((await call("GET", "/teacher/myStudents", token)).status, 200)
    assert.equal((await call("POST", "/teacher/myStudents", token, { firstName: "X", phone: "01099990000" })).status, 403)
    assert.equal((await call("POST", "/teacher/assistants", token, { userName: "n", email: "n@test.local", phone: "01200000079", password: "Assist@123" })).status, 403)
    assert.equal((await call("PATCH", "/teacher/profile", token, { bio: "x" })).status, 403)
})

test("active and total students per month, with special prices by filter", async () => {
    const teacher = await makeTeacher(owner)
    await runAsPlatform(() => repos.teacher.updateone({ filter: { _id: teacher.id }, data: { $set: { pricePerStudent: 10 } } }))
    const senior = await makeStudent(teacher.token, { grade: "2" })
    const junior = await makeStudent(teacher.token, { grade: "0" })
    const vip = await makeStudent(teacher.token, { grade: "0" })
    await makeStudent(teacher.token, { grade: "0" })
    await attend(teacher.token, [senior, junior, vip])

    const added = await call("POST", `/owner/teachers/${teacher.id}/rules`, owner, { name: "Third secondary", price: 7, filters: { grades: ["2"] } })
    assert.equal(added.status, 201)
    await call("POST", `/owner/teachers/${teacher.id}/rules`, owner, { name: "VIP list", price: 0, priority: 5, filters: { students: [vip.userID] } })

    const view = await call("GET", "/teacher/billing", teacher.token)
    assert.equal(view.status, 200)
    assert.equal(view.data.current.activeStudents, 3)
    assert.equal(view.data.current.totalStudents, 4)
    assert.equal(view.data.current.inactiveStudents, 1)
    assert.equal(view.data.current.total, 17)
    assert.deepEqual(view.data.rules.map((rule: any) => rule.name).sort(), ["Third secondary", "VIP list"])
})

test("a student active twice in a month counts once; recharging also counts as active", async () => {
    const teacher = await makeTeacher(owner)
    const student = await makeStudent(teacher.token)
    await attend(teacher.token, [student])
    await attend(teacher.token, [student])
    const recharger = await makeStudent(teacher.token)
    const token = await login("student", recharger.userID, recharger.password)
    const [code] = (await call("POST", "/teacher/recharge-codes", teacher.token, { count: 1, amount: 5 })).data
    await call("POST", "/student/recharge", token, { code: code.code })
    assert.equal((await call("GET", "/teacher/billing", teacher.token)).data.current.activeStudents, 2)
})

test("affiliate: a center's id earns the owner-set amount per active student", async () => {
    const teacher = await makeTeacher(owner)
    await runAsPlatform(() => repos.teacher.updateone({ filter: { _id: teacher.id }, data: { $set: { pricePerStudent: 10 } } }))
    await call("POST", "/signup/center", null, { name: "Partner Center", phone: "01044445555", password: "Center@123" })
    const center = (await call("GET", "/owner/centers", owner)).data.find((row: any) => row.name === "Partner Center")
    await call("PATCH", `/owner/centers/${center._id}/status`, owner, { status: "active" })
    const token = await login("center", "Partner Center", "Center@123")
    const referralId = (await call("GET", "/me/referral", token)).data.referralId

    assert.equal((await call("PATCH", `/owner/teachers/${teacher.id}/affiliate`, owner, { code: "EC-ZZZZZZZZ", ratePerStudent: 2 })).status, 404)
    assert.equal((await call("PATCH", `/owner/teachers/${teacher.id}/affiliate`, owner, { code: referralId, ratePerStudent: 2.5 })).status, 200)
    await attend(teacher.token, [await makeStudent(teacher.token), await makeStudent(teacher.token)])

    const month = monthKey()
    assert.equal((await call("POST", "/owner/billing/generate", owner, { month })).status, 200)
    assert.equal((await call("POST", "/owner/billing/generate", owner, { month })).status, 200)
    const mine = await call("GET", "/me/referral", token)
    assert.equal(mine.data.earnings.length, 1)
    assert.equal(mine.data.totals.due, 5)
    const report = await call("GET", `/owner/affiliates?month=${month}`, owner)
    assert.equal(report.data.rows.find((row: any) => row.code === referralId).amount, 5)

    const invoice = (await call("GET", "/teacher/billing", teacher.token)).data.invoices[0]
    assert.equal(invoice.total, 20)
    await call("PATCH", `/owner/invoices/${invoice._id}`, owner, { status: "paid" })
    await call("PATCH", `/owner/affiliates/${mine.data.earnings[0]._id}`, owner, { status: "paid" })
    await call("POST", "/owner/billing/generate", owner, { month })
    assert.equal((await call("GET", "/teacher/billing", teacher.token)).data.invoices[0].status, "paid")
    assert.equal((await call("GET", "/me/referral", token)).data.totals.paid, 5)
})

test("private teachers are hidden from everyone but their own students", async () => {
    const hidden = await makeTeacher(owner, { visibility: "private" })
    const open = await makeTeacher(owner, { visibility: "public" })
    const anonymous = await call("GET", "/teachers/search")
    const names = anonymous.data.map((row: any) => row.userName)
    assert.ok(names.includes(open.userName))
    assert.ok(!names.includes(hidden.userName))
    assert.ok(!JSON.stringify(anonymous.data).includes(open.email))
    assert.equal((await call("GET", `/teachers/${hidden.id}`)).status, 404)

    const student = await makeStudent(hidden.token)
    const token = await login("student", student.userID, student.password)
    assert.equal((await call("GET", `/teachers/${hidden.id}`, token)).status, 200)
    const outsider = await makeStudent(open.token)
    const outsiderToken = await login("student", outsider.userID, outsider.password)
    assert.equal((await call("GET", `/teachers/${hidden.id}`, outsiderToken)).status, 404)
    assert.equal((await call("POST", `/student/teachers/${hidden.id}/request`, outsiderToken)).status, 404)

    const lesson = await call("POST", "/teacher/lessons", open.token, { title: "Public lesson", published: true, parts: [{ title: "p", url: "https://video.test/hidden" }] })
    assert.equal(lesson.status, 201)
    const page = await call("GET", `/teachers/${open.id}`)
    assert.equal(page.data.lessons[0].title, "Public lesson")
    assert.ok(!JSON.stringify(page.data).includes("video.test"))
})

test("an ad stays inside the course until the owner accepts it", async () => {
    const teacher = await makeTeacher(owner)
    const student = await makeStudent(teacher.token)
    const token = await login("student", student.userID, student.password)
    const ad = (await call("POST", "/teacher/announcements", teacher.token, { title: "My course ad" })).data
    assert.equal((await call("GET", `/student/teachers/${teacher.id}/overview`, token)).data.announcements.length, 1)
    assert.equal((await call("GET", "/me/platform-ads", token)).data.length, 0)

    await call("POST", `/teacher/announcements/${ad._id}/request-platform`, teacher.token)
    assert.equal((await call("GET", "/me/platform-ads", token)).data.length, 0)
    const pending = await call("GET", "/owner/ads?status=pending", owner)
    assert.equal(pending.data.length, 1)
    await call("PATCH", `/owner/ads/${ad._id}`, owner, { status: "approved" })
    assert.equal((await call("GET", "/me/platform-ads", token)).data.length, 1)

    await call("PATCH", `/teacher/announcements/${ad._id}`, teacher.token, { title: "Changed after approval" })
    assert.equal((await call("GET", "/me/platform-ads", token)).data.length, 0)
})

test("messages: templates with variables, review, edit, send, limits", async () => {
    const teacher = await makeTeacher(owner)
    const here = await makeStudent(teacher.token, { firstName: "Here", balance: 200, pricePerSession: 50 })
    const away = await makeStudent(teacher.token, { firstName: "Away" })
    const session = await attend(teacher.token, [here])

    assert.equal((await call("GET", "/teacher/messages/config", teacher.token)).data.channels.length, 0)
    await call("PATCH", `/owner/teachers/${teacher.id}/channels`, owner, { telegram: true, whatsapp_api: true, whatsapp_link: true })
    const config = await call("GET", "/teacher/messages/config", teacher.token)
    assert.deepEqual(config.data.channels.map((row: any) => row.key), ["telegram", "whatsapp_api", "whatsapp_link"])

    await call("PUT", "/teacher/messages/templates/attendance", teacher.token, { body: "{student_name} came. Balance {balance}" })
    const attendance = await call("POST", "/teacher/messages/preview", teacher.token, { session, type: "attendance" })
    assert.equal(attendance.data.items.length, 1)
    assert.equal(attendance.data.items[0].body, `Here Test came. Balance 150`)
    const absence = await call("POST", "/teacher/messages/preview", teacher.token, { session, type: "absence" })
    assert.equal(absence.data.items.length, 1)
    assert.equal(absence.data.items[0].student, away.id)

    const one = await call("POST", "/teacher/messages/preview-one", teacher.token, { session, type: "absence", identifier: away.userID })
    assert.equal(one.status, 200)

    const links = await call("POST", "/teacher/messages/send", teacher.token, { session, type: "attendance", channel: "whatsapp_link", items: attendance.data.items })
    assert.equal(links.status, 201)
    assert.equal(links.data.delaySeconds, 15)
    assert.match(links.data.links[0].url, /^https:\/\/wa\.me\/20/)
    assert.equal((await call("PATCH", `/teacher/messages/items/${links.data.links[0]._id}`, teacher.token, { status: "sent" })).status, 200)

    await call("PATCH", "/owner/messaging", owner, { delaySeconds: 30, maxChars: 40 })
    const long = await call("POST", "/teacher/messages/send", teacher.token, { session, type: "attendance", channel: "whatsapp_api", items: [{ ...attendance.data.items[0], body: "x".repeat(41) }] })
    assert.equal(long.status, 400)
    assert.match(long.message, /limit is 40/)
    const queued = await call("POST", "/teacher/messages/send", teacher.token, { session, type: "attendance", channel: "whatsapp_api", items: attendance.data.items })
    assert.equal(queued.status, 201)
    assert.equal(queued.data.delaySeconds, 0)
    assert.equal((await call("POST", "/teacher/messages/send", teacher.token, { session, type: "attendance", channel: "whatsapp_web", items: attendance.data.items })).status, 403)
    assert.equal((await call("GET", "/teacher/messages/batches", teacher.token)).data.length, 2)
    assert.equal((await call("GET", "/owner/messaging", owner)).data.delaySeconds, 30)
})

test("teachers can link, but linking opens no data", async () => {
    const a = await makeTeacher(owner)
    const b = await makeTeacher(owner)
    await makeStudent(a.token)
    assert.equal((await call("POST", "/teacher/links", a.token, { userName: b.userName })).status, 201)
    const incoming = await call("GET", "/teacher/links", b.token)
    assert.equal(incoming.data[0].direction, "received")
    assert.equal((await call("PATCH", `/teacher/links/${incoming.data[0]._id}`, b.token, { accept: true })).status, 200)
    assert.equal((await call("GET", "/teacher/links", a.token)).data[0].status, "active")
    assert.equal((await call("GET", "/teacher/myStudents", b.token)).data.length, 0)
})

test("parents see their own children only", async () => {
    const teacher = await makeTeacher(owner)
    const child = await makeStudent(teacher.token)
    const stranger = await makeStudent(teacher.token)
    assert.equal((await call("POST", "/signup/parent", null, { name: "Parent", phone: "01000001111", childCode: child.userID, password: "Parent@123" })).status, 403)
    assert.equal((await call("POST", "/signup/parent", null, { name: "Parent", phone: child.parentPhone, childCode: child.userID, password: "Parent@123" })).status, 201)
    const token = await login("parent", child.parentPhone, "Parent@123")
    const profile = await call("GET", "/parent/profile", token)
    assert.equal(profile.data.children.length, 1)
    assert.equal((await call("GET", `/parent/children/${child.id}/report`, token)).status, 200)
    assert.equal((await call("GET", `/parent/children/${stranger.id}/report`, token)).status, 404)
    assert.equal((await call("POST", "/parent/children", token, { code: stranger.userID })).status, 403)
})

test("uploads accept images and refuse anything else", async () => {
    const teacher = await makeTeacher(owner)
    const send = (name: string, type: string) => {
        const form = new FormData()
        form.append("file", new Blob([Buffer.from("iVBORw0KGgo=", "base64")], { type }), name)
        return fetch(`${base}/uploads`, { method: "POST", headers: { Authorization: `Bearer ${teacher.token}` }, body: form })
    }
    const image = await send("photo.png", "image/png")
    assert.equal(image.status, 201)
    assert.match(((await image.json()) as any).data.url, /^\/files\/.+\.png$/)
    assert.equal((await send("evil.html", "text/html")).status, 400)
})

test("attack traffic is rejected cleanly", async () => {
    const teacher = await makeTeacher(owner)
    assert.equal((await call("POST", "/login/teacher", null, { identifier: { $ne: "" }, password: { $ne: "" } })).status, 400)
    assert.equal((await call("POST", "/teacher/myStudents/link", teacher.token, { identifier: { $gt: "" } })).status, 400)
    assert.equal((await call("GET", "/teacher/transactions?student[$ne]=x", teacher.token)).data.length, 0)
    const unknownField = await call("PATCH", "/teacher/profile", teacher.token, { status: "active", features: ["exams"], pricePerStudent: 0, bio: "ok" })
    assert.equal(unknownField.status, 200)
    assert.equal((await call("GET", "/teacher/profile", teacher.token)).data.pricePerStudent, unknownField.data.pricePerStudent)
    const student = await makeStudent(teacher.token)
    await call("PATCH", `/teacher/myStudents/${student.id}`, teacher.token, { balance: 999999, password: "hacked", userID: "STU-1" })
    assert.equal((await call("GET", `/teacher/myStudents/${student.id}`, teacher.token)).data.balance, 0)
    assert.equal((await call("GET", `/teacher/sessions/not-an-id`, teacher.token)).status, 400)
    const tampered = teacher.token.slice(0, -3) + "abc"
    assert.equal((await call("GET", "/teacher/profile", tampered)).status, 401)
    const bad = await call("GET", "/nothing-here")
    assert.equal(bad.status, 404)
    assert.equal(bad.body.stack, undefined)
})
