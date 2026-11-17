// Every request that isn't a file in front-end/ lands here (see vercel.json). `npm run build` makes dist/.
// If the API can't even load (bad settings), every request answers with the reason instead of a blank crash.
const hidePasswords = (text) => String(text).replace(/\/\/[^/\s:@]+:[^@\s]+@/g, "//***:***@").slice(0, 600)

let handler
try {
    handler = require("../dist/serverless.js").default
} catch (error) {
    console.error(error)
    handler = (req, res) => {
        res.statusCode = 500
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ message: "The server couldn't start", reason: hidePasswords(error && error.message) }))
    }
}
module.exports = handler
