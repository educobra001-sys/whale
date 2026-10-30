// import { DeleteObjectCommand, GetObjectCommand, GetObjectCommandOutput, ObjectCannedACL, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
// import { env } from "../../config/env.service";
// import { MulterStorageEnums } from "../enums/multer.enum";
// import fs, { createReadStream } from 'fs'
// import { Upload } from "@aws-sdk/lib-storage";
// import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


// export class S3Service {
//     private client : S3Client
//     constructor(){
//         this.client = new S3Client({
//             region:'us-east-1',
//             credentials:{
//                 accessKeyId:env.s3_accessKey as string,
//                 secretAccessKey:env.s3_secretKey as string,
//             }
//         })
//     }
//     async uploadFile({
//         memoryStorage=MulterStorageEnums.memoryStorage,
//         Bucket=env.s3_BucketName,
//         path='general',
//         file,
//         Acl=ObjectCannedACL.private,
//         contentType
//     }:{
//         file:Express.Multer.File,
//         memoryStorage:MulterStorageEnums
//         Bucket?:string,
//         path?:string,
//         Acl?:ObjectCannedACL,
//         contentType?:string
//     }){
//         const key = `socialApp/${path}/${Math.round(Date.now()/1000)}-${file.originalname}`
//         const result = await this.client.send(
//             new PutObjectCommand({
//                 Bucket,
//                 Key:key,
//                 Body:memoryStorage==MulterStorageEnums.memoryStorage? file.buffer :createReadStream(file.path as string),
//                 ACL:Acl,
//                 ContentType:contentType
//             })
//         )
//         return key
//     }

//     async uploadBigFile({
//         memoryStorage=MulterStorageEnums.memoryStorage,
//         Bucket=env.s3_BucketName,
//         path='general',
//         file,
//         Acl=ObjectCannedACL.private,
//         contentType,
//         partSize=5
//     }:{
//         file:Express.Multer.File,
//         memoryStorage:MulterStorageEnums
//         Bucket?:string,
//         path?:string,
//         Acl?:ObjectCannedACL,
//         contentType?:string,
//         partSize?:number
//     }){
//         const key = `socialApp/${path}/${Math.round(Date.now()/1000)}-${file.originalname}`
//         const result = new Upload({
//             client:this.client,
//             params:{
//                 Bucket,
//                 ACL:Acl,
//                 Key:key,
//                 Body:memoryStorage==MulterStorageEnums.memoryStorage? file.buffer :createReadStream(file.path as string),
//                 ContentType:contentType
//             },
//             partSize:partSize*1024*1024
//         })
//         result.on("httpUploadProgress",(progress)=>{
//             console.log(`${(progress.loaded as number)/(progress.total as number)*100}%`)
//         })
//         return await result.done()
//     }

//     async getFileFromBucket({
//         Bucket=env.s3_BucketName,
//         key
//     }:{
//         key:string
//         Bucket?:string
//     }):Promise<GetObjectCommandOutput>{
//         const file = await new GetObjectCommand({
//             Bucket,
//             Key:key
//         })
//         return await this.client.send(file)
//     }

//     async GetPreSignURL({
//         Bucket = env.s3_BucketName,
//         path = "general",
//         ContentType,
//         Key,
//         Expires = 60 * 2,
//         Originalname
//     }:{
//         Bucket?:string,
//         path?:string,
//         ContentType?:string,
//         Expires?:number,
//         Key?:string,
//         Originalname:string
//     }):Promise<Object>{
//         const key = `socialMedia/${path}/${Math.round(Math.random() *1e9)}-${Originalname}`
//         const result = new PutObjectCommand({
//             Bucket,
//             Key:key,
//             ContentType
//         })
//         const url = await getSignedUrl(this.client,result,{expiresIn:Expires})
//         return {url , key}
//     }

//     async deleteAsset({
//         Bucket = env.s3_BucketName,
//         Key,
//         }: {
//         Bucket?: string,
//         Key: string,
//         }) {
//         const result = await new DeleteObjectCommand({
//         Bucket,
//         Key
//         })
//         return this.client.send(result)
//         }
// }


// export const s3service = new S3Service()