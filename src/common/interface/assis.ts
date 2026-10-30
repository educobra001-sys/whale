import { Types } from "mongoose";
import { assistantTypeEnum, genderEnum, providerEnum } from "../enum/user.enum";


export interface IAssistant {
    email:string,
    userName:string,
    password:string,
    phone:string,
    firstName?:string,
    lastName?:string,
    profilepic?:string| undefined,
    confirmEmail?:boolean,
    gender?:genderEnum,
    provider?:providerEnum,
    teacher:Types.ObjectId,
    role?:assistantTypeEnum,
    createdAt:Date

}