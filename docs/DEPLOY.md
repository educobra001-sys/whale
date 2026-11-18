# Deploying EduCobra on Vercel (free, no card)

Vercel serves the pages in `front-end/` and runs the API as a function (`api/index.js` → `src/serverless.ts`).
The database is on **MongoDB Atlas** and Redis on **Upstash**. Both are free and need no card.

## 1. MongoDB Atlas (database)
1. Create a free **M0** cluster in Frankfurt (AWS eu-central-1).
2. Database Access → add a user with a password made of letters and numbers only.
3. Network Access → add `0.0.0.0/0` (Vercel has no fixed address).
4. Connect → Drivers → copy the link: `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. Upstash (Redis)
1. upstash.com → Create Database → Redis, region **Frankfurt (eu-central-1)**, free plan.
2. Copy the link that starts with `rediss://` (the TCP one, not the REST URL).

## 3. Vercel
1. Add New → Project → import this GitHub repository. Leave every build setting as it is (`vercel.json` sets them).
2. Before pressing Deploy, open **Environment Variables** and add:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `TEST_MODE` | `true` (codes shown on screen until email is set up) |
| `DATABASE_URL` | the Atlas link |
| `DB_NAME` | `educobra` |
| `REDIS_URL` | the Upstash `rediss://` link |
| `ACCESS_SECRET` / `REFRESH_SECRET` | two different long random values |
| `CRON_SECRET` | another long random value |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | owner login, created on the first request (password 10+ characters) |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | same as your local `.env` (required: Vercel has no disk for uploads) |
| `PUBLIC_URL` | your Vercel link, once you know it (then redeploy) |

   Make a random value with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Deploy, then open `https://<your-link>/check-health`. The owner signs in at `/login.html?role=owner`.

Every push to `main` redeploys. After changing a variable, use Deployments → Redeploy.

## What works differently on Vercel
- **Messages** (WhatsApp API, Telegram) are sent right after the request instead of through the background queue.
- **Daily check** (`/cron/daily`, Vercel Cron): restarts WhatsApp batches that stopped and briefly connects linked numbers that have been quiet for 5 days, so WhatsApp keeps them linked.
- **Monthly invoices** are closed by Vercel Cron on the 1st of each month (`/cron/monthly`).
- **Uploads** are limited to 4 MB per file (Vercel's request limit). Use YouTube/Drive links for videos.
- **Daily backups** don't run; Atlas shows your data, and `npm run backup` with `DATABASE_URL` pointed at Atlas makes one from your PC.
- The first request after a quiet period takes a few seconds while the function starts.
- Meta webhook callback URL: `https://<your-link>/webhooks/whatsapp`.

## WhatsApp from a linked number (QR code)
Owner dashboard → **Messaging** → **Link WhatsApp**, then on the phone: WhatsApp → Linked devices → Link a device, and scan.
A teacher can have their own number: open the teacher in the owner dashboard → **Teacher's own WhatsApp**. Their messages then go out from it; teachers without one use the platform number.

How it works without a server that stays on:
- The WhatsApp login is stored in MongoDB (`whatsappauths`), not on disk, so every Vercel function can use it.
- A send connects, sends one message every *delay* seconds, and disconnects. When a batch is longer than one function may run (`maxDuration` 300 s in `vercel.json`), it hands the rest to a new call of `/internal/whatsapp/drain` (signed with `ACCESS_SECRET`).
- One Redis lock per number means only one connection to it exists at a time.
- If your Vercel plan allows less than 300 seconds, set `FUNCTION_SECONDS` to the same value as `maxDuration`.
- WhatsApp may block numbers that send a lot of unsolicited messages. Keep the delay at 10–20 seconds and message people who know you.

## Telegram bot
1. In Telegram, talk to **@BotFather** → `/newbot` → copy the token.
2. Owner dashboard → **Messaging** → **Telegram bot** → paste the token → **Connect bot**.
   On Vercel the server registers `https://<your-link>/webhooks/telegram` with Telegram by itself (set `PUBLIC_URL` first if you use your own domain).
3. Share the bot link (`https://t.me/<bot>`). Anyone who opens it gets a **Share my phone number** button; the number is matched with the students' and parents' phones and the chat is linked to every matching student. Linked chats are listed on the Messaging page.

## The Android app on the online server
Build it with the address baked in, so it opens straight on Vercel:
```
mobileuild-apk.bat https://<your-link>
```
The address is remembered in `mobile/server-url.txt` for the next build. Users can still pick another server from the sign-in screen.
