// Shows how phones on the same Wi-Fi reach this computer: the address, a QR code for the EduCobra app,
// and the page where friends download the app. Also opens the port in Windows Firewall when it can.
const os = require("node:os")
const { spawnSync } = require("node:child_process")
const QRCode = require("qrcode")

const port = Number(process.env.PORT) || 4000
const RULE = `EduCobra ${port}`

// Wi-Fi and Ethernet addresses, skipping virtual adapters (Hyper-V, WSL, VirtualBox, VPNs).
const addresses = () => {
    const found = []
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        if (/vEthernet|VirtualBox|VMware|WSL|Loopback|Hyper-V|tailscale|zerotier/i.test(name)) continue
        for (const item of list ?? []) {
            if (item.family !== "IPv4" || item.internal) continue
            if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) continue
            found.push({ name, address: item.address, wifi: /wi-?fi|wlan|wireless/i.test(name) })
        }
    }
    return found.sort((a, b) => Number(b.wifi) - Number(a.wifi))
}

const firewall = () => {
    if (process.platform !== "win32") return "skip"
    const exists = spawnSync("netsh", ["advfirewall", "firewall", "show", "rule", `name=${RULE}`], { encoding: "utf8" })
    if (exists.status === 0 && /Rule Name/i.test(exists.stdout)) return "ok"
    // Private networks only (home Wi-Fi), never public ones.
    const added = spawnSync("netsh", ["advfirewall", "firewall", "add", "rule", `name=${RULE}`, "dir=in", "action=allow", "protocol=TCP", `localport=${port}`, "profile=private"], { encoding: "utf8" })
    return added.status === 0 ? "added" : "denied"
}

const main = async () => {
    const list = addresses()
    console.log("")
    console.log("==================  EduCobra on your Wi-Fi  ==================")
    if (!list.length) {
        console.log("No Wi-Fi or network address found. Connect this computer to the Wi-Fi first.")
        return
    }
    const url = `http://${list[0].address}:${port}`
    console.log(`\n  Address for phones:   ${url}`)
    for (const other of list.slice(1)) console.log(`  (also: http://${other.address}:${port}  on ${other.name})`)
    console.log(`  Website on a phone:   ${url}`)
    console.log(`  Download the app:     ${url}/get-app.html`)
    console.log("\n  In the EduCobra app, tap \"Scan the QR code\" and scan this:\n")
    console.log(await QRCode.toString(url, { type: "terminal", small: true, errorCorrectionLevel: "M" }))
    const state = firewall()
    if (state === "added") console.log("  Windows Firewall: opened port " + port + " for private networks.")
    if (state === "denied") {
        console.log("  Windows Firewall: couldn't open the port automatically. If phones can't connect, run this once")
        console.log("  in a terminal opened with \"Run as administrator\":")
        console.log(`    netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow protocol=TCP localport=${port} profile=private`)
        console.log("  and make sure your Wi-Fi is set to \"Private network\" in Windows settings.")
    }
    console.log("\n  Phones must be on the same Wi-Fi as this computer. Close this window to stop the server.")
    console.log("==============================================================\n")
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
