import { Types } from "mongoose";
import { ChatEnum } from "../enum/chat.enum";


export interface IMessage {
    content : string,
    attachments:string[],
    likes?:Types.ObjectId[]
    tags?:Types.ObjectId[]
    createdBy:Types.ObjectId 
    createdAt?:Date,
    editedAt?:Date,
    deletedAt?:Date,
    restoredAt?:Date
}


export interface IChat {
    particepate:Types.ObjectId[] 
    createdBy:Types.ObjectId 
    message:IMessage[],
    type:ChatEnum,
    group?:string,
    groupImage?:string,
    roomID?:string,
    createdAt?:Date,
    editedAt?:Date,
    deletedAt?:Date,
    restoredAt?:Date
}