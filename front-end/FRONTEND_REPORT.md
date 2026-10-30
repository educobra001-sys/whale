# Learning Center — Front-end report for the backend

This document explains what the new front-end does, how it talks to the backend, and **exactly what the backend needs to provide**. The front-end is finished and works today in two modes:

- **Real mode**: calls the Express API (same origin, or `http://127.0.0.1:3000` when opened from VS Code Live Server on port 5500).
- **Demo mode**: the "Try the demo account" button on every sign-in page runs an in-browser fake backend (`assets/js/mock/`) with sample data. Use it to see every screen before the endpoints exist.

> **The contract in two files**
> - `front-end/assets/js/core/api.js` — every endpoint the UI calls (method, path, body). Endpoints that already exist are marked `// existing`.
> - `front-end/assets/js/mock/server.js` — a working implementation of every endpoint against fake data. It's the reference for **response shapes and business rules**. When this report and the mock disagree, trust the mock.

---

## 1. What was built

The old single-teacher system (`/student-tracking-system`, about 200 routes) was rebuilt as a multi-tenant front-end with the new amber/cream theme. It has dark mode, a phone layout and no build step: plain HTML plus ES modules.

| Portal | Pages |
|---|---|
| **Teacher** | Dashboard · Students (class list, join requests, removed/restore, CSV import/export, QR cards) · Student profile (balance, points, warnings/block, attendance, exams, homework, payments, booklets, lessons) · Sessions · Session report (present/absent, homework, payments, assistants check-in/out, center closing, exports) · **Live scan** (attendance, homework check, door check; camera QR, USB scanner, offline queue) · Weekly schedule · Video lessons (parts, pop-up questions, access rules, grants, essay grading) · Online homework (+grading) · Exams (+score sheet) · Booklets (catalogue, orders, deliveries) · Follow-up (call lists, notes, assign to assistants) · Announcements · Leaderboard · Wallet (transfer receipts, recharge codes, transactions) · Finance (income, expenses, closings, salaries) · Assistants (permissions, salary, work stats) · Learning centers (link requests) · Account |
| **Assistant** | The same teacher pages, filtered by the permissions the teacher grants · My work (check-ins, salary estimate) · My account |
| **Learning center** | Dashboard · Teachers (requests, invitations, groups) · Combined weekly schedule · Sessions & closings · Account |
| **Student** | Home (QR ID card, wallet, rank, next session, announcements) · Teachers (subscribed, plus a directory of other teachers shown as **"Not subscribed"** with a "Request to join" button) · Sessions · Video lessons + player · Homework (upload) · Exams · Booklets (reserve) · Wallet (recharge code, transfer receipt) · Leaderboard · Profile |
| **Parent** | Follow-up report per child and per teacher (attendance, exams chart, payments, warnings, assistant contact) · My children (link by student code) |

### Files

```
front-end/
  index.html            landing page (5 portals)
  login.html            one sign-in/register page for all roles: login.html?role=teacher|student|center|assistant|parent
  app.html              the authenticated app shell (hash routes, e.g. app.html#/students/ID)
  style.css             original theme (landing + login)
  FRONTEND_REPORT.md    this file
  assets/css/app.css    app design system (light + dark)
  assets/js/core/       config, session (tokens/refresh), api (contract), ui toolkit, routes, fallbacks
  assets/js/views/      one module per page: teacher/ center/ student/ parent/ shared/
  assets/js/mock/       demo backend (seed.js + server.js)
  teacherlogin.html, studentlogin.html, centerlogin.html, teacher.html, students.html,
  sessions.html, attendance.html   → small redirects to the new pages (old links keep working)
```

The old scripts (`auth.js`, `role-auth.js`, `auth-session.js`, `teacher.js`, `students.js`, `sessions.js`, `attendance.js`, `center.js`, `student.js`, `sessions.css`) were removed. They're still in git history.

---

## 2. Who can see what (the access model the backend must enforce)

The front-end only *hides* things. **Every rule below must be enforced on the server.**

| Account | Can see / do |
|---|---|
| **Center** | Its **linked teachers** (status `active`), their groups held at this center, and sessions held at this center with attendance **counts** and closing totals. **No student personal data.** |
| **Teacher** | Their own students (enrollments), assistants, linked centers, and everything they create (sessions, lessons, exams, …). Never another teacher's data. |
| **Assistant** | Their teacher's data **only**, limited by `permissions`. An assistant with `role: "Admin"` has every teaching permission but still can't manage assistants, centers or the teacher's account. |
| **Student** | Their own record with every teacher they're **subscribed** to (`active` enrollment). A public teacher directory where non-subscribed teachers show as "Not subscribed" (public profile fields only). |
| **Parent** | Only children linked to them (child's `parentPhone` must match the parent's phone). |

### Key new relationship: Enrollment (teacher ↔ student)

A student can belong to many teachers, so money and discipline are **per teacher**. Replace `Teacher.students[]` + `Student.balance` with an **Enrollment** collection:

```
Enrollment { teacher, student, status: "pending" | "active", archived: bool, removedAt, removedReason,
             balance, points, isBlocked, pricePerSession, center (home center), adminNote,
             followUpAssistant, joinedAt }
```

- Student "Request to join" creates a `pending` enrollment. The teacher accepts (→ `active`) or rejects (deleted).
- "Remove from class" sets `archived: true` (keeps history). "Restore" clears it.
- `GET /teacher/myStudents` returns **student fields merged with enrollment fields** (see §5).

### Teacher ↔ Center link

```
CenterLink { teacher, center, status: "pending" | "active" | "rejected", requestedBy: "teacher" | "center", createdAt }
```
Either side can request; the **other** side answers. If both sides request, it becomes `active`.

---

## 3. Cross-cutting requirements (do these first)

1. **Put the account type in the JWT.** Today `generateToken` switches on `user.role`, so teachers and students both get the `Admin` audience and any valid token passes `auth`. Add `role: "teacher" | "assistant" | "center" | "student" | "parent"` to the payload and add a `requireRole([...])` middleware on every router.
2. **Assistant tokens use the `/teacher/*` routes.** The front-end calls the same `/teacher/...` endpoints for assistants. Middleware: if `role === "assistant"`, load the assistant, set `req.teacherId = assistant.teacher`, and check the route's permission (keys in `assets/js/core/config.js → PERMISSIONS`). Teacher-only routes: `/teacher/assistants*` (writes), `/teacher/centers*`, `/teacher/profile` (writes/delete).
3. **Return 401 for expired or invalid access tokens** (currently 400 `"session time expired"` / `"invalid token1"`). The front-end handles both, but 401 is correct.
4. **Envelope stays `{ message, data }`.** For errors the UI reads `message` and, for special cases, `cause.code`:
   - `409` with `cause: { code: "INSUFFICIENT_BALANCE", balance, price }` → UI offers "Check in anyway" (`force: true`).
   - `403` with `cause: { code: "BLOCKED" }` → same.
5. **Don't send `stack`/`err` in error responses** in production (`globalErrorHandling`).
6. **File uploads:** `POST /uploads` (multipart field `file`) → `{ url }`. Used for profile photos, lesson videos, homework photos/PDFs, receipts, announcement images. The S3 service already exists.
7. **IDs:** any string works, and the UI treats them as opaque. Student codes stay `STU-000123` (already generated in `studentSignup`).
8. **Dates:** ISO strings. Money: plain numbers (shown as EGP).

---

## 4. Bugs found in the current backend

| Where | Problem | Fix |
|---|---|---|
| `teacher.controller.ts` `GET /assistants` | `getTeacherId(req.user.id)` passes a string, so it always throws "Invalid authenticated user". It also populates `assistants`, which doesn't exist on the Teacher schema. | `getTeacherId(req)`; query `assistantModel.find({ teacher: teacherId })` |
| `auth.service.ts` `teacherSignup` | `existingTeacher.email === email` compares against the **zod `email` import**, so a duplicate email falls through to a Mongo duplicate-key 500. | compare with `data.email` |
| `auth.service.ts` `teacherVerify` | crashes when no teacher matches (`teacherData.confirmEmail` on null). | 404 when not found |
| All models `createdAt: { default: Date.now() }` | evaluated **once** at startup, so every document gets the server start time. | `default: Date.now` (or rely on `timestamps`) |
| `teacher.companyName` `unique: true` | the second teacher **without** a company name fails (duplicate `null`). | `unique: true, sparse: true` |
| `PATCH /teacher/myStudents/:id` | passes raw `req.body` to `findByIdAndUpdate`, so a teacher can overwrite `password`, `balance`, `userID`… | whitelist fields with zod (see §5) |
| `updateTeacherProfileSchema` (`.strict()`) | rejects the new `bio` field (shown in the teacher directory). | add `bio: z.string().max(600).optional()` |
| `addTeacherAssistantSchema` (`.strict()`) | rejects `role`/`permissions`. The UI works around it by calling `PATCH /teacher/assistants/:id` right after creating. | accept them on create too |

---

## 5. Endpoints

Legend: ✅ exists · 🆕 new · ✏️ exists but needs changes. Priority: **P1** core daily use · **P2** important · **P3** nice to have.
Full request bodies and response objects are in `api.js` (calls) and `mock/server.js` (responses).

### Auth (public)
| | Method & path | Notes | P |
|---|---|---|---|
| ✅ | `POST /signup/teacher` `/signup/student` `/signup/center` | student returns `{ userID, qrCode }` (already) | P1 |
| 🆕 | `POST /signup/parent` `{ name, phone, password, childCode }` | child's `parentPhone` must equal `phone` | P2 |
| ✏️ | `POST /login/:role` → `{ accessToken, refreshToken }` | add `assistant` and `parent`; include role in token | P1 |
| ✅ | `POST /refresh-token`, `POST /verify-acc` | | P1 |
| 🆕 | `POST /resend-otp` `{ identifier }` | teacher email OTP | P2 |
| 🆕 | `POST /forgot-password/:role` `{ identifier }` → sends code; `POST /reset-password/:role` `{ identifier, otp, password }` | | P3 |
| 🆕 | `PATCH /:role/password` `{ currentPassword, newPassword }` | all roles | P2 |
| 🆕 | `POST /uploads` (multipart `file`) → `{ url }` | | P1 |

### Public directory (any signed-in user)
| | Method & path | Returns | P |
|---|---|---|---|
| 🆕 | `GET /teachers/search?q&subject` | public teacher fields + `studentsCount`, `centers: [names]` | P1 |
| 🆕 | `GET /teachers/:id` | + `centers: [Center]`, `schedule: [Slot]` | P2 |
| 🆕 | `GET /centers/search?q` | `[Center]` | P2 |

### Teacher (and assistants with permission)
**Profile & dashboard**
| | Method & path | P |
|---|---|---|
| ✏️ | `GET/PATCH/DELETE /teacher/profile` (add `bio`, `profilepic` via `/uploads`) | P1 |
| 🆕 | `GET /teacher/dashboard` → `{ counts{students, assistants, centers, pendingRequests, pendingTopups, pendingSubmissions, lowBalance, blocked}, totalBalance, activeSession, todaySlots, attendanceTrend[{label,value}], byCenter, byGrade, lowBalanceStudents, recent[] }` | P2 |

**Students** (`Student` in responses = student fields **+** `balance, points, isBlocked, pricePerSession, center, centerName, adminNote, followUpAssistant, followUpAssistantName, warningsCount, joinedAt, lastAttendedAt`)
| | Method & path | Body / notes | P |
|---|---|---|---|
| ✏️ | `GET /teacher/myStudents` · `GET /teacher/myStudents/:id` | read from Enrollment, return merged fields | P1 |
| ✏️ | `PATCH /teacher/myStudents/:id` | student fields `firstName,lastName,phone,parentPhone,gender,grade,schoolName,learningLanguage` + enrollment fields `pricePerSession,center,adminNote,followUpAssistant`. **Validate.** | P1 |
| 🆕 | `POST /teacher/myStudents` | create the student account and enroll it. Body: student fields + `pricePerSession, center, balance`. Returns `{ student, userID, password }` (generate a temporary password) | P1 |
| 🆕 | `POST /teacher/myStudents/link` `{ identifier (code or phone), center, pricePerSession }` | enroll an existing account | P1 |
| 🆕 | `POST /teacher/myStudents/import` `{ students: [...] }` → `{ created:[{name,userID,password}], skipped:[{row,reason}] }` | P2 |
| 🆕 | `DELETE /teacher/myStudents/:id` `{ reason }` | archive the enrollment | P2 |
| 🆕 | `GET /teacher/myStudents/:id/history` → `{ attendance[], exams[], homework[], transactions[], warnings[], points[], booklets[], lessons[], stats{present,absent,attendanceRate,homeworkRate,examAvg} }` | P1 |
| 🆕 | `POST /teacher/myStudents/:id/balance` `{ amount (±), reason }` | writes a transaction | P1 |
| 🆕 | `POST /teacher/myStudents/:id/points` `{ points (±), reason }` | P2 |
| 🆕 | `POST /teacher/myStudents/:id/warnings` `{ reason }` · `DELETE …/warnings/:warningId` | **3 warnings → auto block** | P2 |
| 🆕 | `PATCH /teacher/myStudents/:id/block` `{ blocked }` | P2 |
| 🆕 | `GET /teacher/requests` · `PATCH /teacher/requests/:enrollmentId` `{ status: "accepted"\|"rejected" }` | P1 |
| 🆕 | `GET /teacher/archive` · `POST /teacher/archive/:studentId/restore` | P3 |

**Sessions & scanning**
`Session = { _id, sequence, week, number, date, center, centerName, grade, price, status: "normal"|"cancelled", active, attendance[{ student{…}, markedAt, payment, charged, comment, homeworkStatus, markedBy{_id,name}, location }], staff[{ _id, assistant{…}, checkIn, checkOut, minutes, notes }], closing{ normalCost, reducedCost, reducedCount, notes, normalCount, total } | null, presentCount, collected }`

| | Method & path | Body / notes | P |
|---|---|---|---|
| ✏️ | `GET /teacher/sessions` · `POST /teacher/sessions` | add optional `date, center, grade, price`; return the extra fields | P1 |
| 🆕 | `GET /teacher/sessions/:id` · `PATCH /teacher/sessions/:id` · `DELETE /teacher/sessions/:id` | PATCH `status:"cancelled"` **refunds every charge**. DELETE refused (409) if attendance exists | P1 |
| ✅ | `PATCH /teacher/sessions/:id/active` `{ active }` | | P1 |
| ✏️ | `POST /teacher/sessions/:id/attendance` | `{ identifier, payment?, comment?, homeworkStatus?, force? }` → `{ session, student, charged, balance }`. Rules in §6 | P1 |
| 🆕 | `PATCH /teacher/sessions/:id/attendance/:studentId` `{ payment?, comment?, homeworkStatus? }` | changing `payment` adjusts the balance | P1 |
| 🆕 | `DELETE /teacher/sessions/:id/attendance/:studentId` | refund `charged` | P2 |
| 🆕 | `POST /teacher/sessions/:id/homework` `{ identifier, status }` | status ∈ `complete, incomplete, no_steps, not_done` | P1 |
| 🆕 | `PUT /teacher/sessions/:id/closing` `{ normalCost, reducedCost, reducedCount, notes }` | P2 |
| 🆕 | `POST /teacher/sessions/:id/staff` `{ assistant, checkIn? }` · `PATCH …/staff/:entryId` `{ checkOut?, checkIn?, notes? }` · `DELETE …/staff/:entryId` | P3 |
| 🆕 | `GET /teacher/scan/lookup?identifier=` → `{ student, activeSession, attended, attendance, price, allowed, reasons[], warnings[], booklets[] (undelivered orders), lastSessions[] }` | P1 |

**Schedule** — `Slot = { _id, dayOfWeek (0=Sun), startTime "HH:MM", durationMinutes, center, centerName, grade, title, isActive, notes, teacher{…} }`
| 🆕 | `GET/POST /teacher/schedule` · `PATCH/DELETE /teacher/schedule/:id` · `POST /teacher/schedule/:id/start` `{ sequence }` → creates and activates today's session | P2 |
|---|---|---|

**Teaching content**
| | Method & path | P |
|---|---|---|
| 🆕 | Exams: `GET/POST /teacher/exams`, `GET/PATCH/DELETE /teacher/exams/:id`, `PUT /teacher/exams/:id/scores` `{ scores:[{student, score\|null}] }`. Exam = `{ name, maxScore, date, session, grade, results[{student{…},score}], stats{count,avg,max,min}, sessionLabel }` | P1 |
| 🆕 | Online homework: `GET/POST /teacher/homework`, `PATCH/DELETE /teacher/homework/:id`, `GET /teacher/homework/:id/submissions` → `{ homework, submissions[] }`, `PATCH /teacher/homework/submissions/:id` `{ status, feedback }` | P2 |
| 🆕 | Lessons: `GET/POST /teacher/lessons`, `GET/PATCH/DELETE /teacher/lessons/:id` (PATCH sends the **whole** `parts[]` and `questions[]` arrays; give new items an `_id`), `POST /teacher/lessons/:id/grants` `{ student, maxViews, hours }`, `DELETE …/grants/:grantId`, `GET /teacher/lessons/:id/answers`, `PATCH /teacher/lessons/answers/:id` `{ isCorrect, points }` | P2 |
| 🆕 | Booklets: `GET/POST /teacher/booklets`, `PATCH/DELETE /teacher/booklets/:id`, `GET/POST /teacher/booklets/orders`, `PATCH /teacher/booklets/orders/:id` `{ paid?, price?, delivered?, status? }` | P2 |
| 🆕 | Announcements: `GET/POST /teacher/announcements`, `PATCH/DELETE /teacher/announcements/:id`. `{ title, body, imageUrl, videoUrl, linkUrl, audience{grades[],centers[]}, isActive, pinned }` | P3 |

**Money**
| | Method & path | P |
|---|---|---|
| 🆕 | `GET /teacher/recharge-codes`, `POST /teacher/recharge-codes` `{ count ≤200, amount, prefix, batch }` → created codes, `DELETE /teacher/recharge-codes/:id` (unused only) | P2 |
| 🆕 | `GET /teacher/topups`, `PATCH /teacher/topups/:id` `{ status: "approved"\|"rejected", amount?, reason? }` | P2 |
| 🆕 | `GET /teacher/transactions?from&to&type&student` | P2 |
| 🆕 | `GET /teacher/finance?from&to` → `{ totals{cash, recharge, topups, booklets, income, expenses, centerCosts, salaries, net, charged}, byDay[{date,income,expenses}], sessions[] }` | P3 |
| 🆕 | `GET/POST /teacher/expenses`, `DELETE /teacher/expenses/:id` | P3 |

**Engagement & team**
| | Method & path | P |
|---|---|---|
| 🆕 | `GET /teacher/follow-up?session&mine=1` → `{ sessions[], session, exam, assistants[], rows[{student, balance, attended, homeworkStatus, examScore, absences (last 4 sessions), assignedTo, lastComment}] }` | P2 |
| 🆕 | `POST /teacher/follow-up/comments` `{ student, session, comment }` · `PUT /teacher/follow-up/assign` `{ assistant\|null, students[] }` | P2 |
| 🆕 | `GET /teacher/leaderboard` → `[{ rank, student, points, centerName }]` | P3 |
| ✏️ | `GET /teacher/assistants` (fix bug) · ✅ `POST /teacher/assistants` · 🆕 `PATCH /teacher/assistants/:id` `{ firstName, lastName, phone, role, permissions[], salary{type: fixed\|hourly\|per_session, amount} }` · 🆕 `DELETE /teacher/assistants/:id` · 🆕 `GET /teacher/assistants/:id/stats` | P1 |
| 🆕 | `GET /teacher/centers` → `[{ center, status, requestedBy }]`, `POST /teacher/centers/:centerId/request`, `PATCH /teacher/centers/:centerId` `{ status }` (answer a center's invitation), `DELETE /teacher/centers/:centerId` | P2 |

### Assistant (own account)
| 🆕 | `POST /login/assistant` · `GET /assistant/profile` → assistant fields + `role`, `permissions[]`, `teacher{public fields}` · `PATCH /assistant/profile` · `GET /assistant/work-log` | P1 |
|---|---|---|

### Learning center
| | Method & path | P |
|---|---|---|
| 🆕 | `GET/PATCH /center/profile` | P1 |
| 🆕 | `GET /center/dashboard` | P2 |
| 🆕 | `GET /center/teachers` → `[{ teacher, status, requestedBy, studentsCount, sessionsCount, attendanceCount, lastSessionAt, slots[] }]` · `POST /center/teachers/invite` `{ identifier }` · `PATCH /center/teachers/:teacherId` `{ status }` · `DELETE /center/teachers/:teacherId` | P1 |
| 🆕 | `GET /center/schedule` (active slots of linked teachers at this center) · `GET /center/sessions?from&to` (sessions at this center with `teacher, presentCount, closing`) | P2 |

### Student
All teacher-scoped routes must verify an **active** enrollment (else 403).
| | Method & path | P |
|---|---|---|
| 🆕 | `GET/PATCH /student/profile` | P1 |
| 🆕 | `GET /student/teachers` → `[{ teacher, status, joinedAt, balance }]` · `POST/DELETE /student/teachers/:teacherId/request` | P1 |
| 🆕 | `GET /student/teachers/:id/overview` → `{ teacher, balance, pricePerSession, points, rank, classSize, isBlocked, centerName, warnings, nextSlot, lastSession, stats, announcements, followUp }` | P1 |
| 🆕 | `GET /student/teachers/:id/sessions` · `/exams` · `/homework` · `/booklets` · `/transactions` · `/leaderboard` (other students: first name + initial only) | P1–P3 |
| 🆕 | `GET /student/teachers/:id/lessons` (with `access`) · `GET /student/lessons/:id` (hide part `url`s unless access is open) · `POST /student/lessons/:id/unlock` · `POST /student/lessons/:id/progress` `{ start?: true, part?, seconds? }` · `POST /student/questions/:id/answer` `{ choice }` or `{ imageUrl }` | P2 |
| 🆕 | `POST /student/homework/:id/submit` `{ files[], comment, link }` · `POST /student/booklets/:id/reserve` `{ method: center\|transfer, receiptUrl, reference }` | P2 |
| 🆕 | `POST /student/recharge` `{ code }` → `{ amount, balance, teacher }` · `POST /student/teachers/:id/topups` `{ amount, method, reference, receiptUrl }` | P2 |

### Parent
| 🆕 | `GET /parent/profile` → `{ name, phone, children[{…student, teachers[]}] }` · `POST /parent/children` `{ code }` · `DELETE /parent/children/:id` · `GET /parent/children/:id/report?teacher=` | P2 |
|---|---|---|

---

## 6. Business rules (implemented in `mock/server.js`, carried over from the old system)

- **Check-in charge:** `price = enrollment.pricePerSession ?? session.price`. Balance after = `balance + payment − price`. If it's negative and `force` isn't set → 409 `INSUFFICIENT_BALANCE`. Write two transactions: `payment` (+cash) and `attendance` (−price). Store `payment` and `charged` on the attendance row.
- Blocked student → 403 `BLOCKED` unless `force`. Only **one active session per teacher** (index already exists).
- **Cancel session** refunds each `charged` (transaction type `refund`). **Remove attendance** refunds that row. Editing `payment` posts an `adjustment` for the difference.
- **3 warnings** → `isBlocked = true`.
- **Door check (`scan/lookup`) `allowed`** = not blocked AND (already checked in OR balance ≥ price). `reasons[]` explains failures.
- **Lesson access states:** `free` (isFree) · `granted` (grant with views left and not expired) · `expired` · `exhausted` · `available` (no grant, but the student attended a linked session → free unlock with `viewsIfAttended`) · `locked` (pay `price` from balance → grant with `viewsIfPaid`). Access time (`accessHours`) starts on the **first open**. Each `progress {start:true}` uses one view.
- **Pop-up questions:** MCQ is graded automatically and correct answers add `bonusPoints` to enrollment points. Essay is `pending` until the teacher grades it. One answer per student per question.
- **Recharge codes** belong to a teacher and can only be redeemed by that teacher's active students, once. **Transfer top-ups** add balance only when approved; reject duplicate `reference`s.
- **Center closing total** = `normalCost × (present − reducedCount) + reducedCost × reducedCount`.
- **Finance "money in"** = cash at check-in + redeemed codes + approved transfers + booklet payments. Net = money in − expenses − closings − assistant pay (hourly = minutes/60 × amount, per_session = sessions × amount; fixed isn't counted per period).
- **Follow-up "needs attention"** = absent, OR homework incomplete/no_steps/not_done, OR exam score < 50%/missing, OR missed ≥ 2 of the last 4 sessions.

---

## 7. Old system → new system

| Old feature | New |
|---|---|
| Dashboard, students list/add/quick-add/bulk upload/export, profile, balance, points, warnings, block, QR | Teacher → Dashboard / Students / Student profile |
| Sessions, start session, report, exports, financial report, center closing, assistant attendance | Sessions + Session report |
| Attendance scan, homework scan, door scan, offline queue, force attendance, booklet delivery at scan | **Live scan** (one page, three modes) |
| Schedule (start session from schedule) | Weekly schedule (+ center sees combined schedule) |
| Exams & scores, online homework & grading | Exams, Online homework |
| Videos, parts, access control, session links, pop-up questions, question stats | Video lessons + lesson player |
| Booklets, reservations, payments, delivery | Booklets |
| Recharge codes, recharge centers, payment verification (receipt AI) | Wallet. Receipts go through teacher review (the backend may add AI checks before approval) |
| Ads + video broadcasts | Merged into **Announcements** (image/video/link, targeted by grade/center) |
| Follow-up dashboard/management, call-center integration | Follow-up (notes, assignment, call-list CSV) |
| Users, permissions, stats, salary config | Assistants |
| Points & leaderboard | Leaderboard (teacher + student) |
| Expenses, closing period | Finance |
| Deleted students archive | Students → Removed (restore) |
| Student portal, parent portal | Student and Parent portals (now multi-teacher) |
| Backups, clear DB, import/export DB, settings | **Not included.** They're server-admin tools that make no sense per tenant. Do them on the server. |

---

## 8. Notes and known limits

- `assets/js/core/fallbacks.js`: until `/teacher/dashboard`, `/teacher/sessions/:id`, `/teacher/myStudents/:id/history` and `/teacher/scan/lookup` exist, the UI rebuilds them from `myStudents` + `sessions`. That's why the teacher dashboard, student profile, session report and Live scan already work with today's backend. Delete the file once the real endpoints exist.
- Any other missing endpoint shows a friendly "This feature is waiting for the backend endpoint …" message instead of breaking.
- The UI is English-only (the old system was bilingual Arabic/English). Arabic and RTL support is a good next step.
- Time-based pop-up questions trigger at the exact second only for directly hosted videos (`.mp4`). For YouTube/Vimeo/Drive embeds they appear when the student finishes the part.
- QR generation uses `qrcode-generator` from jsDelivr. The camera scanner uses the browser's BarcodeDetector, falling back to `/vendor/jsQR.js` (already served) and then to the CDN.
- Camera access needs HTTPS or localhost.

## 9. Suggested order of work

1. Role in JWT + `requireRole` + assistant middleware, 401s, the §4 bug fixes.
2. Enrollment + CenterLink models. Migrate `teacher.students` → enrollments.
3. P1 endpoints: login assistant · uploads · students CRUD/link/history/balance · requests · sessions (single/edit/cancel/attendance extras/homework) · scan lookup · exams · assistants · center teachers/profile · student profile/teachers/overview/sessions/exams · directory.
4. P2: schedule, lessons, homework, booklets, wallet, follow-up, parent, closings.
5. P3: finance, expenses, leaderboard, announcements, archive, password reset.

Tip: open the app with **Try the demo account** for each role, then run the same screen against your API. Any difference in behaviour shows what's still missing.
