import mongoose from "mongoose"
import { centerStatuses } from "../../common/enum/user.enum"
import { accountPlugin } from "../plugin/account.plugin"

const centerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    password: String,
    phone: { type: String, required: true, unique: true },
    textlocation: String,
    Maplocation: String,
    localphone: String,
    status: { type: String, enum: centerStatuses, default: "pending_approval" },
    statusNote: String,
}, { timestamps: true })

centerSchema.plugin(accountPlugin("center"))
centerSchema.index({ status: 1 })

const centerModel = mongoose.model("Center", centerSchema)
export default centerModel
