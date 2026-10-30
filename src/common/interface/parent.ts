import { Types } from "mongoose"



export interface IParent {
    phone:string,
    password:string,
    confirmAccount?:boolean,
    gender?:string,
    child:Types.ObjectId[]
    createdAt:Date
}