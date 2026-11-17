# EduCobra Android app (Flutter)

One app for every account type: student, parent, teacher, assistant, learning center and school / organization. It talks to the EduCobra server over its normal API, so the same accounts and rules apply as on the website.

## Try it on your Wi-Fi

1. On the computer: double-click `start-lan.bat` in the project folder. It starts the server and prints the address for phones (for example `http://192.168.1.20:4000`) with a QR code.
2. Build the app once: `mobile\build-apk.bat`. It copies the APK to `downloads\educobra.apk`.
3. On a phone on the same Wi-Fi: open `http://<that address>/get-app.html`, download and install the app (allow "install unknown apps").
4. In the app: **Scan the QR code** shown by `start-lan.bat`, or type the address. Then sign in.

If phones can't connect, Windows Firewall is usually the reason. Allow port 4000 on private networks (run once in an administrator terminal):

```
netsh advfirewall firewall add rule name="EduCobra 4000" dir=in action=allow protocol=TCP localport=4000 profile=private
```

and set the Wi-Fi to **Private network** in Windows settings. A friend who isn't on your Wi-Fi can use the temporary `https://….trycloudflare.com` link from `start-public.bat` instead.

## What's in it

- **Student**: door code and QR (kept on the phone for offline use), balance, points and rank, next group, last session, warnings, follow-up, announcements, recharge codes, transfer receipts, sessions, video lessons (unlock, view limits, resume where you stopped, questions with points), homework upload, exams, booklets, wallet, leaderboard, joining teachers. A new student can register from the app.
- **Parent**: each child with each teacher: balance, attendance, homework, exams, payments, warnings, call or WhatsApp the teacher. New parents can register.
- **Teacher and assistant**: dashboard, live scanning with the camera or typed code (attendance with cash, homework check, door check, "check in anyway" for low balance or blocked), students (search, add, balance, points, warnings, block, history, join requests), sessions (create, go live, close, report, remove a check-in), weekly schedule (add groups, start a session), lessons (show or hide), exams (create, enter scores), homework grading. Tabs follow the plan's sections and the assistant's permissions, like the website.
- **Center and school**: dashboard, teachers (accept requests, invite, remove), sessions and closings, weekly schedule. They never see student details.

### Offline

Every read screen shows the last copy saved on the phone when there's no connection (yellow bar). Staff phones keep a snapshot of the class, so scanning still works with no internet: check-ins are queued (cloud icon at the top) and sent automatically when the connection returns. The server records them at the time they were scanned, even if the session was closed in between, and never refuses money that was already collected.

## Developing

```
cd mobile
flutter run --dart-define=SERVER_URL=http://192.168.1.20:4000   # optional default address
flutter analyze
flutter test
```

A smaller download per phone type: `flutter build apk --release --split-per-abi` (most phones need the `arm64-v8a` file).

## Before publishing

This build is for testing: it allows plain `http` (see `android/app/src/main/res/xml/network_security_config.xml`) and is signed with this computer's debug key. To publish, put the server behind `https`, turn cleartext off, and sign with a real release key kept somewhere safe.
