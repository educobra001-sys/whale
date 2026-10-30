// import { Request, Response, Router } from "express";
// import { auth, userRequest } from "../../middleware/auth.middleware";
// import { chatservice } from "./chat.service";
// import { successResponce } from "../../common/exceptions/successresponce";


// interface chatRequest extends userRequest {
//     particepantID:string
// }

// const router:Router = Router()

// router.get('/:particepantID',auth,async (req:userRequest & {params:chatRequest},res:Response)=>{
//     const data = await chatservice.getChat(req.params.particepantID,req.user.id)
//     successResponce({res,message:'chat accessed',data})
// })

// router.post('/group',auth,async(req:userRequest,res:Response)=>{
//     let data = await chatservice.addGroup(req.user.id,req.body)
//     successResponce({res,message:'group created successfully',data})
// })

// router.get('/group/:groupID',auth,async (req:userRequest & {params:chatRequest},res:Response)=>{
//     const data = await chatservice.getGroupChat(req.params.groupID as string,req.user.id)
//     successResponce({res,message:'groupChat Accessed',data})
// })

// export default router
