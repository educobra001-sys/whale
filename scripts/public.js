// Opens the local server to the internet for testing with friends, through a temporary Cloudflare tunnel.
// npm run public        start and print the link
// npm run public:stop   close the link and stop the server
const { spawn, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const data = path.join(root, ".data")
const pidFile = path.join(data, "public.json")
const urlFile = path.join(data, "public-url.txt")
const tunnelLog = path.join(data, "logs", "tunnel.log")
const tunnelTool = path.join(process.env.EDUCOBRA_TOOLS || "D:/dev/tools", "cloudflared.exe")
const port = 4000

const kill = (pid) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })

const stop = () => {
    if (fs.existsSync(pidFile)) {
        Object.values(JSON.parse(fs.readFileSync(pidFile, "utf8"))).forEach(kill)
        fs.rmSync(pidFile)
    }
    fs.rmSync(urlFile, { force: true })
    console.log("The public link is closed.")
}

const healthy = async () => {
    try {
        return (await fetch(`http://127.0.0.1:${port}/check-health`)).ok
    } catch {
        return false
    }
}

const wait = async (check, seconds, label) => {
    for (let i = 0; i < seconds; i += 1) {
        const value = await check()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error(`${label} didn't start in time`)
}

const start = async () => {
    stop()
    const log = (name) => fs.openSync(path.join(data, "logs", name), "a")
    const server = spawn(process.execPath, ["dist/main.js"], {
        cwd: root,
        detached: true,
        stdio: ["ignore", log("server.log"), log("server.log")],
        // Production mode hides error details. Test mode keeps verification codes on screen, as there's no email yet.
        env: { ...process.env, NODE_ENV: "production", TEST_MODE: "true" },
    })
    server.unref()
    await wait(healthy, 40, "The server")

    fs.rmSync(tunnelLog, { force: true })
    const tunnel = spawn(tunnelTool, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
        detached: true,
        stdio: ["ignore", log("tunnel.log"), log("tunnel.log")],
    })
    tunnel.unref()
    fs.writeFileSync(pidFile, JSON.stringify({ server: server.pid, tunnel: tunnel.pid }))
    const url = await wait(() => fs.readFileSync(tunnelLog, "utf8").match(/https:\/\/[\w-]+\.trycloudflare\.com/)?.[0], 40, "The tunnel")
    fs.writeFileSync(urlFile, url)
    console.log(`\nShare this link: ${url}\nAdmin panel: ${url}/login.html?role=owner\n\nIt works while this computer is on. A new link is made each time you start it.`)
}

if (process.argv[2] === "stop") stop()
else start().catch((error) => {
    console.error(error.message)
    process.exit(1)
})
