// Platform-wide collections: the owner's catalogue, billing, affiliates and settings.
import mongoose, { Schema, Types } from "mongoose"

const centerLinkSchema = new Schema({
    teacher: { type: Types.ObjectId, ref: "Teacher", required: true },
    center: { type: Types.ObjectId, ref: "Center", required: true },
    status: { type: String, enum: ["pending", "active", "rejected"], default: "pending" },
    requestedBy: { type: String, enum: ["teacher", "center"], required: true },
}, { timestamps: true })
centerLinkSchema.index({ teacher: 1, center: 1 }, { unique: true })
centerLinkSchema.index({ center: 1, status: 1 })
export const centerLinkModel = mongoose.model("CenterLink", centerLinkSchema)

const teacherLinkSchema = new Schema({
    from: { type: Types.ObjectId, ref: "Teacher", required: true },
    to: { type: Types.ObjectId, ref: "Teacher", required: true },
    status: { type: String, enum: ["pending", "active"], default: "pending" },
}, { timestamps: true })
teacherLinkSchema.index({ from: 1, to: 1 }, { unique: true })
teacherLinkSchema.index({ to: 1, status: 1 })
export const teacherLinkModel = mongoose.model("TeacherLink", teacherLinkSchema)

const featureSchema = new Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    price: { type: Number, default: 0, min: 0 },
    order: { type: Number, default: 0 },
}, { timestamps: true })
export const featureModel = mongoose.model("Feature", featureSchema)

// A different price per student for students matching the filters. Highest priority wins.
const pricingRuleSchema = new Schema({
    teacher: { type: Types.ObjectId, ref: "Teacher", required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    filters: {
        grades: [String],
        centers: [{ type: Types.ObjectId, ref: "Center" }],
        students: [String],
        joinedAfter: Date,
        joinedBefore: Date,
    },
}, { timestamps: true })
pricingRuleSchema.index({ teacher: 1, priority: -1 })
export const pricingRuleModel = mongoose.model("PricingRule", pricingRuleSchema)

const invoiceSchema = new Schema({
    teacher: { type: Types.ObjectId, ref: "Teacher", required: true },
    month: { type: String, required: true },
    activeStudents: { type: Number, default: 0 },
    totalStudents: { type: Number, default: 0 },
    lines: [{ _id: false, label: String, count: Number, price: Number, amount: Number }],
    total: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "paid"], default: "open" },
    paidAt: Date,
    note: { type: String, default: "" },
}, { timestamps: true })
invoiceSchema.index({ teacher: 1, month: 1 }, { unique: true })
invoiceSchema.index({ month: 1, status: 1 })
export const invoiceModel = mongoose.model("Invoice", invoiceSchema)

const affiliateEarningSchema = new Schema({
    code: { type: String, required: true },
    teacher: { type: Types.ObjectId, ref: "Teacher", required: true },
    month: { type: String, required: true },
    activeStudents: Number,
    rate: Number,
    amount: Number,
    status: { type: String, enum: ["due", "paid"], default: "due" },
    paidAt: Date,
}, { timestamps: true })
affiliateEarningSchema.index({ code: 1, teacher: 1, month: 1 }, { unique: true })
affiliateEarningSchema.index({ month: 1, status: 1 })
export const affiliateEarningModel = mongoose.model("AffiliateEarning", affiliateEarningSchema)

const settingSchema = new Schema({
    _id: { type: String, required: true },
    value: Schema.Types.Mixed,
}, { timestamps: true })
export const settingModel = mongoose.model("PlatformSetting", settingSchema)

// A Telegram chat that receives one student's messages. Made when someone shares their phone number with the bot
// (matched against the student's or the parent's phone) or opens a signed link from the app.
const telegramLinkSchema = new Schema({
    chatId: { type: String, required: true },
    student: { type: Types.ObjectId, ref: "Student", required: true },
    kind: { type: String, enum: ["student", "parent"], default: "parent" },
    phone: String,
    telegramName: String,
    telegramUsername: String,
}, { timestamps: true })
telegramLinkSchema.index({ chatId: 1, student: 1 }, { unique: true })
telegramLinkSchema.index({ student: 1 })
export const telegramLinkModel = mongoose.model("TelegramLink", telegramLinkSchema)

// One WhatsApp number linked by QR: "platform" (the owner's number) or a teacher's id.
// Its login lives in whatsappAuth, so any server process (or a short-lived Vercel function) can use it.
const whatsappAccountSchema = new Schema({
    _id: { type: String, required: true },
    status: { type: String, enum: ["disconnected", "connecting", "qr", "connected"], default: "disconnected" },
    phone: String,
    qr: String,
    error: String,
    linkedAt: Date,
    lastSentAt: Date,
    lastSeenAt: Date,
}, { timestamps: true })
export const whatsappAccountModel = mongoose.model("WhatsappAccount", whatsappAccountSchema)

const whatsappAuthSchema = new Schema({
    _id: { type: String, required: true },
    account: { type: String, required: true },
    value: { type: String, required: true },
})
whatsappAuthSchema.index({ account: 1 })
export const whatsappAuthModel = mongoose.model("WhatsappAuth", whatsappAuthSchema)

const auditLogSchema = new Schema({
    actor: Types.ObjectId,
    actorRole: String,
    action: { type: String, required: true },
    target: String,
    details: Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
})
auditLogSchema.index({ createdAt: -1 })
export const auditLogModel = mongoose.model("AuditLog", auditLogSchema)
