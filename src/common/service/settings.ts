import { repos } from "../../db/repository"
import { redisService } from "./redisService"
import { runAsPlatform } from "./tenantContext"

export interface MessagingSettings {
    delaySeconds: number
    maxChars: number
    whatsappApi: { provider: "meta"; phoneNumberId: string; accessToken: string; enabled: boolean }
}

const DEFAULTS: { messaging: MessagingSettings } = {
    messaging: {
        delaySeconds: 15,
        maxChars: 1000,
        whatsappApi: { provider: "meta", phoneNumberId: "", accessToken: "", enabled: false },
    },
}

export const getMessagingSettings = () =>
    redisService.cached("settings:messaging", 30, () => runAsPlatform(async () => {
        const row = await repos.setting.findone({ filter: { _id: "messaging" } })
        const stored = row?.value ?? {}
        return {
            ...DEFAULTS.messaging,
            ...stored,
            whatsappApi: { ...DEFAULTS.messaging.whatsappApi, ...stored.whatsappApi },
        } as MessagingSettings
    }))

export const saveMessagingSettings = async (patch: Partial<MessagingSettings>) => {
    const current = await getMessagingSettings()
    const value = {
        ...current,
        ...patch,
        whatsappApi: { ...current.whatsappApi, ...patch.whatsappApi },
    }
    await runAsPlatform(() => repos.setting.updateone({ filter: { _id: "messaging" }, data: { $set: { value } }, options: { upsert: true } }))
    if (redisService.ready) await redisService.redis_delete({ key: "settings:messaging" })
    return value
}
