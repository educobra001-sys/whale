import mongoose from "mongoose"
import { accountPlugin } from "../plugin/account.plugin"

const ownerSchema = new mongoose.Schema({
    name: String,
    userName: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
}, { timestamps: true })

ownerSchema.plugin(accountPlugin("owner"))

const ownerModel = mongoose.model("Owner", ownerSchema)
export default ownerModel
