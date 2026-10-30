import { Types } from "mongoose"

export interface ISessionAttendance {
    student: Types.ObjectId
    markedAt: Date
}

export interface ISession {
    teacher: Types.ObjectId
    sequence: string
    week: number
    number: number
    active: boolean
    attendance: ISessionAttendance[]
    createdAt?: Date
    updatedAt?: Date
}
