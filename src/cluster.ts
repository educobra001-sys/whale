import cluster from "node:cluster"
import os from "node:os"
import { env } from "./config/env.service"
import { bootstrap } from "./app.controller"

// One API process per core, all sharing the same port. Replaces any process that dies.
if (cluster.isPrimary) {
    const size = env.webConcurrency || os.availableParallelism()
    for (let index = 0; index < size; index += 1) cluster.fork()
    cluster.on("exit", (worker) => {
        console.log(`process ${worker.process.pid} stopped, starting a replacement`)
        cluster.fork()
    })
} else {
    // The background worker runs as its own process next to the cluster: npm run start:worker
    bootstrap({ worker: false }).catch((error) => {
        console.error(error)
        process.exit(1)
    })
}
