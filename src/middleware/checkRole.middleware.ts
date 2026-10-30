// import { NextFunction, Response } from "express"
// import { userRequest } from "./auth.middleware"
// import { DatabaseReposatory } from "../database/reposatory/database.reposatory"
// import { IUser } from "../common"
// import userModel from "../database/model/user.model"
// import { BadRequestError, NotFoundError } from "../common/exceptions/error.exceptions"

// let userReposatory = new DatabaseReposatory<IUser>(userModel)


// export const checkRole =(Roles:string[])=>{
//     return async (req:userRequest,res:Response,next:NextFunction)=>{
//         let dataUser = await userReposatory.findById({id:req.user.id})
//         if(!dataUser){
//             throw new NotFoundError('user not found')
//         }
//         let matched = Roles.find((role)=>role==dataUser.role)
//         if(matched){
//             next()
//         }else{
//             throw new BadRequestError('unauthorized trial')
//         }
//     }
// }