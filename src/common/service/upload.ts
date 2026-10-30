import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { v2 as cloudinary } from "cloudinary"
import multer from "multer"
import { env } from "../../config/env.service"
import { BadRequestError } from "../exceptions/error.exceptions"

const ALLOWED: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
}

export const uploadRoot = path.resolve(__dirname, "../../..", env.uploadDir)
fs.mkdirSync(uploadRoot, { recursive: true })

const useCloudinary = Boolean(env.cloudinaryCloud && env.cloudinaryKey && env.cloudinarySecret)
if (useCloudinary) {
    cloudinary.config({ cloud_name: env.cloudinaryCloud, api_key: env.cloudinaryKey, api_secret: env.cloudinarySecret, secure: true })
}

// Moves a finished upload to Cloudinary when it's configured, otherwise keeps it in the local folder.
export const storeUpload = async (file: Express.Multer.File) => {
    if (!useCloudinary) return `/files/${file.filename}`
    try {
        // Cloudinary blocks PDFs delivered as images by default, so they go up as plain files.
        const resource_type = file.mimetype === "application/pdf" ? "raw" : "auto"
        const stored = await cloudinary.uploader.upload(file.path, { folder: env.cloudinaryFolder, resource_type, use_filename: false })
        return stored.secure_url
    } finally {
        await fs.promises.rm(file.path, { force: true })
    }
}

// The stored name and extension come from the server, never from the file the client sent.
export const uploadFile = multer({
    limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter(req, file, cb) {
        if (ALLOWED[file.mimetype]) cb(null, true)
        else cb(new BadRequestError("Only images, PDF files and MP4 videos can be uploaded"))
    },
    storage: multer.diskStorage({
        destination(req, file, cb) {
            cb(null, uploadRoot)
        },
        filename(req, file, cb) {
            cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype]}`)
        },
    }),
})
