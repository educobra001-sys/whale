# Deploying EduCobra (Vercel + Render + MongoDB Atlas + Upstash)

All four have free plans that need no card.

- **Vercel** serves the pages in `front-end/` and forwards every other request (API, `/files`, `/webhooks/whatsapp`) to Render. People only ever use the Vercel link.
- **Render** runs the API and the background worker.
- **MongoDB Atlas** holds the database. **Upstash** provides Redis.

## 1. MongoDB Atlas (database)
1. Create a free **M0** cluster (region near Frankfurt).
2. Database Access → add a user with a password made of letters and numbers only.
3. Network Access → add `0.0.0.0/0` (Render's free plan has no fixed address).
4. Connect → Drivers → copy the link: `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

## 2. Upstash (Redis)
1. upstash.com → Create Database → Redis, region **Frankfurt (eu-central-1)**, free plan.
2. Turn **Eviction off** (queued messages must never be dropped).
3. Copy the connection link that starts with `rediss://` (the "TCP" / node-redis one, not the REST URL).

## 3. Render (API): create it by hand, not as a Blueprint
1. Render → **New → Web Service** → connect GitHub → pick this repository.
2. Settings:
   - Name: **educobra-api** (the address becomes `https://educobra-api.onrender.com`)
   - Region: Frankfurt · Branch: `main` · Runtime: Node · Instance type: **Free**
   - Build command: `npm ci --include=dev && npm run build`
   - Start command: `npm start`
   - Health check path (Advanced): `/check-health`
3. Environment variables:

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `TEST_MODE` | `true` (codes shown on screen until email is set up) |
| `TRUST_PROXY` | `2` |
| `DATABASE_URL` | the Atlas link |
| `DB_NAME` | `educobra` |
| `REDIS_URL` | the Upstash `rediss://` link |
| `ACCESS_SECRET` | a long random value (see below) |
| `REFRESH_SECRET` | a different long random value |
| `PUBLIC_URL` | your Vercel link, e.g. `https://educobra.vercel.app` |
| `CORS_ORIGINS` | the same Vercel link |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | owner login, created on first start (password 10+ characters) |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | same as your local `.env` |

   Make each secret with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
4. Create the service, wait for the deploy, then open `https://educobra-api.onrender.com/check-health`.

If Render gives a different address, put it in the `destination` in `vercel.json`.

## 4. Vercel (site)
Import the repository with the default settings; `vercel.json` already sets everything. Every push to `main` redeploys both Vercel and Render.

## Good to know
- Render's free plan sleeps after 15 minutes without visits. The first visit after that takes about a minute, and queued messages wait until it wakes.
- Upstash free has a monthly limit of Redis commands. The worker is tuned to use few while idle, and the Upstash dashboard shows the usage.
- WhatsApp Web (QR login) keeps its login on disk, which Render's free plan wipes on every deploy. Use the WhatsApp Cloud API there.
- The Android app download on `/get-app.html` isn't available online (the APK isn't in Git).
- Meta webhook callback URL: `https://<your-vercel-link>/webhooks/whatsapp`.
