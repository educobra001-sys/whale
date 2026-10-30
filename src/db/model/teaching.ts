// Everything owned by one teacher. Each collection leads its indexes with `teacher`, which is also the
// shard key when the data outgrows one replica set.
import mongoose, { Schema, Types } from "mongoose"
import { grades } from "../../common/enum/user.enum"
import { tenantPlugin } from "../plugin/tenant.plugin"

const teacher = { type: Types.ObjectId, ref: "Teacher", required: true }
const student = { type: Types.ObjectId, ref: "Student", required: true }
const tenantModel = (name: string, schema: Schema) => {
    schema.plugin(tenantPlugin)
    return mongoose.model(name, schema)
}
const homeworkStatuses = ["complete", "incomplete", "no_steps", "not_done"]

// The link between a global student and one teacher. Money and discipline live here, per teacher.
const enrollmentSchema = new Schema({
    teacher, student,
    status: { type: String, enum: ["pending", "active"], default: "active" },
    archived: { type: Boolean, default: false },
    removedAt: Date,
    removedReason: String,
    balance: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    pricePerSession: { type: Number, default: null },
    center: { type: Types.ObjectId, ref: "Center", default: null },
    adminNote: { type: String, default: "" },
    followUpAssistant: { type: Types.ObjectId, ref: "Assistant", default: null },
    joinedAt: { type: Date, default: Date.now },
}, { timestamps: true })
enrollmentSchema.index({ teacher: 1, student: 1 }, { unique: true })
enrollmentSchema.index({ teacher: 1, status: 1, archived: 1 })
enrollmentSchema.index({ teacher: 1, center: 1 })
enrollmentSchema.index({ student: 1, status: 1 })
export const enrollmentModel = tenantModel("Enrollment", enrollmentSchema)

const sessionSchema = new Schema({
    teacher,
    sequence: { type: String, required: true, trim: true, maxlength: 160 },
    week: { type: Number, required: true, min: 1, max: 60 },
    number: { type: Number, required: true, min: 1, max: 999 },
    date: { type: Date, default: Date.now },
    center: { type: Types.ObjectId, ref: "Center", default: null },
    grade: { type: String, default: "" },
    price: { type: Number, default: null },
    status: { type: String, enum: ["normal", "cancelled"], default: "normal" },
    active: { type: Boolean, default: false },
    presentCount: { type: Number, default: 0 },
    collected: { type: Number, default: 0 },
    staff: [{
        assistant: { type: Types.ObjectId, ref: "Assistant" },
        checkIn: Date,
        checkOut: Date,
        notes: String,
    }],
    closing: { type: { normalCost: Number, reducedCost: Number, reducedCount: Number, notes: String }, default: null },
}, { timestamps: true })
sessionSchema.index({ teacher: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } })
sessionSchema.index({ teacher: 1, date: -1 })
sessionSchema.index({ center: 1, date: -1 })
export const sessionModel = tenantModel("Session", sessionSchema)

// One document per check-in, so a session never grows without limit and scans don't fight over one document.
const attendanceSchema = new Schema({
    teacher, student,
    session: { type: Types.ObjectId, ref: "Session", required: true },
    markedAt: { type: Date, default: Date.now },
    payment: { type: Number, default: 0 },
    charged: { type: Number, default: 0 },
    comment: { type: String, default: "" },
    homeworkStatus: { type: String, enum: [...homeworkStatuses, null], default: null },
    homeworkBy: Types.ObjectId,
    markedBy: Types.ObjectId,
    location: { type: Types.ObjectId, ref: "Center", default: null },
})
attendanceSchema.index({ session: 1, student: 1 }, { unique: true })
attendanceSchema.index({ teacher: 1, student: 1, markedAt: -1 })
export const attendanceModel = tenantModel("Attendance", attendanceSchema)

const transactionSchema = new Schema({
    teacher, student,
    amount: { type: Number, required: true },
    type: { type: String, required: true },
    reason: String,
    by: Schema.Types.Mixed,
    session: { type: Types.ObjectId, ref: "Session" },
    createdAt: { type: Date, default: Date.now },
})
transactionSchema.index({ teacher: 1, createdAt: -1 })
transactionSchema.index({ teacher: 1, student: 1, createdAt: -1 })
export const transactionModel = tenantModel("Transaction", transactionSchema)

const warningSchema = new Schema({ teacher, student, reason: String, by: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } })
warningSchema.index({ teacher: 1, student: 1 })
export const warningModel = tenantModel("Warning", warningSchema)

const pointsLogSchema = new Schema({ teacher, student, points: Number, reason: String, by: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now } })
pointsLogSchema.index({ teacher: 1, student: 1 })
export const pointsLogModel = tenantModel("PointsLog", pointsLogSchema)

const scheduleSchema = new Schema({
    teacher,
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startTime: { type: String, required: true },
    durationMinutes: { type: Number, default: 90 },
    center: { type: Types.ObjectId, ref: "Center", default: null },
    grade: { type: String, default: "" },
    title: { type: String, default: "Group" },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: "" },
}, { timestamps: true })
scheduleSchema.index({ teacher: 1, dayOfWeek: 1 })
scheduleSchema.index({ center: 1 })
export const scheduleModel = tenantModel("ScheduleSlot", scheduleSchema)

const examSchema = new Schema({
    teacher,
    name: { type: String, required: true },
    maxScore: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    session: { type: Types.ObjectId, ref: "Session", default: null },
    grade: { type: String, default: "" },
    results: [{ _id: false, student: { type: Types.ObjectId, ref: "Student" }, score: Number }],
}, { timestamps: true })
examSchema.index({ teacher: 1, date: -1 })
export const examModel = tenantModel("Exam", examSchema)

const homeworkSchema = new Schema({
    teacher,
    title: { type: String, required: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 1 },
    startDate: Date,
    endDate: Date,
    submissionType: { type: String, default: "upload" },
    externalLink: { type: String, default: "" },
    grade: { type: String, default: "" },
}, { timestamps: true })
homeworkSchema.index({ teacher: 1, order: -1 })
export const homeworkModel = tenantModel("Homework", homeworkSchema)

const submissionSchema = new Schema({
    teacher, student,
    homework: { type: Types.ObjectId, ref: "Homework", required: true },
    files: [String],
    comment: { type: String, default: "" },
    link: { type: String, default: "" },
    status: { type: String, default: "submitted" },
    feedback: { type: String, default: "" },
    submittedAt: Date,
    gradedAt: Date,
    gradedBy: Types.ObjectId,
})
submissionSchema.index({ homework: 1, student: 1 }, { unique: true })
submissionSchema.index({ teacher: 1, status: 1 })
export const submissionModel = tenantModel("Submission", submissionSchema)

const lessonSchema = new Schema({
    teacher,
    title: { type: String, required: true },
    description: { type: String, default: "" },
    week: { type: Number, default: 1 },
    order: { type: Number, default: 1 },
    grade: { type: String, default: "" },
    isFree: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    viewsIfAttended: { type: Number, default: 2 },
    viewsIfPaid: { type: Number, default: 3 },
    accessHours: { type: Number, default: 72 },
    sessions: [{ type: Types.ObjectId, ref: "Session" }],
    published: { type: Boolean, default: false },
    parts: [{ category: String, title: String, url: String, durationSeconds: Number, order: Number }],
    questions: [{ type: { type: String }, text: String, imageUrl: String, options: [String], correct: String, bonusPoints: Number, triggerSeconds: Number, part: String, isActive: { type: Boolean, default: true }, solutionUrl: String }],
}, { timestamps: true })
lessonSchema.index({ teacher: 1, week: 1, order: 1 })
export const lessonModel = tenantModel("Lesson", lessonSchema)

const lessonGrantSchema = new Schema({
    teacher, student,
    lesson: { type: Types.ObjectId, ref: "Lesson", required: true },
    method: String,
    maxViews: Number,
    viewsUsed: { type: Number, default: 0 },
    startedAt: Date,
    expiresAt: Date,
    hours: Number,
    createdAt: { type: Date, default: Date.now },
})
lessonGrantSchema.index({ teacher: 1, lesson: 1, student: 1 })
export const lessonGrantModel = tenantModel("LessonGrant", lessonGrantSchema)

const lessonAnswerSchema = new Schema({
    teacher, student,
    lesson: { type: Types.ObjectId, ref: "Lesson", required: true },
    question: { type: Types.ObjectId, required: true },
    choice: String,
    imageUrl: String,
    text: String,
    status: String,
    isCorrect: { type: Boolean, default: null },
    points: { type: Number, default: 0 },
    gradedBy: Types.ObjectId,
    gradedAt: Date,
    createdAt: { type: Date, default: Date.now },
})
lessonAnswerSchema.index({ question: 1, student: 1 }, { unique: true })
lessonAnswerSchema.index({ teacher: 1, lesson: 1 })
export const lessonAnswerModel = tenantModel("LessonAnswer", lessonAnswerSchema)

const watchSchema = new Schema({
    teacher, student,
    lesson: { type: Types.ObjectId, ref: "Lesson", required: true },
    part: { type: String, required: true },
    seconds: { type: Number, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } })
watchSchema.index({ lesson: 1, student: 1, part: 1 }, { unique: true })
watchSchema.index({ teacher: 1, student: 1 })
export const watchModel = tenantModel("WatchProgress", watchSchema)

const bookletSchema = new Schema({
    teacher,
    name: { type: String, required: true },
    grade: { type: String, default: "" },
    printPrice: { type: Number, default: 0 },
    sellPrice: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true })
bookletSchema.index({ teacher: 1 })
export const bookletModel = tenantModel("Booklet", bookletSchema)

const bookletOrderSchema = new Schema({
    teacher, student,
    booklet: { type: Types.ObjectId, ref: "Booklet", required: true },
    price: Number,
    paid: { type: Number, default: 0 },
    delivered: { type: Boolean, default: false },
    deliveredAt: Date,
    method: { type: String, default: "center" },
    status: { type: String, default: "pending" },
    receiptUrl: { type: String, default: "" },
    reference: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
})
bookletOrderSchema.index({ teacher: 1, createdAt: -1 })
bookletOrderSchema.index({ booklet: 1, student: 1 })
export const bookletOrderModel = tenantModel("BookletOrder", bookletOrderSchema)

const rechargeCodeSchema = new Schema({
    teacher,
    code: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
    used: { type: Boolean, default: false },
    usedBy: { type: Types.ObjectId, ref: "Student", default: null },
    usedAt: Date,
    batch: String,
    createdAt: { type: Date, default: Date.now },
})
rechargeCodeSchema.index({ teacher: 1, used: 1 })
export const rechargeCodeModel = tenantModel("RechargeCode", rechargeCodeSchema)

const topupSchema = new Schema({
    teacher, student,
    amount: { type: Number, required: true },
    method: { type: String, default: "Transfer" },
    reference: { type: String, default: "" },
    receiptUrl: String,
    status: { type: String, default: "pending" },
    reason: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
})
topupSchema.index({ teacher: 1, status: 1, createdAt: -1 })
topupSchema.index({ reference: 1 }, { unique: true, partialFilterExpression: { reference: { $gt: "" } } })
export const topupModel = tenantModel("Topup", topupSchema)

// An announcement shows only inside its teacher's course. platformStatus is the owner's approval to show it outside.
const announcementSchema = new Schema({
    teacher,
    title: { type: String, required: true },
    body: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    videoUrl: { type: String, default: "" },
    linkUrl: { type: String, default: "" },
    audience: { grades: [{ type: String, enum: grades }], centers: [String] },
    isActive: { type: Boolean, default: true },
    pinned: { type: Boolean, default: false },
    platformStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" },
    platformNote: { type: String, default: "" },
}, { timestamps: true })
announcementSchema.index({ teacher: 1, isActive: 1 })
announcementSchema.index({ platformStatus: 1, updatedAt: -1 })
export const announcementModel = tenantModel("Announcement", announcementSchema)

const followCommentSchema = new Schema({
    teacher, student,
    session: { type: Types.ObjectId, ref: "Session", default: null },
    comment: String,
    by: Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
})
followCommentSchema.index({ teacher: 1, student: 1, createdAt: -1 })
export const followCommentModel = tenantModel("FollowComment", followCommentSchema)

const expenseSchema = new Schema({
    teacher,
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    category: { type: String, default: "other" },
    date: { type: Date, default: Date.now },
})
expenseSchema.index({ teacher: 1, date: -1 })
export const expenseModel = tenantModel("Expense", expenseSchema)

// Written once per student per month; counting these rows gives the active students of a teacher.
const monthlyActiveSchema = new Schema({
    teacher, student,
    month: { type: String, required: true },
    reason: String,
    at: { type: Date, default: Date.now },
})
monthlyActiveSchema.index({ teacher: 1, month: 1, student: 1 }, { unique: true })
monthlyActiveSchema.index({ month: 1 })
export const monthlyActiveModel = tenantModel("MonthlyActive", monthlyActiveSchema)

const templateSchema = new Schema({
    teacher,
    type: { type: String, enum: ["attendance", "absence"], required: true },
    body: { type: String, required: true, maxlength: 4000 },
}, { timestamps: true })
templateSchema.index({ teacher: 1, type: 1 }, { unique: true })
export const templateModel = tenantModel("MessageTemplate", templateSchema)

const messageBatchSchema = new Schema({
    teacher,
    channel: { type: String, required: true },
    type: { type: String, required: true },
    session: { type: Types.ObjectId, ref: "Session", default: null },
    total: { type: Number, default: 0 },
    delaySeconds: { type: Number, default: 0 },
    createdBy: Types.ObjectId,
    createdAt: { type: Date, default: Date.now },
})
messageBatchSchema.index({ teacher: 1, createdAt: -1 })
export const messageBatchModel = tenantModel("MessageBatch", messageBatchSchema)

const messageItemSchema = new Schema({
    teacher,
    batch: { type: Types.ObjectId, ref: "MessageBatch", required: true },
    student: { type: Types.ObjectId, ref: "Student", default: null },
    name: String,
    to: String,
    body: String,
    channel: String,
    status: { type: String, enum: ["queued", "sent", "simulated", "failed", "skipped"], default: "queued" },
    error: String,
    sentAt: Date,
})
messageItemSchema.index({ teacher: 1, batch: 1 })
export const messageItemModel = tenantModel("MessageItem", messageItemSchema)
