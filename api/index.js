// Every request that isn't a file in front-end/ lands here (see vercel.json). `npm run build` makes dist/.
module.exports = require("../dist/serverless.js").default
