import { Router } from "express"
import { roleEnum } from "../../common/enum/user.enum"
import { BadRequestError } from "../../common/exceptions/error.exceptions"
import { send } from "../../common/exceptions/successresponce"
import { validation } from "../../common/service/validation"
import { auth, platformScope } from "../../middleware/auth.middleware"
import { rateLimit } from "../../middleware/security.middleware"
import authService from "./auth.service"
import * as schema from "./auth.validation"

const router: Router = Router()
const loginRoles = Object.values(roleEnum) as string[]

const roleParam = (req: any) => {
    if (!loginRoles.includes(req.params.role)) throw new BadRequestError("Unknown account type")
    return req.params.role as string
}

const signupLimit = rateLimit({ name: "signup", windowSeconds: 3600, max: 120 })
// Students of a whole center can share one address; guessing one account is stopped by the account lockout.
const loginLimit = rateLimit({ name: "login", windowSeconds: 300, max: 600 })
const otpLimit = rateLimit({ name: "otp", windowSeconds: 600, max: 15 })

router.use(platformScope)

router.post("/signup/teacher", signupLimit, validation(schema.teacherSignupSchema), send((req) => authService.teacherSignup(req.body), "Account created", 201))
router.post("/signup/student", signupLimit, validation(schema.studentSignupSchema), send((req) => authService.studentSignup(req.body), "Account created", 201))
router.post("/signup/center", signupLimit, validation(schema.centerSignupSchema), send((req) => authService.centerSignup(req.body), "Account created", 201))
router.post("/signup/parent", signupLimit, validation(schema.parentSignupSchema), send((req) => authService.parentSignup(req.body), "Account created", 201))

router.post("/login/:role", loginLimit, validation(schema.loginSchema), send((req) => authService.login(roleParam(req), req.body), "Signed in"))
router.post("/refresh-token", loginLimit, validation(schema.refreshTokenSchema), send((req) => authService.refreshToken(req.body.refreshToken), "Token refreshed"))

router.post("/verify-acc", otpLimit, validation(schema.verifySchema), send((req) => authService.teacherVerify(req.body), "Email verified"))
router.post("/resend-otp", otpLimit, validation(schema.identifierSchema), send((req) => authService.resendOtp(req.body), "Code sent"))
router.post("/forgot-password/:role", otpLimit, validation(schema.identifierSchema), send((req) => authService.forgotPassword(roleParam(req), req.body), "Code sent"))
router.post("/reset-password/:role", otpLimit, validation(schema.resetPasswordSchema), send((req) => authService.resetPassword(roleParam(req), req.body), "Password updated"))

router.patch("/:role/password", auth, validation(schema.changePasswordSchema), send((req) => {
    if (roleParam(req) !== req.actor.role) throw new BadRequestError("Unknown account type")
    return authService.changePassword(req.actor.role, req.actor.id, req.body)
}, "Password updated"))

export default router
