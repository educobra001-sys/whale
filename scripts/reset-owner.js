// Sets a new password for the EduCobra owner account in any database (e.g. the Atlas one Vercel uses).
// node scripts/reset-owner.js "<mongodb+srv link>" "<new password>"
const bcrypt = require("bcrypt")
const mongoose = require("mongoose")

const [link, password] = process.argv.slice(2).map((value) => (value || "").trim())
if (!link || !password) {
    console.log('Usage: node scripts/reset-owner.js "<mongodb+srv link>" "<new password>"')
    process.exit(1)
}
if (password.length < 10) {
    console.log("Use a password of at least 10 characters.")
    process.exit(1)
}

const run = async () => {
    await mongoose.connect(link, { dbName: process.env.DB_NAME || "educobra", serverSelectionTimeoutMS: 10_000 })
    const owners = mongoose.connection.db.collection("owners")
    const list = await owners.find({}, { projection: { userName: 1, email: 1 } }).toArray()
    if (!list.length) {
        console.log("No owner account in this database yet. Open /check-health on the site once; it creates one from OWNER_EMAIL / OWNER_PASSWORD.")
        return
    }
    const hash = await bcrypt.hash(password, 11)
    await owners.updateMany({}, { $set: { password: hash } })
    for (const owner of list) console.log(`Password changed for owner "${owner.userName}" (${owner.email})`)
    console.log("\nSign in with that user name or email and the new password.")
}

run()
    .catch((error) => {
        console.log(`Failed: ${error.message}`)
        process.exitCode = 1
    })
    .finally(() => mongoose.disconnect())
