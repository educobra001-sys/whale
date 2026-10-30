// import { Socket } from 'socket.io'
// import {chatservice,chatService} from '../chat.service'
// import { redisService, RedisService } from '../../../common/service/redisService'

// export class chatEvent {
//     private chatservice : chatService
//     private redisservice : RedisService
//     constructor(){
//         this.chatservice = chatservice
//         this.redisservice = redisService
//     }

//     addMessage(socket:any,io:any){
//         return socket.on('sendMessage',async(data:any,type:any)=>{
//             await this.chatservice.sendMessage(data,socket)
//             let senderIDs = await this.redisservice.getUserSockets(socket.data.id)
//             let recieverIDs = await this.redisservice.getUserSockets(data.sendTo)
//             let broadcastIDs = [...senderIDs,...recieverIDs]
//             socket.emit("successMessage",data)
//             if(recieverIDs.length){
//             io.to(recieverIDs).emit("newMessage",{content:data.content , from :socket.data.id})
//     }})
// }
//     addGroupMessage(socket:any,io:any){
//         return socket.on('sendGroupMessage',async(data:any,type:any)=>{
//             //console.log(data,socket.data.id);
//             let chat = await this.chatservice.sendGroupMessage(data,socket)
//             let objectIdArray = chat.particepate
//             const stringArray = objectIdArray.map((id:any) => id.toString());
//             let particepantIDs = await this.redisservice.getUsersSockets(stringArray)
            
//             socket.emit("successMessage",{content:data.content, sendTo:data.groupId})
//             const recieverIDs = particepantIDs.filter(item => item !== socket.id)
//             //console.log(particepantIDs.length , recieverIDs.length);
            
//             if(recieverIDs.length){
//             io.to(recieverIDs).emit("newMessage",{content:data.content , from :socket.data.id,groupId:data.groupId})
//     }})
//     }
// }
