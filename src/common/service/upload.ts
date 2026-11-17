import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
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

// Read-only hosts (Vercel) only allow writing in the temp folder, so fall back to it.
const makeUploadRoot = () => {
    const wanted = path.resolve(__dirname, "../../..", env.uploadDir)
    try {
        fs.mkdirSync(wanted, { recursive: true })
        return wanted
    } catch {
        const fallback = path.join(os.tmpdir(), "educobra-uploads")
        fs.mkdirSync(fallback, { recursive: true })
        return fallback
    }
}
export const uploadRoot = makeUploadRoot()

const useCloudinary = Boolean(env.cloudinaryCloud && env.cloudinaryKey && env.cloudinarySecret)
if (useCloudinary) {
    cloudinary.config({ cloud_name: env.cloudinaryCloud, api_key: env.cloudinaryKey, api_secret: env.cloudinarySecret, secure: true })
}

// The browser decides the content type it reports, so the first bytes of the file are checked too.
// A script renamed to photo.png is refused here and deleted before anything can serve it.
const SIGNATURES: Record<string, (head: Buffer) => boolean> = {
    "image/jpeg": (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    "image/png": (head) => head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/webp": (head) => head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP",
    "image/gif": (head) => head.toString("latin1", 0, 4) === "GIF8",
    "application/pdf": (head) => head.toString("latin1", 0, 5) === "%PDF-",
    "video/mp4": (head) => head.toString("latin1", 4, 8) === "ftyp",
}

export const verifyUpload = async (file: Express.Multer.File) => {
    const handle = await fs.promises.open(file.path, "r")
    const head = Buffer.alloc(16)
    try {
        await handle.read(head, 0, 16, 0)
    } finally {
        await handle.close()
    }
    if (!SIGNATURES[file.mimetype]?.(head)) {
        await fs.promises.rm(file.path, { force: true })
        throw new BadRequestError("This file isn't a real image, PDF or MP4 video")
    }
}

// Moves a finished upload to Cloudinary when it's configured, otherwise keeps it in the local folder.
export const storeUpload = async (file: Express.Multer.File) => {
    if (!useCloudinary) return `/files/${file.filename}`
    try {
        // PDF links need "Allow delivery of PDF and ZIP files" on in the Cloudinary security settings.
        const stored = await cloudinary.uploader.upload(file.path, { folder: env.cloudinaryFolder, resource_type: "auto", use_filename: false })
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
