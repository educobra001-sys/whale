# Deploying EduCobra (Vercel + Render + MongoDB Atlas)

- **Vercel** serves the pages in `front-end/` and forwards every other request (API, `/files`, `/webhooks/whatsapp`) to Render. People only ever use the Vercel link.
- **Render** runs the API, the background worker and Redis (`render.yaml`).
- **MongoDB Atlas** holds the database.

## 1. MongoDB Atlas (database)
1. Create a free **M0** cluster (any region near Frankfurt).
2. Database Access → add a user with a password (letters and numbers only, so the link doesn't need escaping).
3. Network Access → add `0.0.0.0/0`. Render's free plan has no fixed address.
4. Connect → Drivers → copy the link, like `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`.

## 2. Render (API)
1. Render → **New → Blueprint** → choose this GitHub repository. It reads `render.yaml`.
2. Keep the service name **educobra-api**. `vercel.json` forwards to `https://educobra-api.onrender.com`; if Render gives a different address, change it there.
3. Fill in the values it asks for:
   - `DATABASE_URL`: the Atlas link
   - `PUBLIC_URL` and `CORS_ORIGINS`: your Vercel link, e.g. `https://educobra.vercel.app`
   - `OWNER_EMAIL`, `OWNER_PASSWORD` (10+ characters): the owner account is created on first start
   - `CLOUDINARY_*`: same as in your local `.env` (uploads can't be stored on Render's disk)
   - `WHATSAPP_*`: can stay empty for now
4. Wait for the deploy, then open `https://educobra-api.onrender.com/check-health`.

## 3. Vercel (site)
Import the repository with the default settings; `vercel.json` already sets everything. Every push to `main` redeploys both Vercel and Render.

## Good to know
- Render's free plan sleeps after 15 minutes without visits. The first visit after that takes about a minute, and queued messages wait until it wakes.
- Free Redis on Render isn't saved to disk: a restart drops waiting jobs.
- WhatsApp Web (QR login) keeps its login on disk, which Render's free plan wipes on every deploy. Use the WhatsApp Cloud API there.
- The Android app download on `/get-app.html` isn't available online (the APK isn't in Git).
- Meta webhook callback URL: `https://<your-vercel-link>/webhooks/whatsapp`.
