import mongoose from "mongoose"
import { genders, grades, studyLanguages } from "../../common/enum/user.enum"
import { accountPlugin } from "../plugin/account.plugin"

// One global account per real student, shared by every teacher on the platform.
const studentSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    userID: { type: String, required: true, unique: true },
    phone: { type: String, required: true, unique: true },
    parentPhone: String,
    password: String,
    profilepic: String,
    gender: { type: String, enum: genders, default: "male" },
    grade: { type: String, enum: grades },
    schoolName: String,
    learningLanguage: { type: String, enum: studyLanguages },
    nameKey: String,
}, { timestamps: true })

studentSchema.plugin(accountPlugin("student"))
studentSchema.index({ nameKey: 1, parentPhone: 1 })
studentSchema.index({ parentPhone: 1 })

const studentModel = mongoose.model("Student", studentSchema)
export default studentModel
