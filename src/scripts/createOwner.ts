import mongoose from "mongoose"
import { genertateHash } from "../common/security/security"
import { runAsPlatform } from "../common/service/tenantContext"
import { env } from "../config/env.service"
import { dbconnection } from "../db/connection"
import { repos } from "../db/repository"
import { seedFeatures } from "../module/owner/plan.service"

export const ensureOwner = () => runAsPlatform(async () => {
    if (await repos.owner.exists({ userName: env.ownerUserName })) return false
    if (!env.ownerPassword || !env.ownerEmail) throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD in .env")
    await repos.owner.create({
        name: "EduCobra Owner",
        userName: env.ownerUserName,
        email: env.ownerEmail,
        password: await genertateHash({ plainText: env.ownerPassword }),
    })
    return true
})

if (require.main === module) {
    dbconnection()
        .then(seedFeatures)
        .then(ensureOwner)
        .then((created) => console.log(created ? "owner created" : "owner already exists"))
        .then(() => mongoose.disconnect())
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
}
