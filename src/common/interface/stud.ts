import { Types } from "mongoose";
import { assistantTypeEnum, genderEnum, providerEnum } from "../enum/user.enum";


export interface IStudent {
    userID:string,
    password:string,
    phone:string,
    firstName?:string,
    lastName?:string,
    profilepic?:string| undefined,
    confirmAccount?:boolean,
    gender?:string,
    provider?:string,
    parentPhone:string,
    grade:string,
    schoolName:string,
    learningLanguage:string,
    balance:number,
    createdAt:Date
}