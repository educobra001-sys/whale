import mongoose from "mongoose"
import { genders, subjects, teacherStatuses, teachingLanguages } from "../../common/enum/user.enum"
import { accountPlugin } from "../plugin/account.plugin"

const teacherSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    userName: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    confirmEmail: { type: Boolean, default: false },
    profilepic: String,
    gender: { type: String, enum: genders, default: "male" },
    companyName: { type: String, unique: true, sparse: true },
    subject: { type: [String], enum: subjects },
    teachingLanguage: { type: String, enum: teachingLanguages },
    bio: { type: String, maxlength: 600 },
    status: { type: String, enum: teacherStatuses, default: "pending_email" },
    statusNote: String,
    approvedAt: Date,
    visibility: { type: String, enum: ["public", "private"], default: "private" },
    // Plan chosen by the owner: only these sections are available to this teacher.
    features: { type: [String], default: [] },
    pricePerStudent: { type: Number, default: 0 },
    // Affiliate deal the owner attached to this teacher.
    affiliate: {
        code: String,
        ratePerStudent: { type: Number, default: 0 },
        since: Date,
    },
    // Which messaging routes the owner activated for this teacher.
    channels: {
        telegram: { type: Boolean, default: false },
        whatsapp_api: { type: Boolean, default: false },
        whatsapp_web: { type: Boolean, default: false },
        whatsapp_link: { type: Boolean, default: false },
    },
}, { timestamps: true })

teacherSchema.plugin(accountPlugin("teacher"))
teacherSchema.index({ status: 1, visibility: 1 })
teacherSchema.index({ "affiliate.code": 1 }, { sparse: true })

const teacherModel = mongoose.model("Teacher", teacherSchema)
export default teacherModel
