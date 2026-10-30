// Starts or stops the local MongoDB (single-node replica set, needed for transactions) and Redis.
// All data lives in .data/ next to the project, on the D drive.
const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const tools = process.env.EDUCOBRA_TOOLS || "D:/dev/tools"
const mongoHome = fs.readdirSync(tools).find((name) => name.startsWith("mongodb-win32"))
const mongod = path.join(tools, mongoHome, "bin", "mongod.exe")
const redisHome = fs.readdirSync(path.join(tools, "redis"))[0]
const redis = path.join(tools, "redis", redisHome, "redis-server.exe")
const data = path.join(root, ".data")
const pidFile = path.join(data, "services.json")
for (const dir of ["mongo", "redis", "logs"]) fs.mkdirSync(path.join(data, dir), { recursive: true })

const start = () => {
    const log = (name) => fs.openSync(path.join(data, "logs", name), "a")
    const mongo = spawn(mongod, ["--dbpath", path.join(data, "mongo"), "--port", "27117", "--bind_ip", "127.0.0.1", "--replSet", "rs0", "--wiredTigerCacheSizeGB", "1"], { detached: true, stdio: ["ignore", log("mongo.log"), log("mongo.log")] })
    const cache = spawn(redis, ["--port", "6479", "--bind", "127.0.0.1", "--save", "60", "1000", "--maxmemory-policy", "noeviction"], { cwd: path.join(data, "redis"), detached: true, stdio: ["ignore", log("redis.log"), log("redis.log")] })
    mongo.unref()
    cache.unref()
    fs.writeFileSync(pidFile, JSON.stringify({ mongo: mongo.pid, redis: cache.pid }))
    console.log(`mongod pid ${mongo.pid}, redis pid ${cache.pid}`)
}

const stop = () => {
    if (!fs.existsSync(pidFile)) return console.log("not running")
    const pids = JSON.parse(fs.readFileSync(pidFile, "utf8"))
    for (const pid of Object.values(pids)) spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" })
    fs.rmSync(pidFile)
    console.log("stopped")
}

if (process.argv[2] === "stop") stop()
else start()
