import { Types } from "mongoose";
import { genderEnum, providerEnum } from "../enum/user.enum";
import { teachingLanguageEnum } from "../enum/subject.enum";


export interface ITeacher {
    email:string,
    userName:string,
    password:string,
    phone:string,
    firstName?:string,
    lastName?:string,
    profilepic?:string| undefined,
    confirmEmail?:boolean,
    gender?:string,
    provider?:string,
    companyName?:string,
    subject:string[],
    assistants:Types.ObjectId[],
    teachingLanguage:string,
    createdAt:Date,
    students:Types.ObjectId[],
    center:Types.ObjectId[]
}