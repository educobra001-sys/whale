// Measures each layer on its own, to show where time goes before tuning anything.
require("dotenv").config({ quiet: true })
const mongoose = require("mongoose")
const { createClient } = require("redis")

const rate = async (label, total, concurrency, fn) => {
    const started = Date.now()
    let done = 0
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (done < total) {
            done += 1
            await fn(done)
        }
    }))
    const seconds = (Date.now() - started) / 1000
    console.log(`${label}: ${Math.round(total / seconds)}/s`)
}

;(async () => {
    await mongoose.connect(process.env.DATABASE_URL, { dbName: "educobra_bench", maxPoolSize: 50 })
    const db = mongoose.connection.db
    const rows = db.collection("rows")
    await rows.deleteMany({})
    await rows.insertMany(Array.from({ length: 1000 }, (_, id) => ({ id, value: id })))
    await rows.createIndex({ id: 1 })

    await rate("mongo read (native driver)", 6000, 50, (n) => rows.findOne({ id: n % 1000 }))
    await rate("mongo write, no flush (w:1, j:false)", 3000, 50, (n) => rows.insertOne({ n }, { writeConcern: { w: 1, j: false } }))
    await rate("mongo write, journal flush (w:majority)", 400, 50, (n) => rows.insertOne({ n }, { writeConcern: { w: "majority" } }))
    await rate("mongo transaction, 4 writes (w:majority)", 200, 20, async (n) => {
        const session = mongoose.connection.client.startSession()
        await session.withTransaction(async () => {
            for (let i = 0; i < 4; i += 1) await rows.insertOne({ n, i }, { session })
        }, { writeConcern: { w: "majority" } })
        await session.endSession()
    })
    const redis = createClient({ url: process.env.REDIS_URL })
    await redis.connect()
    await rate("redis GET", 20000, 50, () => redis.get("nothing"))
    await redis.quit()
    await db.dropDatabase()
    await mongoose.disconnect()
})()
