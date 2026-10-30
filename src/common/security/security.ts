import bcrypt from "bcrypt"
import { env } from "../../config/env.service"

export const genertateHash = async ({ plainText, salt = env.salt }: {
    plainText: string
    salt?: number
}): Promise<string> => {
    return await bcrypt.hash(plainText, salt)
}

export const compareHash = async ({ plainText, cypherText }: {
    plainText: string
    cypherText: string
}): Promise<boolean> => {
    return await bcrypt.compare(plainText, cypherText)
}
