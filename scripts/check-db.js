// Checks a MongoDB link before you paste it into a host.
// node scripts/check-db.js "mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority"
const mongoose = require("mongoose")

const link = (process.argv[2] || "").trim()
if (!link) {
    console.log('Usage: node scripts/check-db.js "<your mongodb+srv link>"')
    process.exit(1)
}

let parsed
try {
    parsed = new URL(link)
} catch {
    console.log("This isn't a valid link. It should start with mongodb+srv://")
    process.exit(1)
}
console.log(`User:     ${decodeURIComponent(parsed.username) || "(none)"}`)
console.log(`Password: ${parsed.password ? `${parsed.password.length} characters` : "(none)"}${/[<>]/.test(parsed.password) ? "  <- still has < > in it" : ""}`)
console.log(`Cluster:  ${parsed.host}`)

mongoose.connect(link, { serverSelectionTimeoutMS: 10_000 })
    .then(() => {
        console.log("\nOK: this link works. Paste exactly this into Vercel as DATABASE_URL, then redeploy.")
        return mongoose.disconnect()
    })
    .catch((error) => {
        console.log(`\nFailed: ${error.message}`)
        if (/bad auth|authentication/i.test(error.message)) console.log("The user name or password is wrong. Check both in Atlas > Database Access.")
        if (/whitelist|IP|timed out|ENOTFOUND/i.test(error.message)) console.log("Check Atlas > Network Access allows 0.0.0.0/0, and the cluster part of the link.")
        process.exit(1)
    })
