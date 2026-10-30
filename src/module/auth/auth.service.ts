import crypto from "node:crypto"
import QRCode from "qrcode"
import { emailConfigured, otpEmail, sendEmail } from "../../common/email/sendemail"
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "../../common/exceptions/error.exceptions"
import { roleEnum } from "../../common/enum/user.enum"
import { compareHash, genertateHash } from "../../common/security/security"
import { forgetActor, getActor } from "../../common/service/actorService"
import { nameKey, normalizePhone } from "../../common/service/helpers"
import { redisService } from "../../common/service/redisService"
import { duplicateStudentError, findExistingStudent, nextStudentId } from "../../common/service/registry"
import { TokenService } from "../../common/service/token"
import { env } from "../../config/env.service"
import { repos } from "../../db/repository"

const OTP_TTL = 60 * 10
const MAX_OTP_TRIES = 5
const MAX_LOGIN_FAILURES = 8
const LOCK_SECONDS = 60 * 15

const lookups: Record<string, { repo: any; fields: string[] }> = {
    owner: { repo: repos.owner, fields: ["email", "userName"] },
    teacher: { repo: repos.teacher, fields: ["email", "phone", "userName"] },
    assistant: { repo: repos.assistant, fields: ["email", "phone", "userName"] },
    center: { repo: repos.center, fields: ["phone", "name"] },
    student: { repo: repos.student, fields: ["phone", "userID"] },
    parent: { repo: repos.parent, fields: ["phone"] },
}

class AuthService {
    private tokenService = new TokenService()

    private findAccount(role: string, identifier: string) {
        const lookup = lookups[role]
        if (!lookup) throw new NotFoundError("Unknown account type")
        const values = [identifier, identifier.toLowerCase(), normalizePhone(identifier)].filter(Boolean)
        return lookup.repo.findone({ filter: { $or: lookup.fields.map((field) => ({ [field]: { $in: values } })) } })
    }

    private async issueOtp(scope: string, email: string, purpose: string) {
        const code = crypto.randomInt(100000, 1000000).toString()
        await redisService.set({ key: `otp:${scope}`, value: await genertateHash({ plainText: code }), ttl: OTP_TTL })
        await redisService.redis_delete({ key: `otp-tries:${scope}` })
        try {
            await sendEmail({ to: email, subject: `Your ${env.appName} code`, html: otpEmail(code, purpose) })
        } catch {
            throw new BadRequestError("We couldn't send the email. Please try again.")
        }
        if (!emailConfigured()) console.log(`[otp ${scope}] ${code}`)
        // Offline testing only: without SMTP there is no inbox, so the code comes back to the screen.
        return env.isDev && !emailConfigured() ? code : undefined
    }

    private async checkOtp(scope: string, otp: string) {
        const tries = await redisService.hit(`otp-tries:${scope}`, OTP_TTL)
        if (tries > MAX_OTP_TRIES) throw new TooManyRequestsError("Too many wrong codes. Ask for a new one.")
        const hashed = await redisService.get({ key: `otp:${scope}` })
        if (!hashed) throw new BadRequestError("This code expired. Ask for a new one.")
        if (!(await compareHash({ plainText: otp, cypherText: hashed }))) throw new BadRequestError("That code isn't correct")
        await redisService.redis_delete({ key: [`otp:${scope}`, `otp-tries:${scope}`] })
    }

    async teacherSignup(data: any) {
        data.phone = normalizePhone(data.phone)
        const existing = await repos.teacher.findone({
            filter: {
                $or: [
                    { email: data.email },
                    { phone: data.phone },
                    { userName: data.userName },
                    ...(data.companyName ? [{ companyName: data.companyName }] : []),
                ],
            },
        })
        if (existing) {
            if (existing.email === data.email) throw new ConflictError("Email already registered")
            if (existing.phone === data.phone) throw new ConflictError("Phone number already registered")
            if (existing.userName === data.userName) throw new ConflictError("Username already taken")
            throw new ConflictError("Company name already taken")
        }
        const password = await genertateHash({ plainText: data.password })
        const teacher = await repos.teacher.create({ ...data, password, status: "pending_email" })
        const devCode = await this.issueOtp(`teacher:${teacher._id}`, teacher.email, "Use this code to verify your teacher account.")
        return { email: teacher.email, status: teacher.status, devCode }
    }

    async resendOtp({ identifier }: { identifier: string }) {
        const teacher = await this.findAccount("teacher", identifier)
        if (!teacher || teacher.confirmEmail) return { sent: true }
        const devCode = await this.issueOtp(`teacher:${teacher._id}`, teacher.email, "Use this code to verify your teacher account.")
        return { sent: true, devCode }
    }

    async teacherVerify({ identifier, otp }: { identifier: string; otp: string }) {
        const teacher = await this.findAccount("teacher", identifier)
        if (!teacher) throw new NotFoundError("Teacher account not found")
        if (teacher.confirmEmail) throw new BadRequestError("This email is already verified")
        await this.checkOtp(`teacher:${teacher._id}`, otp)
        await repos.teacher.updateone({
            filter: { _id: teacher._id },
            data: { $set: { confirmEmail: true, status: "pending_approval" } },
        })
        return { status: "pending_approval" }
    }

    async studentSignup(data: any) {
        data.phone = normalizePhone(data.phone)
        data.parentPhone = normalizePhone(data.parentPhone)
        const existing = await findExistingStudent(data)
        if (existing) throw duplicateStudentError(existing)
        const userID = await nextStudentId()
        const password = await genertateHash({ plainText: data.password })
        await repos.student.create({ ...data, password, userID, nameKey: nameKey(data.firstName, data.lastName) })
        const qrCode = await QRCode.toDataURL(userID, { errorCorrectionLevel: "M", margin: 2 })
        return { userID, qrCode }
    }

    async centerSignup(data: any) {
        data.phone = normalizePhone(data.phone)
        const existing = await repos.center.findone({ filter: { $or: [{ phone: data.phone }, { name: data.name }] } })
        if (existing) throw new ConflictError(existing.phone === data.phone ? "Phone number already registered" : "This center name is taken")
        const password = await genertateHash({ plainText: data.password })
        const center = await repos.center.create({ ...data, password, status: "pending_approval" })
        return { name: center.name, status: center.status }
    }

    async parentSignup({ name, phone, childCode, password }: any) {
        const normalized = normalizePhone(phone)
        if (await repos.parent.exists({ phone: normalized })) throw new ConflictError("Phone number already registered")
        const child = await repos.student.findone({ filter: { userID: childCode.toUpperCase() } })
        if (!child) throw new NotFoundError("No student has that code")
        if (normalizePhone(child.parentPhone) !== normalized) throw new ForbiddenError("This phone number isn't the parent phone of that student")
        await repos.parent.create({ name, phone: normalized, password: await genertateHash({ plainText: password }), children: [child._id] })
        return { phone: normalized }
    }

    private statusCheck(role: string, account: any) {
        if (role === "teacher") {
            const messages: Record<string, string> = {
                pending_email: "Verify your email first.",
                pending_approval: "Your account is being reviewed by the EduCobra team. You'll be able to sign in once it's approved.",
                rejected: `Your account wasn't approved.${account.statusNote ? ` ${account.statusNote}` : ""}`,
                suspended: "This account is suspended. Contact EduCobra.",
            }
            if (messages[account.status]) throw new ForbiddenError(messages[account.status], { code: account.status.toUpperCase() })
        }
        if (role === "center" && account.status !== "active") {
            throw new ForbiddenError(account.status === "pending_approval"
                ? "Your center is being reviewed by the EduCobra team."
                : "This center account isn't active.", { code: account.status.toUpperCase() })
        }
    }

    async login(role: string, { identifier, password }: { identifier: string; password: string }) {
        const lockKey = `login-fail:${role}:${identifier.toLowerCase()}`
        const failures = Number(await redisService.get({ key: lockKey }).catch(() => 0))
        if (failures >= MAX_LOGIN_FAILURES) throw new TooManyRequestsError("Too many failed attempts. Try again in 15 minutes.")
        const account = await this.findAccount(role, identifier)
        const matched = account?.password ? await compareHash({ plainText: password, cypherText: account.password }) : false
        if (!matched) {
            await redisService.hit(lockKey, LOCK_SECONDS).catch(() => undefined)
            throw new UnauthorizedError("Incorrect sign-in details")
        }
        this.statusCheck(role, account)
        await redisService.redis_delete({ key: lockKey }).catch(() => undefined)
        if (role === "assistant") {
            const teacher = await repos.teacher.findById({ id: account.teacher, select: "status" })
            if (teacher?.status !== "active") throw new ForbiddenError("Your teacher's account isn't active.")
        }
        return this.tokenService.generateToken(account, role as roleEnum)
    }

    async refreshToken(refreshToken: string) {
        const user = this.tokenService.decodeRefreshToken(refreshToken)
        const actor = await getActor(user.role, user.id)
        if (!actor || actor.tv !== user.tv) throw new UnauthorizedError()
        return this.tokenService.accessFromRefresh(user)
    }

    private recoveryEmail(role: string, account: any) {
        return account?.email as string | undefined
    }

    async forgotPassword(role: string, { identifier }: { identifier: string }) {
        const account = await this.findAccount(role, identifier)
        const email = this.recoveryEmail(role, account)
        if (!account) return { sent: true }
        if (!email) {
            if (env.isDev) return { sent: true, devCode: await this.issueResetWithoutEmail(role, account) }
            return { sent: true }
        }
        const devCode = await this.issueOtp(`reset:${role}:${account._id}`, email, "Use this code to reset your password.")
        return { sent: true, devCode }
    }

    private async issueResetWithoutEmail(role: string, account: any) {
        const code = crypto.randomInt(100000, 1000000).toString()
        await redisService.set({ key: `otp:reset:${role}:${account._id}`, value: await genertateHash({ plainText: code }), ttl: OTP_TTL })
        console.log(`[otp reset:${role}:${account._id}] ${code}`)
        return code
    }

    async resetPassword(role: string, { identifier, otp, password }: any) {
        const account = await this.findAccount(role, identifier)
        if (!account) throw new BadRequestError("That code isn't correct")
        await this.checkOtp(`reset:${role}:${account._id}`, otp)
        await lookups[role]!.repo.updateone({
            filter: { _id: account._id },
            data: { $set: { password: await genertateHash({ plainText: password }) }, $inc: { tokenVersion: 1 } },
        })
        await forgetActor(role, String(account._id))
        return { updated: true }
    }

    async changePassword(role: string, id: string, { currentPassword, newPassword }: any) {
        const lookup = lookups[role]!
        const account = await lookup.repo.findById({ id })
        if (!account) throw new NotFoundError("Account not found")
        if (!(await compareHash({ plainText: currentPassword, cypherText: account.password }))) {
            throw new BadRequestError("Your current password isn't correct")
        }
        await lookup.repo.updateone({
            filter: { _id: id },
            data: { $set: { password: await genertateHash({ plainText: newPassword }) }, $inc: { tokenVersion: 1 } },
        })
        await forgetActor(role, id)
        return { updated: true }
    }
}

export default new AuthService()
