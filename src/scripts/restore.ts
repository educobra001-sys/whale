// Restores a backup made by `npm run backup`. It REPLACES every collection found in the file.
//   npm run restore -- backups/educobra-2026-11-13T10-00-00.jsonl.gz --confirm
// Reads the file as a stream and inserts in batches, so it works for any size.
import fs from "node:fs"
import readline from "node:readline"
import zlib from "node:zlib"
import mongoose from "mongoose"
import { env } from "../config/env.service"
import { dbconnection } from "../db/connection"

const EJSON = mongoose.mongo.BSON.EJSON
const BATCH = 500

const restore = async (file: string) => {
    const db = mongoose.connection.db
    if (!db) throw new Error("Database is not connected")
    const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity })
    const cleared = new Set<string>()
    const pending = new Map<string, any[]>()
    const counts: Record<string, number> = {}
    const flush = async (name: string) => {
        const docs = pending.get(name)
        if (!docs?.length) return
        await db.collection(name).insertMany(docs, { ordered: false })
        counts[name] = (counts[name] ?? 0) + docs.length
        pending.set(name, [])
    }
    let header = true
    for await (const line of lines) {
        if (!line.trim()) continue
        const row = JSON.parse(line)
        if (header) {
            if (row.backup !== "educobra") throw new Error("This isn't an EduCobra backup file")
            console.log(`backup of "${row.db}" taken ${row.at}`)
            header = false
            continue
        }
        if (!cleared.has(row.c)) {
            await db.collection(row.c).deleteMany({})
            cleared.add(row.c)
        }
        const list = pending.get(row.c) ?? []
        list.push(EJSON.deserialize(row.d, { relaxed: false }))
        pending.set(row.c, list)
        if (list.length >= BATCH) await flush(row.c)
    }
    for (const name of pending.keys()) await flush(name)
    return counts
}

if (require.main === module) {
    const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"))
    if (!file || !process.argv.includes("--confirm")) {
        console.log("Usage: npm run restore -- <backup file> --confirm")
        console.log(`This replaces the data in the "${env.db_name}" database.`)
        process.exit(1)
    }
    dbconnection()
        .then(() => restore(file))
        .then((counts) => console.log(`restored ${Object.values(counts).reduce((a, b) => a + b, 0)} documents into ${Object.keys(counts).length} collections`))
        .then(() => mongoose.disconnect())
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
