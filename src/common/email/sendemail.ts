import nodemailer from "nodemailer"
import { env } from "../../config/env.service"

const transporter = env.smtpHost
    ? nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth: { user: env.smtpUser, pass: env.smtpPass },
    })
    : null

export const emailConfigured = () => Boolean(transporter)

export const sendEmail = async ({ to, subject, html }: { to: string; subject: string; html: string }) => {
    if (!transporter) {
        console.log(`[mail to ${to}] ${subject}`)
        return
    }
    await transporter.sendMail({ from: env.mailFrom, to, subject, html })
}

export const otpEmail = (code: string, purpose: string) => `<!DOCTYPE html>
<html><body style="margin:0;padding:40px 10px;background:#f4f6f8;font-family:Arial,sans-serif">
<table role="presentation" width="100%" style="max-width:500px;margin:auto;background:#fff;border-radius:12px;padding:30px;text-align:center">
<tr><td><h2 style="margin:0 0 16px;color:#1a1a1a">${env.appName}</h2>
<p style="color:#555;font-size:15px">${purpose} This code is valid for <strong>10 minutes</strong>.</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px;color:#b45309;margin:24px 0">${code}</p>
<p style="color:#888;font-size:13px">If you didn't request this code, you can safely ignore this email.</p>
</td></tr></table></body></html>`
