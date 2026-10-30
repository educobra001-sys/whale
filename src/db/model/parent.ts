import mongoose, { Types } from "mongoose"
import { accountPlugin } from "../plugin/account.plugin"

const parentSchema = new mongoose.Schema({
    name: String,
    phone: { type: String, required: true, unique: true },
    password: String,
    children: [{ type: Types.ObjectId, ref: "Student" }],
}, { timestamps: true })

parentSchema.plugin(accountPlugin("parent"))

const parentModel = mongoose.model("Parent", parentSchema)
export default parentModel
