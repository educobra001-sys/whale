import { TooManyRequestsError } from "../exceptions/error.exceptions"
import { clearCounters, hitCounter, readCounter } from "./counter"

// Failed sign-ins only (a correct one never counts). For each account: 10 wrong tries from one device,
// or 50 from anywhere, in 15 minutes. A stranger guessing from their own device therefore can't lock
// the real owner out, while a spread-out attack still hits the account-wide cap.
const WINDOW_SECONDS = 15 * 60
const PER_DEVICE = 10
const PER_ACCOUNT = 50

const keysFor = (scope: string, identifier: string, ip: string) => {
    const id = String(identifier ?? "").trim().toLowerCase().slice(0, 120)
    return [
        { key: `login-fail:${scope}:${id}:${ip || "-"}`, limit: PER_DEVICE },
        { key: `login-fail:${scope}:${id}`, limit: PER_ACCOUNT },
    ]
}

export const assertLoginAllowed = async (scope: string, identifier: string, ip: string) => {
    let wait = 0
    for (const { key, limit } of keysFor(scope, identifier, ip)) {
        const { count, secondsLeft } = await readCounter(key)
        if (count >= limit) wait = Math.max(wait, secondsLeft)
    }
    if (wait) {
        const minutes = Math.max(1, Math.ceil(wait / 60))
        throw new TooManyRequestsError(`Too many failed attempts. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`, { retryAfter: wait })
    }
}

export const recordLoginFailure = async (scope: string, identifier: string, ip: string) => {
    for (const { key } of keysFor(scope, identifier, ip)) await hitCounter(key, WINDOW_SECONDS)
}

export const clearLoginFailures = async (scope: string, identifier: string, ip: string) => {
    await clearCounters(keysFor(scope, identifier, ip).map(({ key }) => key))
}
