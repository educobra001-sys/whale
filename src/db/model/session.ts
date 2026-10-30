import mongoose, { Types } from "mongoose"
import { ISession } from "../../common/interface/session"

const sessionAttendanceSchema = new mongoose.Schema({
    student: {
        type: Types.ObjectId,
        ref: "Student",
        required: true
    },
    markedAt: {
        type: Date,
        required: true,
        default: Date.now
    }
}, { _id: false })

const sessionSchema = new mongoose.Schema<ISession>({
    teacher: {
        type: Types.ObjectId,
        ref: "Teacher",
        required: true
    },
    sequence: {
        type: String,
        required: true,
        trim: true,
        maxlength: 160
    },
    week: {
        type: Number,
        required: true,
        min: 1,
        max: 60
    },
    number: {
        type: Number,
        required: true,
        min: 1,
        max: 999
    },
    active: {
        type: Boolean,
        default: false,
        required: true
    },
    attendance: {
        type: [sessionAttendanceSchema],
        default: []
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
})

sessionSchema.index(
    { teacher: 1, active: 1 },
    {
        unique: true,
        partialFilterExpression: { active: true }
    }
)

const sessionModel = mongoose.model<ISession>("Session", sessionSchema)

export default sessionModel
