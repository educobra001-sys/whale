// Turns the fresh local mongod into a one-node replica set. Safe to run again.
const mongoose = require("../node_modules/mongoose")
;(async () => {
    const conn = await mongoose.createConnection("mongodb://127.0.0.1:27117/admin?directConnection=true", { serverSelectionTimeoutMS: 15000 }).asPromise()
    try {
        await conn.db.admin().command({ replSetInitiate: { _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27117" }] } })
        console.log("replica set created")
    } catch (error) {
        console.log(error.codeName === "AlreadyInitialized" ? "replica set already exists" : error.message)
    }
    for (let i = 0; i < 40; i += 1) {
        const hello = await conn.db.admin().command({ hello: 1 })
        if (hello.isWritablePrimary) break
        await new Promise((resolve) => setTimeout(resolve, 500))
    }
    await conn.close()
})()
