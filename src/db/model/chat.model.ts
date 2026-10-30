import mongoose, { Types } from "mongoose";
import { IChat, IMessage } from "../../common/interface/chat.interface";
import { ChatEnum } from "../../common/enum/chat.enum";


const messageSchema = new mongoose.Schema<IMessage>({
    content:{
        type:String,
        required:function(this){
            return this.attachments.length == 0
        }
    },
    attachments:{
        type:[String]
    },
    likes:{
        type:[Types.ObjectId],
        ref:'user'
    },
    tags:{
        type:[Types.ObjectId],
        ref:'user'
    },
    createdBy:{
        type:Types.ObjectId,
        ref:'user'
    },
    createdAt:{
        type:Date,
        default:Date.now
    },
    editedAt:{
        type:Date,
        default:Date.now
    },
    deletedAt:{
        type:Date,
        default:null
    },
    restoredAt:{
        type:Date,
        default:null
    }
})

export const chatSchema = new mongoose.Schema<IChat>({
    particepate:[{
        type:Types.ObjectId,
        ref:'user'
    }],
    createdBy:{
        type:Types.ObjectId,
        ref:'user'
    },
    message:{
        type:[messageSchema],
        required:true
    },
    roomID:{
        type:String,
        required:true
    },
    type:{
        type:String,
        enum : ChatEnum ,
        default:ChatEnum.ovm
    },
    group:{
        type:String,
        required:function(this){
            return this.type == ChatEnum.ovm
        }
    },
    groupImage:{
        type:String,
        // required:function(this){
        //     return this.type == 'ovm'
        // }
    },
    createdAt:{
        type:Date,
        default:Date.now
    },
    editedAt:{
        type:Date,
        default:Date.now
    },
    deletedAt:{
        type:Date,
        default:null
    },
    restoredAt:{
        type:Date,
        default:null
    }

},{
    timestamps:true,
    toJSON:{virtuals:true},
    strict:true
})


export const chatModel = mongoose.model<IChat>('chat',chatSchema)