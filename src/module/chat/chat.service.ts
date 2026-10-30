// import { Types } from "mongoose";
// import { BadRequestError, NotFoundError } from "../../common/exceptions/error.exceptions";
// import { randomUUID } from "crypto";
// import { DatabaseReposatory } from "../../db/repository/db.repo";
// import { IChat } from "../../common/interface/chat.interface";
// import { ChatEnum } from "../../common/enum/chat.enum";
// import { chatModel } from "../../db/model/chat.model";



// export class chatService{
//     private chatReposatory : DatabaseReposatory<IChat>
//     private userReposatory : DatabaseReposatory<IUser>
//     constructor(){
//         this.chatReposatory = new DatabaseReposatory<IChat>(chatModel)
//         this.userReposatory = new DatabaseReposatory<IUser>(userModel)
//     }

//     async getChat(particepantID:string,userID:string){
//         const chat = await this.chatReposatory.findone({
//             filter:{
//                 particepate:{
//                     $all:[new Types.ObjectId(particepantID) ,new Types.ObjectId(userID)]
//                 },
//             },
//             populate:[
//                 {path:'particepate'}
//             ]
//         })
        
//         if(!chat){
//             throw new NotFoundError('no chat exist')
//         }
//         return chat
//     }

//     async sendMessage(data:any,socket:any){
//         let {content , sendTo }:{content:any,sendTo:string} = data
//         let sentFrom = socket.data.id
//         let chat = await this.chatReposatory.updateone({
//             filter:{
//                 particepate:{ $all:[new Types.ObjectId(sentFrom),
//                     new Types.ObjectId(sendTo)]}
//             },
//             data:{
//                 $push:{message:{
//                     content:content,
//                     createdBy:new Types.ObjectId(sentFrom)
//                 }}
//             }
//         })
//         if(!chat.modifiedCount){
//             let sender = new Types.ObjectId(sentFrom)
//             let reciever = new Types.ObjectId(sendTo)
//             const roomID = [sentFrom, sendTo].sort().join('_')
//             let newChat = await this.chatReposatory.create({
//                 particepate:[sender,reciever],
//                 createdBy:sender,
//                 message:[{
//                     content: content,
//                     createdBy: sender,
//                     attachments: []
//                 }],
//                 type:ChatEnum.ovo,
//                 roomID:roomID
//         })
//         return newChat
//         }
//         return chat
//     }

//     async addGroup(userID:string,body:any){
//         let {particepate,group} = body 
//         let paticepantIDs = [...new Set(particepate.map((ele:string)=>{
//             return new Types.ObjectId(ele)
//         }))]
//         let foundPatricepants = await this.userReposatory.findall({
//             filter:{
//                 _id:{$in :paticepantIDs},
//                 friends:{$in :[ new Types.ObjectId(userID)]}
//             }
//         })
//         // console.log(foundPatricepants,'from',paticepantIDs);
        
//         if(foundPatricepants.length != paticepantIDs.length ){
//             throw new BadRequestError('cannot form group chat due to some member is not in ur friend list')
//         }
//         let roomID = randomUUID()
//         paticepantIDs.push(new Types.ObjectId(userID))
//         let groupChat = await this.chatReposatory.create({
//             particepate:paticepantIDs as Types.ObjectId[],
//             createdBy:new Types.ObjectId(userID),
//             roomID,
//             group,
//             type:ChatEnum.ovm,
//             message:[]
//         })
//         await this.userReposatory.updateMany({
//         filter: { _id: { $in: paticepantIDs } },
//         data: { $push: { groups: groupChat._id } }
//     });
//         return groupChat
//     }

//         async getGroupChat(groupID:string,userID:string){
//         const chat = await this.chatReposatory.findone({
//             filter:{
//                 _id: new Types.ObjectId(groupID)
//             },
//             populate:[
//                 {path:'particepate'}
//             ]
//         })
        
//         if(!chat){
//             throw new NotFoundError('no chat exist')
//         }
//         return chat
//     }

//         async sendGroupMessage(data:any,socket:any){
//         let {content , groupId }:{content:any,groupId:string} = data
//         let sentFrom = socket.data.id
//         let chat = await this.chatReposatory.updateone({
//             filter:{
//                 _id: new Types.ObjectId(groupId)
//             },
//             data:{
//                 $push:{message:{
//                     content:content,
//                     createdBy:new Types.ObjectId(sentFrom)
//                 }}
//             }
//         })
//         if(!chat.modifiedCount){
//             throw new NotFoundError('Chat Not Found !!')
//         }
//         return await this.chatReposatory.findById({id:groupId,
//             select:'particepate'
//         })
//     }
// }

// export const chatservice = new chatService()