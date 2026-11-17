# What's new: security, schools, mobile app, local hosting

## Phones on your Wi-Fi and the mobile app

Run `start-lan.bat`. It starts everything and prints the address phones use (for example `http://192.168.1.20:4000`) with a QR code. The website works on phones at that address, and `/get-app.html` offers the Android app once `mobile\build-apk.bat` has built it. See `mobile/README.md`.

If phones can't connect, allow port 4000 in Windows Firewall for private networks (`start-lan.bat` tries to do this and prints the command if it can't) and set the Wi-Fi to "Private network".

## Schools and organizations

A school or organization account works exactly like a learning center: it signs up at `login.html?role=school` (or the owner creates it under **Schools & organizations**), waits for the owner's approval, links with teachers when both sides agree, and sees their groups, sessions and closings at its place but never student details. Both kinds live in the `Center` collection with `kind: "center" | "school"` (old documents without `kind` are centers). The routes are `/center/*` and `/school/*`, and a school token can't open a center account or the reverse. Teachers find both on their **Centers & schools** page, and schools show as "(school)" in place dropdowns.

Test account from `npm run seed`: `Cairo Language School / School@123`.

## Backups

`npm run backup` writes `backups/educobra-<time>.jsonl.gz`. It streams every collection and gzips while writing, so memory stays flat. `BACKUP_DAILY=true` runs one at 03:00 Cairo time, and the newest `BACKUP_KEEP` files are kept. Restore with `npm run restore -- <file> --confirm`, which replaces the data in `DB_NAME`.

## Security

- Failed sign-ins are limited per account: 10 from one device, or 50 from anywhere, in 15 minutes. A stranger can't lock the real owner out. Unknown accounts take as long to refuse as wrong passwords. Change-password is limited the same way.
- Rate limits and the sign-in limiter fall back to memory if Redis is down, instead of switching off.
- Uploads must really be the type they claim (the first bytes are checked). Uploaded files are served with a sandbox policy, so they can never run scripts on the site.
- Links (photos, map links, homework links, receipts, lesson videos) must be `https://` or our own `/files/…`, so a `javascript:` link can't be saved. Names can't contain HTML.
- On startup, weak or placeholder secrets and owner passwords are reported; in production they stop the server.

## Fixes brought over from the Studyisfunny system

- **Offline check-ins are honoured.** A check-in a device accepted offline is recorded at its scan time, even if the session closed since, with a "Recorded offline" note; the cash collected is never refused.
- **Sessions don't start twice.** Starting a group from the schedule twice (double tap, refresh, retry) returns the same session.
- **Lessons never resume at the end.** The server sends a resume point per part (0 when finished), and the player only seeks inside the video.
