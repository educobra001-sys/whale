// Fills the local database with realistic test data. Local databases only.
import mongoose from "mongoose"
import { ALL_FEATURE_KEYS } from "../common/enum/feature.enum"
import { genertateHash } from "../common/security/security"
import { monthKey, nameKey } from "../common/service/helpers"
import { nextStudentId } from "../common/service/registry"
import { runAsPlatform } from "../common/service/tenantContext"
import { env } from "../config/env.service"
import { dbconnection } from "../db/connection"
import { repos } from "../db/repository"
import { seedFeatures } from "../module/owner/plan.service"
import billingService from "../module/billing/billing.service"
import { ensureOwner } from "./createOwner"

const FIRST = ["Omar", "Mariam", "Youssef", "Salma", "Karim", "Nour", "Ali", "Hana", "Ziad", "Farida", "Adham", "Laila", "Seif", "Malak", "Hassan", "Jana"]
const LAST = ["Hassan", "Ibrahim", "Mostafa", "Fathy", "Sayed", "Nabil", "Gamal", "Adel"]
const DAY = 86_400_000

const makeStudents = async (password: string, count: number) => {
    const students = []
    for (let index = 0; index < count; index += 1) {
        const firstName = FIRST[index % FIRST.length]!
        const lastName = LAST[index % LAST.length]!
        students.push(await repos.student.create({
            firstName, lastName, nameKey: nameKey(firstName, lastName), password,
            userID: await nextStudentId(),
            phone: `0100${String(1000000 + index)}`,
            parentPhone: `0120${String(1000000 + index)}`,
            grade: String(index % 3), schoolName: "Cairo Secondary School", learningLanguage: "0",
            gender: index % 2 ? "female" : "male",
        }))
    }
    return students
}

const seedTeacherData = async (teacher: any, students: any[], center: any) => {
    const teacherId = teacher._id
    for (const [index, student] of students.entries()) {
        await repos.enrollment.create({ teacher: teacherId, student: student._id, balance: 200 + index * 10, pricePerSession: 60, center: index % 2 ? center._id : null, points: index * 5 })
    }
    for (let number = 1; number <= 4; number += 1) {
        const attending = students.filter((_, index) => (index + number) % 4 !== 0)
        const date = new Date(Date.now() - (5 - number) * 2 * DAY)
        const session = await repos.session.create({ teacher: teacherId, sequence: `Lesson ${number}`, week: number, number, date, center: center._id, price: 60, presentCount: attending.length, collected: 0 })
        for (const student of attending) {
            await repos.attendance.create({ teacher: teacherId, session: session._id, student: student._id, charged: 60, markedAt: date, markedBy: teacherId, location: center._id, homeworkStatus: "complete" })
            await repos.transaction.create({ teacher: teacherId, student: student._id, amount: -60, type: "attendance", reason: `Session · Week ${number} · #${number} · Lesson ${number}`, by: teacherId, session: session._id, createdAt: date })
            await repos.monthlyActive.updateone({ filter: { teacher: teacherId, student: student._id, month: monthKey(date) }, data: { $setOnInsert: { reason: "attendance" } }, options: { upsert: true } })
        }
    }
    await repos.schedule.create({ teacher: teacherId, dayOfWeek: new Date().getDay(), startTime: "17:00", center: center._id, title: "Main group", grade: "1" })
    await repos.lesson.create({ teacher: teacherId, title: "Introduction", description: "First lesson", isFree: true, published: true, parts: [{ category: "explanation", title: "Part 1", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", durationSeconds: 600, order: 1 }] })
    await repos.exam.create({ teacher: teacherId, name: "Month 1 exam", maxScore: 50 })
    await repos.homework.create({ teacher: teacherId, title: "Chapter 1 sheet", startDate: new Date(), endDate: new Date(Date.now() + 7 * DAY) })
    await repos.booklet.create({ teacher: teacherId, name: "Term booklet", sellPrice: 120, stock: 50 })
    await repos.announcement.create({ teacher: teacherId, title: "Welcome to the new term", body: "Sessions start this week." })
}

const seed = () => runAsPlatform(async () => {
    if (!/127\.0\.0\.1|localhost/.test(env.dataBase_url)) throw new Error("The seed script only runs on a local database")
    if (await repos.teacher.exists({})) {
        if (!process.argv.includes("--reset")) throw new Error("The database already has data. Run with --reset to wipe it first.")
        await mongoose.connection.dropDatabase()
        await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()))
    }
    await seedFeatures()
    await ensureOwner()

    const teacherPassword = await genertateHash({ plainText: "Teacher@123" })
    const studentPassword = await genertateHash({ plainText: "Student@123" })
    const features = await repos.feature.findall({})
    const fullPrice = billingService.planTotal(features, ALL_FEATURE_KEYS)
    const limited = ["students", "sessions", "scan", "exams"]

    const center = await repos.center.create({ name: "Nile Center", phone: "01011110000", password: await genertateHash({ plainText: "Center@123" }), textlocation: "Nasr City, Cairo", status: "active" })
    const physics = await repos.teacher.create({
        firstName: "Ahmed", lastName: "Fathy", userName: "ahmed", email: "ahmed@educobra.local", phone: "01022220000",
        password: teacherPassword, confirmEmail: true, status: "active", approvedAt: new Date(), subject: ["Physics"], teachingLanguage: "Arabic",
        companyName: "Fathy Physics", bio: "Physics for secondary students.", visibility: "public", features: ALL_FEATURE_KEYS, pricePerStudent: fullPrice,
        channels: { telegram: true, whatsapp_api: true, whatsapp_web: true, whatsapp_link: true },
        affiliate: { code: center.referralId, ratePerStudent: 2, since: new Date() },
    })
    const math = await repos.teacher.create({
        firstName: "Mona", lastName: "Sayed", userName: "mona", email: "mona@educobra.local", phone: "01033330000",
        password: teacherPassword, confirmEmail: true, status: "active", approvedAt: new Date(), subject: ["Math"], teachingLanguage: "Arabic",
        visibility: "private", features: limited, pricePerStudent: billingService.planTotal(features, limited),
    })
    await repos.teacher.create({
        firstName: "Khaled", lastName: "Adel", userName: "khaled", email: "khaled@educobra.local", phone: "01044440000",
        password: teacherPassword, confirmEmail: true, status: "pending_approval", subject: ["Chemistry"], teachingLanguage: "Arabic",
    })
    await repos.assistant.create({
        teacher: physics._id, firstName: "Sara", lastName: "Nabil", userName: "sara", email: "sara@educobra.local", phone: "01055550000",
        password: await genertateHash({ plainText: "Assistant@123" }),
        permissions: ["dashboard", "students_view", "sessions_view", "scan_attendance", "scan_homework", "door_check", "follow_up", "messages"],
    })
    await repos.centerLink.create({ teacher: physics._id, center: center._id, status: "active", requestedBy: "center" })

    const students = await makeStudents(studentPassword, 24)
    await seedTeacherData(physics, students, center)
    await seedTeacherData(math, students.slice(0, 8), center)

    const [firstStudent] = students
    await repos.parent.create({ name: "Parent of Omar", phone: firstStudent.parentPhone, password: await genertateHash({ plainText: "Parent@123" }), children: [firstStudent._id] })
    await repos.rechargeCode.create({ teacher: physics._id, code: "EC-TESTCODE01", amount: 100, batch: "Test" })
    await repos.pricingRule.create({ teacher: physics._id, name: "Third secondary discount", price: Math.max(0, fullPrice - 5), filters: { grades: ["2"] } })

    console.log(`
Local accounts
  Owner      ${env.ownerUserName} / ${env.ownerPassword}   login.html?role=owner
  Teacher    ahmed / Teacher@123 (every section, public)
  Teacher    mona / Teacher@123 (4 sections, private)
  Teacher    khaled / Teacher@123 (waiting for your approval)
  Assistant  sara / Assistant@123
  Center     Nile Center / Center@123
  Student    ${firstStudent.userID} / Student@123
  Parent     ${firstStudent.parentPhone} / Parent@123
  Code       EC-TESTCODE01 (100 EGP with ahmed)`)
})

dbconnection()
    .then(seed)
    .then(() => mongoose.disconnect())
    .catch((error) => {
        console.error(error.message)
        process.exit(1)
    })
