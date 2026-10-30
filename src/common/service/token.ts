import jwt, { JwtPayload } from "jsonwebtoken"
import { env } from "../../config/env.service"
import { UnauthorizedError } from "../exceptions/error.exceptions"
import { roleEnum } from "../enum/user.enum"

export interface TokenUser {
    id: string
    role: roleEnum
    tv: number
}

export class TokenService {
    generateToken(user: { _id: unknown; tokenVersion?: number }, role: roleEnum) {
        const payload = { id: String(user._id), role, tv: user.tokenVersion ?? 0 }
        const accessToken = jwt.sign(payload, env.access_secret, { audience: "access", expiresIn: "30m" })
        const refreshToken = jwt.sign(payload, env.refresh_secret, { audience: "refresh", expiresIn: "60d" })
        return { accessToken, refreshToken }
    }

    decodeToken(token: string): TokenUser {
        try {
            const data = jwt.verify(token, env.access_secret, { audience: "access" }) as JwtPayload
            return { id: data.id, role: data.role, tv: data.tv ?? 0 }
        } catch {
            throw new UnauthorizedError()
        }
    }

    decodeRefreshToken(refreshToken: string): TokenUser {
        try {
            const data = jwt.verify(refreshToken, env.refresh_secret, { audience: "refresh" }) as JwtPayload
            return { id: data.id, role: data.role, tv: data.tv ?? 0 }
        } catch {
            throw new UnauthorizedError("Invalid or expired refresh token")
        }
    }

    accessFromRefresh(user: TokenUser) {
        const accessToken = jwt.sign({ id: user.id, role: user.role, tv: user.tv }, env.access_secret, { audience: "access", expiresIn: "30m" })
        return { accessToken }
    }
}
