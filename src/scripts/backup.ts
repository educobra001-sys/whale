// Full database backup to backups/educobra-<time>.jsonl.gz.
// Reads every collection with a cursor and gzips while writing, so memory stays flat however big the
// database grows. One line per document: {"c": collection, "d": document as Extended JSON}.
import fs from "node:fs"
import path from "node:path"
import { once } from "node:events"
import zlib from "node:zlib"
import mongoose from "mongoose"
import { env } from "../config/env.service"
import { dbconnection } from "../db/connection"

const EJSON = mongoose.mongo.BSON.EJSON
export const backupDir = path.resolve(__dirname, "../..", env.backupDir)

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

// Older backups beyond the newest `keep` are removed.
const prune = async (keep: number) => {
    const files = (await fs.promises.readdir(backupDir)).filter((name) => /^educobra-.+\.jsonl\.gz$/.test(name)).sort()
    for (const name of files.slice(0, Math.max(0, files.length - keep))) await fs.promises.rm(path.join(backupDir, name), { force: true })
}

export const runBackup = async () => {
    await fs.promises.mkdir(backupDir, { recursive: true })
    const db = mongoose.connection.db
    if (!db) throw new Error("Database is not connected")
    const target = path.join(backupDir, `educobra-${stamp()}.jsonl.gz`)
    const partial = `${target}.part`
    const gzip = zlib.createGzip({ level: 6 })
    const out = fs.createWriteStream(partial)
    gzip.pipe(out)
    const counts: Record<string, number> = {}
    const write = async (line: string) => {
        if (!gzip.write(line)) await once(gzip, "drain")
    }
    try {
        await write(`${JSON.stringify({ backup: "educobra", db: env.db_name, at: new Date().toISOString(), version: 1 })}\n`)
        const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
            .map((item) => item.name)
            .filter((name) => !name.startsWith("system."))
            .sort()
        for (const name of collections) {
            counts[name] = 0
            const cursor = db.collection(name).find({}, { batchSize: 500 })
            for await (const doc of cursor) {
                await write(`${JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) })}\n`)
                counts[name] += 1
            }
        }
        gzip.end()
        await once(out, "finish")
        await fs.promises.rename(partial, target)
    } catch (error) {
        gzip.destroy()
        out.destroy()
        await fs.promises.rm(partial, { force: true })
        throw error
    }
    await prune(env.backupKeep)
    const { size } = await fs.promises.stat(target)
    return { file: target, size, counts }
}

if (require.main === module) {
    dbconnection()
        .then(runBackup)
        .then(({ file, size, counts }) => {
            const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
            console.log(`backup saved: ${file}`)
            console.log(`${total} documents in ${Object.keys(counts).length} collections, ${(size / 1024 / 1024).toFixed(2)} MB`)
        })
        .then(() => mongoose.disconnect())
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
