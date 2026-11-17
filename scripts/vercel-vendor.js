// Copies the QR libraries next to the pages, so Vercel serves them as plain files (the API serves them elsewhere).
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const copy = (from, to) => {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true })
    fs.copyFileSync(path.join(root, from), path.join(root, to))
}
copy("node_modules/qrcode-generator/dist/qrcode.js", "front-end/vendor/qrcode/qrcode.js")
copy("node_modules/jsqr/dist/jsQR.js", "front-end/vendor/jsQR.js")
console.log("vendor files copied")
