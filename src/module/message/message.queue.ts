import { Queue } from "bullmq"
import { env } from "../../config/env.service"

// Plain options rather than a shared client: BullMQ then closes the connection itself.
export const queueConnection = () => ({ url: env.redis_url, maxRetriesPerRequest: null })

export const FAST_QUEUE = "messages-fast"
export const BILLING_QUEUE = "billing"

const jobDefaults = {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
}

let fast: Queue | null = null

export const fastQueue = () => (fast ??= new Queue(FAST_QUEUE, { connection: queueConnection() as any, defaultJobOptions: jobDefaults }))

export const closeQueues = async () => {
    await fast?.close()
    fast = null
}
