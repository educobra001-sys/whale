import { bootstrap } from "./app.controller"

bootstrap().catch((error) => {
    console.error(error)
    process.exit(1)
})
