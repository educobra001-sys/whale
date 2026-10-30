import mongoose, { Types } from "mongoose"
import { genders } from "../../common/enum/user.enum"
import { accountPlugin } from "../plugin/account.plugin"
import { tenantPlugin } from "../plugin/tenant.plugin"

const assistantSchema = new mongoose.Schema({
    teacher: { type: Types.ObjectId, ref: "Teacher", required: true },
    firstName: String,
    lastName: String,
    userName: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, required: true, unique: true },
    password: String,
    profilepic: String,
    gender: { type: String, enum: genders, default: "male" },
    role: { type: String, enum: ["Admin", "Assistant"], default: "Assistant" },
    permissions: { type: [String], default: ["dashboard", "students_view", "sessions_view", "scan_attendance"] },
    salary: {
        type: { type: String, enum: ["fixed", "hourly", "per_session"], default: "fixed" },
        amount: { type: Number, default: 0 },
    },
}, { timestamps: true })

assistantSchema.plugin(accountPlugin("assistant"))
assistantSchema.plugin(tenantPlugin)
assistantSchema.index({ teacher: 1 })

const assistantModel = mongoose.model("Assistant", assistantSchema)
export default assistantModel
