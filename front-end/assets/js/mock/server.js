// In-browser demo backend. Implements the API contract from core/api.js on top of localStorage,
// so every screen can be used before the real backend exists. It is also a runnable reference for
// the business rules the backend should implement (see FRONTEND_REPORT.md).
import { ApiError } from "../core/api.js";
import { STORAGE_KEYS } from "../core/config.js";
import { getAccessToken } from "../core/session.js";
import { seed } from "./seed.js";

const DAY = 86_400_000;
const DEMO_USERS = { teacher: "t1", assistant: "a1", center: "c1", student: "s1", parent: "p1" };

let db = load();

function load() {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.demoDb);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.version === 1) return parsed;
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const fresh = seed();
  persist(fresh);
  return fresh;
}

function persist(data = db) {
  try {
    localStorage.setItem(STORAGE_KEYS.demoDb, JSON.stringify(data));
  } catch {
    /* quota exceeded: keep working in memory */
  }
}

export function resetDb() {
  localStorage.removeItem(STORAGE_KEYS.demoDb);
  db = seed();
  persist();
}

export function demoLogin(role) {
  return { accessToken: `demo.${role}.${DEMO_USERS[role]}`, refreshToken: "demo" };
}

// ---------- helpers ----------
const fail = (status, message, cause) => {
  throw new ApiError(message, { status, details: cause });
};
const notFound = (what = "Record") => fail(404, `${what} not found`);
const newId = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
const nowIso = () => new Date().toISOString();
const same = (a, b) => String(a) === String(b);
const byId = (collection, id) => db[collection].find((item) => same(item._id, id));
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const sum = (items, fn) => items.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
const name = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(" ") || person?.name || person?.userName || "";
const required = (body, fields) => {
  for (const field of fields) if (body?.[field] === undefined || body[field] === null || body[field] === "") fail(400, `${field} is required`);
};
const pickFields = (body, fields) => Object.fromEntries(fields.filter((field) => body?.[field] !== undefined).map((field) => [field, body[field]]));

function currentUser() {
  const token = getAccessToken() || "";
  const [, role, id] = token.split(".");
  const collection = { teacher: "teachers", assistant: "assistants", center: "centers", student: "students", parent: "parents" }[role];
  const record = collection && byId(collection, id);
  if (!record) fail(401, "Your demo session expired. Please sign in again.");
  return { role, id, record };
}

function teacherIdOf(user) {
  if (user.role === "teacher") return user.id;
  if (user.role === "assistant") return user.record.teacher;
  return fail(403, "Only teachers and assistants can do that");
}

const studentPublic = (student) =>
  student && pickFields(student, ["_id", "userID", "firstName", "lastName", "phone", "parentPhone", "gender", "grade", "schoolName", "learningLanguage", "profilepic", "createdAt"]);
const studentRef = (id) => {
  const student = byId("students", id);
  return student ? pickFields(student, ["_id", "userID", "firstName", "lastName", "phone", "parentPhone", "grade", "profilepic"]) : { _id: id, firstName: "Removed", lastName: "student" };
};
const teacherPublic = (teacher) =>
  teacher && pickFields(teacher, ["_id", "userName", "firstName", "lastName", "email", "phone", "companyName", "subject", "teachingLanguage", "gender", "profilepic", "bio", "createdAt"]);
const centerPublic = (center) => center && pickFields(center, ["_id", "name", "phone", "localphone", "textlocation", "Maplocation", "createdAt"]);
const personRef = (id) => {
  if (!id) return null;
  if (id === "system") return { _id: "system", name: "System" };
  const person = byId("teachers", id) || byId("assistants", id) || byId("students", id);
  return person ? { _id: person._id, name: name(person) } : { _id: id, name: "—" };
};
const centerName = (id) => byId("centers", id)?.name || "";

function enrollment(teacherId, studentId, { includeArchived = false } = {}) {
  return db.enrollments.find(
    (entry) => same(entry.teacher, teacherId) && same(entry.student, studentId) && (includeArchived || !entry.archived),
  );
}
const activeEnrollments = (teacherId) =>
  db.enrollments.filter((entry) => same(entry.teacher, teacherId) && entry.status === "active" && !entry.archived);

function studentView(entry) {
  const student = byId("students", entry.student);
  const attended = db.sessions
    .filter((session) => same(session.teacher, entry.teacher) && session.attendance.some((row) => same(row.student, entry.student)))
    .map((session) => session.date)
    .sort()
    .pop();
  return {
    ...studentPublic(student),
    enrollmentId: entry._id,
    status: entry.status,
    balance: entry.balance,
    points: entry.points,
    isBlocked: entry.isBlocked,
    pricePerSession: entry.pricePerSession,
    center: entry.center,
    centerName: centerName(entry.center),
    adminNote: entry.adminNote,
    followUpAssistant: entry.followUpAssistant,
    followUpAssistantName: personRef(entry.followUpAssistant)?.name || "",
    warningsCount: db.warnings.filter((warning) => same(warning.teacher, entry.teacher) && same(warning.student, entry.student)).length,
    joinedAt: entry.joinedAt,
    lastAttendedAt: attended || null,
  };
}

function findEnrolledStudent(teacherId, identifier) {
  const needle = String(identifier || "").trim().toLowerCase();
  if (!needle) fail(400, "Enter a student code");
  const student = db.students.find((item) =>
    [item._id, item.userID, item.phone].some((value) => String(value || "").toLowerCase() === needle),
  );
  const entry = student && enrollment(teacherId, student._id);
  if (!entry || entry.status !== "active") fail(404, "No student in your class matches that code");
  return { student, entry };
}

function sessionLabel(session) {
  return `Week ${session.week} · #${session.number} · ${session.sequence}`;
}

function closingTotals(session) {
  const present = session.attendance.length;
  const closing = session.closing;
  if (!closing) return null;
  const reduced = Math.min(present, Number(closing.reducedCount) || 0);
  const normal = present - reduced;
  return { ...closing, present, normalCount: normal, reducedCount: reduced, total: normal * (Number(closing.normalCost) || 0) + reduced * (Number(closing.reducedCost) || 0) };
}

function sessionView(session) {
  return {
    ...session,
    centerName: centerName(session.center),
    attendance: session.attendance.map((row) => ({ ...row, student: studentRef(row.student), markedBy: personRef(row.markedBy) })),
    staff: (session.staff || []).map((row) => {
      const assistant = byId("assistants", row.assistant);
      const minutes = row.checkIn && row.checkOut ? Math.round((new Date(row.checkOut) - new Date(row.checkIn)) / 60000) : null;
      return { ...row, assistant: assistant ? pickFields(assistant, ["_id", "firstName", "lastName", "userName", "phone"]) : { _id: row.assistant }, minutes };
    }),
    closing: closingTotals(session),
    presentCount: session.attendance.length,
    collected: sum(session.attendance, (row) => row.payment),
  };
}

const teacherSessions = (teacherId) =>
  db.sessions.filter((session) => same(session.teacher, teacherId)).sort((a, b) => new Date(b.date) - new Date(a.date));

function addTransaction(teacherId, studentId, amount, type, reason, by, extra = {}) {
  const transaction = { _id: newId(), teacher: teacherId, student: studentId, amount, type, reason, by, createdAt: nowIso(), ...extra };
  db.transactions.push(transaction);
  return transaction;
}

function transactionView(transaction) {
  return { ...transaction, student: studentRef(transaction.student), byName: personRef(transaction.by)?.name || "" };
}

function lessonAccess(lesson, studentId) {
  const entry = enrollment(lesson.teacher, studentId);
  if (lesson.isFree) return { state: "free" };
  const grant = db.lessonGrants
    .filter((item) => same(item.lesson, lesson._id) && same(item.student, studentId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (grant) {
    if (grant.expiresAt && new Date(grant.expiresAt) < new Date()) return { state: "expired", grantId: grant._id, price: lesson.price };
    if (grant.viewsUsed >= grant.maxViews) return { state: "exhausted", grantId: grant._id, price: lesson.price };
    return { state: "granted", grantId: grant._id, method: grant.method, viewsLeft: grant.maxViews - grant.viewsUsed, maxViews: grant.maxViews, expiresAt: grant.expiresAt, startsOnOpen: !grant.startedAt };
  }
  const attended = lesson.sessions.some((sessionId) => byId("sessions", sessionId)?.attendance.some((row) => same(row.student, studentId)));
  if (attended) return { state: "available", method: "attended", views: lesson.viewsIfAttended, hours: lesson.accessHours };
  return { state: "locked", price: lesson.price, views: lesson.viewsIfPaid, hours: lesson.accessHours, balance: entry?.balance ?? 0 };
}

function examStats(results) {
  const scores = results.map((row) => row.score).filter((score) => score !== null && score !== undefined);
  return scores.length
    ? { count: scores.length, avg: Math.round((sum(scores, (score) => score) / scores.length) * 10) / 10, max: Math.max(...scores), min: Math.min(...scores) }
    : { count: 0, avg: 0, max: 0, min: 0 };
}

function inRange(value, from, to) {
  const time = new Date(value).getTime();
  return (!from || time >= new Date(from).getTime()) && (!to || time <= new Date(to).getTime() + DAY - 1);
}

function salaryFor(assistant, entries) {
  const minutes = sum(entries, (entry) => entry.minutes || 0);
  const type = assistant.salary?.type || "fixed";
  const amount = Number(assistant.salary?.amount) || 0;
  if (type === "hourly") return Math.round((minutes / 60) * amount);
  if (type === "per_session") return entries.length * amount;
  return amount;
}

function staffEntries(assistantId, from, to) {
  return db.sessions.flatMap((session) =>
    (session.staff || [])
      .filter((row) => same(row.assistant, assistantId) && inRange(row.checkIn || session.date, from, to))
      .map((row) => ({
        ...row,
        session: { _id: session._id, label: sessionLabel(session), date: session.date },
        minutes: row.checkIn && row.checkOut ? Math.round((new Date(row.checkOut) - new Date(row.checkIn)) / 60000) : 0,
      })),
  );
}

function assistantView(assistant) {
  const entries = staffEntries(assistant._id);
  return {
    ...pickFields(assistant, ["_id", "userName", "firstName", "lastName", "email", "phone", "role", "permissions", "salary", "createdAt"]),
    followUpCount: db.enrollments.filter((entry) => same(entry.followUpAssistant, assistant._id) && !entry.archived).length,
    sessionsWorked: entries.length,
  };
}

function slotView(slot) {
  return { ...slot, centerName: centerName(slot.center), teacher: teacherPublic(byId("teachers", slot.teacher)) };
}

function announcementsFor(teacherId, studentId) {
  const entry = enrollment(teacherId, studentId);
  const student = byId("students", studentId);
  return db.announcements
    .filter((item) => same(item.teacher, teacherId) && item.isActive)
    .filter((item) => !item.audience?.grades?.length || item.audience.grades.includes(String(student?.grade)))
    .filter((item) => !item.audience?.centers?.length || item.audience.centers.includes(String(entry?.center)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt) - new Date(a.createdAt));
}

function studentSessionRows(teacherId, studentId) {
  const entry = enrollment(teacherId, studentId);
  return teacherSessions(teacherId)
    .filter((session) => session.attendance.some((row) => same(row.student, studentId)) || !entry?.center || same(session.center, entry.center))
    .filter((session) => !entry?.joinedAt || new Date(session.date) >= new Date(entry.joinedAt) || session.attendance.some((row) => same(row.student, studentId)))
    .map((session) => {
      const row = session.attendance.find((item) => same(item.student, studentId));
      return {
        session: { _id: session._id, sequence: session.sequence, week: session.week, number: session.number, date: session.date, centerName: centerName(session.center) },
        status: session.status === "cancelled" ? "cancelled" : row ? "present" : session.active ? "pending" : "absent",
        markedAt: row?.markedAt || null,
        payment: row?.payment || 0,
        charged: row?.charged || 0,
        comment: row?.comment || "",
        homeworkStatus: row?.homeworkStatus || null,
        location: row ? centerName(row.location) : "",
        markedBy: row ? personRef(row.markedBy) : null,
      };
    });
}

function studentExamRows(teacherId, studentId) {
  const student = byId("students", studentId);
  return db.exams
    .filter((exam) => same(exam.teacher, teacherId) && (!exam.grade || exam.grade === student.grade || exam.results.some((row) => same(row.student, studentId))))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((exam) => {
      const row = exam.results.find((item) => same(item.student, studentId));
      const ranked = [...exam.results].filter((item) => item.score !== null).sort((a, b) => b.score - a.score);
      return {
        exam: pickFields(exam, ["_id", "name", "maxScore", "date"]),
        score: row ? row.score : null,
        rank: row ? ranked.findIndex((item) => same(item.student, studentId)) + 1 : null,
        participants: ranked.length,
        stats: examStats(exam.results),
      };
    });
}

function studentStats(teacherId, studentId) {
  const sessions = studentSessionRows(teacherId, studentId).filter((row) => ["present", "absent"].includes(row.status));
  const present = sessions.filter((row) => row.status === "present");
  const checked = present.filter((row) => row.homeworkStatus);
  const exams = studentExamRows(teacherId, studentId).filter((row) => row.score !== null);
  return {
    present: present.length,
    absent: sessions.length - present.length,
    attendanceRate: sessions.length ? Math.round((present.length / sessions.length) * 100) : 0,
    homeworkRate: checked.length ? Math.round((checked.filter((row) => row.homeworkStatus === "complete").length / checked.length) * 100) : 0,
    examAvg: exams.length ? Math.round(sum(exams, (row) => (row.score / row.exam.maxScore) * 100) / exams.length) : 0,
  };
}

function leaderboard(teacherId) {
  return activeEnrollments(teacherId)
    .sort((a, b) => b.points - a.points)
    .map((entry, index) => ({ rank: index + 1, student: studentRef(entry.student), points: entry.points, centerName: centerName(entry.center) }));
}

// ---------- route table ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, (part) => (keys.push(part.slice(1)), "([^/]+)"))}$`);
  routes.push({ method, regex, keys, handler });
};

// Shared / directory
route("POST", "/uploads", ({ body }) => {
  const file = body?.file;
  if (!(file instanceof Blob)) fail(400, "No file uploaded");
  if (file.size > 250_000) return { url: URL.createObjectURL(file), note: "Demo: large files are only kept for this browser session." };
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ url: reader.result });
    reader.readAsDataURL(file);
  });
});
route("GET", "/teachers/search", ({ query }) => {
  const needle = String(query.q || "").toLowerCase();
  return db.teachers
    .filter((teacher) => !needle || [name(teacher), teacher.userName, teacher.companyName, ...(teacher.subject || [])].join(" ").toLowerCase().includes(needle))
    .filter((teacher) => !query.subject || teacher.subject.includes(query.subject))
    .map((teacher) => ({
      ...teacherPublic(teacher),
      studentsCount: activeEnrollments(teacher._id).length,
      centers: db.centerLinks.filter((link) => same(link.teacher, teacher._id) && link.status === "active").map((link) => centerName(link.center)),
    }));
});
route("GET", "/teachers/:id", ({ params }) => {
  const teacher = byId("teachers", params.id) || notFound("Teacher");
  return {
    ...teacherPublic(teacher),
    studentsCount: activeEnrollments(teacher._id).length,
    centers: db.centerLinks.filter((link) => same(link.teacher, teacher._id) && link.status === "active").map((link) => centerPublic(byId("centers", link.center))),
    schedule: db.schedule.filter((slot) => same(slot.teacher, teacher._id) && slot.isActive).map(slotView),
  };
});
route("GET", "/centers/search", ({ query }) => {
  const needle = String(query.q || "").toLowerCase();
  return db.centers.filter((center) => !needle || [center.name, center.textlocation].join(" ").toLowerCase().includes(needle)).map(centerPublic);
});
route("PATCH", "/:role/password", ({ body }) => {
  required(body, ["currentPassword", "newPassword"]);
  if (String(body.newPassword).length < 8) fail(400, "The new password must be at least 8 characters");
  return { updated: true };
});

// ---------- Teacher ----------
route("GET", "/teacher/profile", ({ user }) => {
  const teacher = byId("teachers", teacherIdOf(user));
  return { ...teacherPublic(teacher), centers: db.centerLinks.filter((link) => same(link.teacher, teacher._id) && link.status === "active").map((link) => link.center) };
});
route("PATCH", "/teacher/profile", ({ user, body }) => {
  const teacher = byId("teachers", teacherIdOf(user));
  Object.assign(teacher, pickFields(body, ["firstName", "lastName", "profilepic", "gender", "companyName", "subject", "teachingLanguage", "bio", "phone"]));
  return teacherPublic(teacher);
});
route("DELETE", "/teacher/profile", ({ user }) => ({ id: teacherIdOf(user) }));

route("GET", "/teacher/dashboard", ({ user }) => {
  const tid = teacherIdOf(user);
  const entries = activeEnrollments(tid);
  const sessions = teacherSessions(tid);
  const normal = sessions.filter((session) => session.status === "normal");
  const today = new Date();
  const group = (items, keyFn) => {
    const map = new Map();
    for (const item of items) map.set(keyFn(item), (map.get(keyFn(item)) || 0) + 1);
    return [...map].map(([label, value]) => ({ label: label || "Unassigned", value }));
  };
  const recent = [
    ...db.transactions.filter((tx) => same(tx.teacher, tid) && tx.type !== "attendance").map((tx) => ({ type: tx.type, text: `${name(byId("students", tx.student))} · ${tx.reason}`, amount: tx.amount, createdAt: tx.createdAt })),
    ...db.warnings.filter((warning) => same(warning.teacher, tid)).map((warning) => ({ type: "warning", text: `Warning for ${name(byId("students", warning.student))}: ${warning.reason}`, createdAt: warning.createdAt })),
    ...db.enrollments.filter((entry) => same(entry.teacher, tid) && entry.status === "pending").map((entry) => ({ type: "request", text: `${name(byId("students", entry.student))} asked to join your class`, createdAt: entry.joinedAt })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);
  const active = sessions.find((session) => session.active);
  return {
    counts: {
      students: entries.length,
      assistants: db.assistants.filter((assistant) => same(assistant.teacher, tid)).length,
      centers: db.centerLinks.filter((link) => same(link.teacher, tid) && link.status === "active").length,
      pendingRequests: db.enrollments.filter((entry) => same(entry.teacher, tid) && entry.status === "pending" && !entry.archived).length,
      pendingTopups: db.topups.filter((topup) => same(topup.teacher, tid) && topup.status === "pending").length,
      pendingSubmissions: db.submissions.filter((sub) => sub.status === "submitted" && same(byId("homework", sub.homework)?.teacher, tid)).length,
      lowBalance: entries.filter((entry) => entry.balance < entry.pricePerSession).length,
      blocked: entries.filter((entry) => entry.isBlocked).length,
    },
    totalBalance: sum(entries, (entry) => entry.balance),
    activeSession: active ? sessionView(active) : null,
    todaySlots: db.schedule.filter((slot) => same(slot.teacher, tid) && slot.isActive && slot.dayOfWeek === today.getDay()).map(slotView),
    attendanceTrend: normal.slice(0, 8).reverse().map((session) => ({ label: `#${session.number}`, value: session.attendance.length, sessionId: session._id })),
    byCenter: group(entries, (entry) => centerName(entry.center)),
    byGrade: group(entries, (entry) => ["S1", "S2", "S3"][Number(byId("students", entry.student)?.grade)] || ""),
    lowBalanceStudents: entries.filter((entry) => entry.balance < entry.pricePerSession).sort((a, b) => a.balance - b.balance).slice(0, 6).map(studentView),
    recent,
  };
});

route("GET", "/teacher/myStudents", ({ user }) => activeEnrollments(teacherIdOf(user)).map(studentView));
route("GET", "/teacher/myStudents/:id/history", ({ user, params }) => {
  const tid = teacherIdOf(user);
  if (!enrollment(tid, params.id)) notFound("Student");
  const sid = params.id;
  return {
    attendance: studentSessionRows(tid, sid),
    exams: studentExamRows(tid, sid),
    homework: db.homework
      .filter((hw) => same(hw.teacher, tid))
      .map((hw) => {
        const sub = db.submissions.find((item) => same(item.homework, hw._id) && same(item.student, sid));
        return { homework: pickFields(hw, ["_id", "title", "order", "endDate"]), status: sub?.status || null, submittedAt: sub?.submittedAt || null, feedback: sub?.feedback || "" };
      }),
    transactions: db.transactions.filter((tx) => same(tx.teacher, tid) && same(tx.student, sid)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(transactionView),
    warnings: db.warnings.filter((warning) => same(warning.teacher, tid) && same(warning.student, sid)).map((warning) => ({ ...warning, byName: personRef(warning.by)?.name })),
    points: db.pointsLog.filter((entry) => same(entry.teacher, tid) && same(entry.student, sid)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((entry) => ({ ...entry, byName: personRef(entry.by)?.name })),
    booklets: db.bookletOrders
      .filter((order) => same(order.student, sid) && same(byId("booklets", order.booklet)?.teacher, tid))
      .map((order) => ({ ...order, booklet: pickFields(byId("booklets", order.booklet), ["_id", "name", "sellPrice"]) })),
    lessons: db.lessons
      .filter((lesson) => same(lesson.teacher, tid) && lesson.published)
      .map((lesson) => ({
        lesson: pickFields(lesson, ["_id", "title", "week"]),
        access: lessonAccess(lesson, sid),
        watchedSeconds: sum(db.watch.filter((row) => same(row.lesson, lesson._id) && same(row.student, sid)), (row) => row.seconds),
        totalSeconds: sum(lesson.parts, (part) => part.durationSeconds),
      })),
    stats: studentStats(tid, sid),
  };
});
route("GET", "/teacher/myStudents/:id", ({ user, params }) => {
  const entry = enrollment(teacherIdOf(user), params.id);
  if (!entry || entry.status !== "active") notFound("Student");
  return studentView(entry);
});
route("PATCH", "/teacher/myStudents/:id", ({ user, params, body }) => {
  const entry = enrollment(teacherIdOf(user), params.id) || notFound("Student");
  const student = byId("students", params.id);
  Object.assign(student, pickFields(body, ["firstName", "lastName", "phone", "parentPhone", "gender", "grade", "schoolName", "learningLanguage", "profilepic"]));
  Object.assign(entry, pickFields(body, ["pricePerSession", "center", "adminNote", "followUpAssistant"]));
  return studentView(entry);
});
route("POST", "/teacher/myStudents", ({ user, body }) => {
  const tid = teacherIdOf(user);
  required(body, ["firstName", "phone"]);
  if (db.students.some((student) => student.phone === body.phone)) fail(409, "A student with this phone number already exists. Use “Link existing student” instead.");
  const number = db.students.length + 1;
  const password = body.password || `lc${Math.floor(100000 + Math.random() * 900000)}`;
  const student = {
    _id: newId(),
    userID: `STU-${String(number).padStart(6, "0")}`,
    ...pickFields(body, ["firstName", "lastName", "phone", "parentPhone", "gender", "grade", "schoolName", "learningLanguage"]),
    profilepic: "",
    createdAt: nowIso(),
  };
  db.students.push(student);
  const entry = { _id: newId(), teacher: tid, student: student._id, status: "active", archived: false, balance: Number(body.balance) || 0, points: 0, isBlocked: false, pricePerSession: Number(body.pricePerSession) || 80, center: body.center || null, adminNote: "", followUpAssistant: null, joinedAt: nowIso() };
  db.enrollments.push(entry);
  if (entry.balance) addTransaction(tid, student._id, entry.balance, "adjustment", "Opening balance", user.id);
  return { student: studentView(entry), userID: student.userID, password };
});
route("POST", "/teacher/myStudents/link", ({ user, body }) => {
  const tid = teacherIdOf(user);
  const needle = String(body?.identifier || "").trim().toLowerCase();
  const student = db.students.find((item) => [item.userID, item.phone].some((value) => String(value).toLowerCase() === needle)) || notFound("Student account");
  const existing = enrollment(tid, student._id, { includeArchived: true });
  if (existing && existing.status === "active" && !existing.archived) fail(409, "This student is already in your class");
  if (existing) Object.assign(existing, { status: "active", archived: false, removedAt: null });
  const entry = existing || { _id: newId(), teacher: tid, student: student._id, status: "active", archived: false, balance: 0, points: 0, isBlocked: false, pricePerSession: Number(body.pricePerSession) || 80, center: body.center || null, adminNote: "", followUpAssistant: null, joinedAt: nowIso() };
  if (!existing) db.enrollments.push(entry);
  return studentView(entry);
});
route("POST", "/teacher/myStudents/import", ({ user, body }) => {
  const created = [];
  const skipped = [];
  for (const row of body?.students || []) {
    try {
      const result = handlers.createStudent({ user, body: row });
      created.push({ name: name(result.student), userID: result.userID, password: result.password });
    } catch (error) {
      skipped.push({ row, reason: error.message });
    }
  }
  return { created, skipped };
});
route("DELETE", "/teacher/myStudents/:id", ({ user, params, body }) => {
  const entry = enrollment(teacherIdOf(user), params.id) || notFound("Student");
  Object.assign(entry, { archived: true, removedAt: nowIso(), removedReason: body?.reason || "" });
  return { id: params.id };
});
route("POST", "/teacher/myStudents/:id/balance", ({ user, params, body }) => {
  const tid = teacherIdOf(user);
  const entry = enrollment(tid, params.id) || notFound("Student");
  const amount = Number(body?.amount);
  if (!amount) fail(400, "Enter a non-zero amount");
  entry.balance += amount;
  addTransaction(tid, params.id, amount, amount > 0 ? "payment" : "adjustment", body.reason || (amount > 0 ? "Payment received" : "Manual deduction"), user.id);
  return studentView(entry);
});
route("POST", "/teacher/myStudents/:id/points", ({ user, params, body }) => {
  const tid = teacherIdOf(user);
  const entry = enrollment(tid, params.id) || notFound("Student");
  const points = Number(body?.points);
  if (!points) fail(400, "Enter a non-zero number of points");
  entry.points += points;
  db.pointsLog.push({ _id: newId(), teacher: tid, student: params.id, points, reason: body.reason || "", by: user.id, createdAt: nowIso() });
  return studentView(entry);
});
route("POST", "/teacher/myStudents/:id/warnings", ({ user, params, body }) => {
  const tid = teacherIdOf(user);
  const entry = enrollment(tid, params.id) || notFound("Student");
  db.warnings.push({ _id: newId(), teacher: tid, student: params.id, reason: body?.reason || "", by: user.id, createdAt: nowIso() });
  const count = db.warnings.filter((warning) => same(warning.teacher, tid) && same(warning.student, params.id)).length;
  if (count >= 3) entry.isBlocked = true; // three warnings block the student, as in the old system
  return studentView(entry);
});
route("DELETE", "/teacher/myStudents/:id/warnings/:warningId", ({ user, params }) => {
  const tid = teacherIdOf(user);
  db.warnings = db.warnings.filter((warning) => !(same(warning._id, params.warningId) && same(warning.teacher, tid)));
  return studentView(enrollment(tid, params.id) || notFound("Student"));
});
route("PATCH", "/teacher/myStudents/:id/block", ({ user, params, body }) => {
  const entry = enrollment(teacherIdOf(user), params.id) || notFound("Student");
  entry.isBlocked = Boolean(body?.blocked);
  return studentView(entry);
});
route("GET", "/teacher/requests", ({ user }) =>
  db.enrollments
    .filter((entry) => same(entry.teacher, teacherIdOf(user)) && entry.status === "pending" && !entry.archived)
    .map((entry) => ({ _id: entry._id, student: studentPublic(byId("students", entry.student)), createdAt: entry.joinedAt })),
);
route("PATCH", "/teacher/requests/:id", ({ user, params, body }) => {
  const entry = db.enrollments.find((item) => same(item._id, params.id) && same(item.teacher, teacherIdOf(user))) || notFound("Request");
  if (body?.status === "accepted") Object.assign(entry, { status: "active", joinedAt: nowIso(), pricePerSession: entry.pricePerSession || 80 });
  else db.enrollments = db.enrollments.filter((item) => item !== entry);
  return { _id: params.id, status: body?.status };
});
route("GET", "/teacher/archive", ({ user }) =>
  db.enrollments
    .filter((entry) => same(entry.teacher, teacherIdOf(user)) && entry.archived)
    .map((entry) => ({ student: studentPublic(byId("students", entry.student)), removedAt: entry.removedAt, reason: entry.removedReason, balance: entry.balance, points: entry.points })),
);
route("POST", "/teacher/archive/:id/restore", ({ user, params }) => {
  const entry = enrollment(teacherIdOf(user), params.id, { includeArchived: true }) || notFound("Student");
  Object.assign(entry, { archived: false, removedAt: null, status: "active" });
  return studentView(entry);
});

// Sessions
route("GET", "/teacher/sessions", ({ user }) => teacherSessions(teacherIdOf(user)).map(sessionView));
route("POST", "/teacher/sessions", ({ user, body }) => {
  required(body, ["sequence", "week", "number"]);
  const session = {
    _id: newId(), teacher: teacherIdOf(user), sequence: body.sequence, week: Number(body.week), number: Number(body.number),
    date: body.date ? new Date(body.date).toISOString() : nowIso(), center: body.center || null, grade: body.grade ?? "",
    price: Number(body.price) || null, status: "normal", active: false, attendance: [], staff: [], closing: null, createdAt: nowIso(),
  };
  db.sessions.push(session);
  return sessionView(session);
});
const ownSession = (user, id) => {
  const session = byId("sessions", id);
  if (!session || !same(session.teacher, teacherIdOf(user))) notFound("Session");
  return session;
};
route("GET", "/teacher/sessions/:id", ({ user, params }) => sessionView(ownSession(user, params.id)));
route("PATCH", "/teacher/sessions/:id/active", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  if (session.status === "cancelled" && body.active) fail(400, "Restore the session before activating it");
  if (body.active) for (const other of db.sessions) if (same(other.teacher, session.teacher)) other.active = false;
  session.active = Boolean(body.active);
  return sessionView(session);
});
route("PATCH", "/teacher/sessions/:id", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  const tid = session.teacher;
  if (body.status === "cancelled" && session.status !== "cancelled") {
    // Cancelling refunds every charge from this session.
    for (const row of session.attendance) {
      const entry = enrollment(tid, row.student, { includeArchived: true });
      if (entry && row.charged) {
        entry.balance += row.charged;
        addTransaction(tid, row.student, row.charged, "refund", `Refund · session cancelled (${session.sequence})`, user.id, { session: session._id });
      }
      row.charged = 0;
    }
    session.active = false;
  }
  Object.assign(session, pickFields(body, ["sequence", "week", "number", "center", "grade", "price", "status"]));
  if (body.date) session.date = new Date(body.date).toISOString();
  return sessionView(session);
});
route("DELETE", "/teacher/sessions/:id", ({ user, params }) => {
  const session = ownSession(user, params.id);
  if (session.attendance.length) fail(409, "This session has attendance records. Cancel it instead, or remove the attendance first.");
  db.sessions = db.sessions.filter((item) => item !== session);
  return { id: params.id };
});
route("POST", "/teacher/sessions/:id/attendance", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  if (!session.active) fail(404, "Active session not found");
  const tid = session.teacher;
  const { student, entry } = findEnrolledStudent(tid, body.identifier);
  if (entry.isBlocked && !body.force) fail(403, `${name(student)} is blocked. Unblock the student or force the check-in.`, { code: "BLOCKED" });
  if (session.attendance.some((row) => same(row.student, student._id))) fail(409, "Student is already marked present");
  const payment = Math.max(0, Number(body.payment) || 0);
  const price = Number(entry.pricePerSession ?? session.price ?? 0);
  const after = entry.balance + payment - price;
  if (after < 0 && !body.force) {
    fail(409, `Not enough balance: ${entry.balance} available, ${price} needed.`, { code: "INSUFFICIENT_BALANCE", balance: entry.balance, price, payment });
  }
  if (payment) addTransaction(tid, student._id, payment, "payment", "Cash paid at attendance", user.id, { session: session._id });
  addTransaction(tid, student._id, -price, "attendance", `Session · ${sessionLabel(session)}`, user.id, { session: session._id });
  entry.balance = after;
  session.attendance.push({ student: student._id, markedAt: nowIso(), payment, charged: price, comment: body.comment || "", homeworkStatus: body.homeworkStatus || null, markedBy: user.id, location: entry.center || session.center });
  return { session: sessionView(session), student: studentView(entry), charged: price, balance: entry.balance };
});
route("PATCH", "/teacher/sessions/:id/attendance/:studentId", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  const row = session.attendance.find((item) => same(item.student, params.studentId)) || notFound("Attendance record");
  if (body.payment !== undefined && Number(body.payment) !== row.payment) {
    const entry = enrollment(session.teacher, params.studentId, { includeArchived: true });
    const diff = Number(body.payment) - row.payment;
    if (entry) entry.balance += diff;
    addTransaction(session.teacher, params.studentId, diff, "adjustment", "Attendance payment corrected", user.id, { session: session._id });
    row.payment = Number(body.payment);
  }
  Object.assign(row, pickFields(body, ["comment", "homeworkStatus"]));
  return sessionView(session);
});
route("DELETE", "/teacher/sessions/:id/attendance/:studentId", ({ user, params }) => {
  const session = ownSession(user, params.id);
  const row = session.attendance.find((item) => same(item.student, params.studentId)) || notFound("Attendance record");
  const entry = enrollment(session.teacher, params.studentId, { includeArchived: true });
  if (entry && row.charged) {
    entry.balance += row.charged;
    addTransaction(session.teacher, params.studentId, row.charged, "refund", "Attendance removed — session price refunded", user.id, { session: session._id });
  }
  session.attendance = session.attendance.filter((item) => item !== row);
  return sessionView(session);
});
route("POST", "/teacher/sessions/:id/homework", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  const { student } = findEnrolledStudent(session.teacher, body.identifier);
  const row = session.attendance.find((item) => same(item.student, student._id));
  if (!row) fail(404, `${name(student)} hasn't been marked present in this session yet`);
  if (!["complete", "incomplete", "no_steps", "not_done"].includes(body.status)) fail(400, "Choose a homework status");
  row.homeworkStatus = body.status;
  row.homeworkBy = user.id;
  return { student: studentRef(student._id), status: body.status };
});
route("PUT", "/teacher/sessions/:id/closing", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  session.closing = { normalCost: Number(body.normalCost) || 0, reducedCost: Number(body.reducedCost) || 0, reducedCount: Number(body.reducedCount) || 0, notes: body.notes || "" };
  return sessionView(session);
});
route("POST", "/teacher/sessions/:id/staff", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  required(body, ["assistant"]);
  session.staff = session.staff || [];
  session.staff.push({ _id: newId(), assistant: body.assistant, checkIn: body.checkIn ? new Date(body.checkIn).toISOString() : nowIso(), checkOut: null, notes: body.notes || "" });
  return sessionView(session);
});
route("PATCH", "/teacher/sessions/:id/staff/:entryId", ({ user, params, body }) => {
  const session = ownSession(user, params.id);
  const row = (session.staff || []).find((item) => same(item._id, params.entryId)) || notFound("Staff record");
  if (body.checkIn) row.checkIn = new Date(body.checkIn).toISOString();
  if (body.checkOut) row.checkOut = new Date(body.checkOut).toISOString();
  if (body.notes !== undefined) row.notes = body.notes;
  return sessionView(session);
});
route("DELETE", "/teacher/sessions/:id/staff/:entryId", ({ user, params }) => {
  const session = ownSession(user, params.id);
  session.staff = (session.staff || []).filter((item) => !same(item._id, params.entryId));
  return sessionView(session);
});
route("GET", "/teacher/scan/lookup", ({ user, query }) => {
  const tid = teacherIdOf(user);
  const { student, entry } = findEnrolledStudent(tid, query.identifier);
  const active = db.sessions.find((session) => same(session.teacher, tid) && session.active);
  const row = active?.attendance.find((item) => same(item.student, student._id));
  const price = Number(entry.pricePerSession ?? active?.price ?? 0);
  const reasons = [];
  if (entry.isBlocked) reasons.push("Student is blocked");
  if (!row && entry.balance < price) reasons.push(`Balance ${entry.balance} is less than the session price ${price}`);
  const warnings = db.warnings.filter((warning) => same(warning.teacher, tid) && same(warning.student, student._id));
  if (warnings.length >= 3) reasons.push(`${warnings.length} warnings`);
  return {
    student: studentView(entry),
    activeSession: active ? pickFields(active, ["_id", "sequence", "week", "number", "date", "center", "price"]) : null,
    attended: Boolean(row),
    attendance: row ? { ...row, markedBy: personRef(row.markedBy) } : null,
    price,
    allowed: reasons.length === 0,
    reasons,
    warnings: warnings.map((warning) => ({ ...warning, byName: personRef(warning.by)?.name })),
    booklets: db.bookletOrders
      .filter((order) => same(order.student, student._id) && same(byId("booklets", order.booklet)?.teacher, tid) && !order.delivered && order.status !== "rejected")
      .map((order) => ({ ...order, booklet: pickFields(byId("booklets", order.booklet), ["_id", "name"]) })),
    lastSessions: studentSessionRows(tid, student._id).slice(0, 4),
  };
});

// Schedule
route("GET", "/teacher/schedule", ({ user }) => db.schedule.filter((slot) => same(slot.teacher, teacherIdOf(user))).map(slotView));
route("POST", "/teacher/schedule", ({ user, body }) => {
  required(body, ["dayOfWeek", "startTime"]);
  const slot = { _id: newId(), teacher: teacherIdOf(user), dayOfWeek: Number(body.dayOfWeek), startTime: body.startTime.slice(0, 5), durationMinutes: Number(body.durationMinutes) || 90, center: body.center || null, grade: body.grade ?? "", title: body.title || "Group", isActive: body.isActive !== false, notes: body.notes || "" };
  db.schedule.push(slot);
  return slotView(slot);
});
const ownSlot = (user, id) => {
  const slot = byId("schedule", id);
  if (!slot || !same(slot.teacher, teacherIdOf(user))) notFound("Schedule slot");
  return slot;
};
route("PATCH", "/teacher/schedule/:id", ({ user, params, body }) => {
  const slot = ownSlot(user, params.id);
  Object.assign(slot, pickFields(body, ["dayOfWeek", "startTime", "durationMinutes", "center", "grade", "title", "isActive", "notes"]));
  if (body.dayOfWeek !== undefined) slot.dayOfWeek = Number(body.dayOfWeek);
  return slotView(slot);
});
route("DELETE", "/teacher/schedule/:id", ({ user, params }) => {
  ownSlot(user, params.id);
  db.schedule = db.schedule.filter((slot) => !same(slot._id, params.id));
  return { id: params.id };
});
route("POST", "/teacher/schedule/:id/start", ({ user, params, body }) => {
  const slot = ownSlot(user, params.id);
  const latest = teacherSessions(slot.teacher)[0];
  for (const other of db.sessions) if (same(other.teacher, slot.teacher)) other.active = false;
  const session = {
    _id: newId(), teacher: slot.teacher, sequence: body?.sequence || slot.title, week: Number(body?.week) || latest?.week || 1,
    number: Number(body?.number) || (latest?.number || 0) + 1, date: nowIso(), center: slot.center, grade: slot.grade,
    price: null, status: "normal", active: true, attendance: [], staff: [], closing: null, createdAt: nowIso(),
  };
  db.sessions.push(session);
  return sessionView(session);
});

// Exams
const examView = (exam) => ({
  ...exam,
  sessionLabel: exam.session ? sessionLabel(byId("sessions", exam.session) || { week: "?", number: "?", sequence: "" }) : "",
  results: exam.results.map((row) => ({ ...row, student: studentRef(row.student) })),
  stats: examStats(exam.results),
});
const ownExam = (user, id) => {
  const exam = byId("exams", id);
  if (!exam || !same(exam.teacher, teacherIdOf(user))) notFound("Exam");
  return exam;
};
route("GET", "/teacher/exams", ({ user }) => db.exams.filter((exam) => same(exam.teacher, teacherIdOf(user))).sort((a, b) => new Date(b.date) - new Date(a.date)).map(examView));
route("GET", "/teacher/exams/:id", ({ user, params }) => examView(ownExam(user, params.id)));
route("POST", "/teacher/exams", ({ user, body }) => {
  required(body, ["name", "maxScore"]);
  const exam = { _id: newId(), teacher: teacherIdOf(user), name: body.name, maxScore: Number(body.maxScore), date: body.date ? new Date(body.date).toISOString() : nowIso(), session: body.session || null, grade: body.grade ?? "", results: [], createdAt: nowIso() };
  db.exams.push(exam);
  return examView(exam);
});
route("PATCH", "/teacher/exams/:id", ({ user, params, body }) => {
  const exam = ownExam(user, params.id);
  Object.assign(exam, pickFields(body, ["name", "maxScore", "session", "grade"]));
  if (body.date) exam.date = new Date(body.date).toISOString();
  return examView(exam);
});
route("DELETE", "/teacher/exams/:id", ({ user, params }) => {
  ownExam(user, params.id);
  db.exams = db.exams.filter((exam) => !same(exam._id, params.id));
  return { id: params.id };
});
route("PUT", "/teacher/exams/:id/scores", ({ user, params, body }) => {
  const exam = ownExam(user, params.id);
  for (const row of body?.scores || []) {
    if (row.score !== null && (row.score < 0 || row.score > exam.maxScore)) fail(400, `Scores must be between 0 and ${exam.maxScore}`);
  }
  exam.results = (body?.scores || []).filter((row) => row.score !== null && row.score !== "" && row.score !== undefined).map((row) => ({ student: row.student, score: Number(row.score) }));
  return examView(exam);
});

// Online homework
const ownHomework = (user, id) => {
  const hw = byId("homework", id);
  if (!hw || !same(hw.teacher, teacherIdOf(user))) notFound("Homework");
  return hw;
};
const homeworkView = (hw) => {
  const subs = db.submissions.filter((sub) => same(sub.homework, hw._id));
  return { ...hw, submissionsCount: subs.length, pendingCount: subs.filter((sub) => sub.status === "submitted").length, isOpen: new Date(hw.endDate).getTime() + DAY > Date.now() };
};
route("GET", "/teacher/homework", ({ user }) => db.homework.filter((hw) => same(hw.teacher, teacherIdOf(user))).sort((a, b) => b.order - a.order).map(homeworkView));
route("POST", "/teacher/homework", ({ user, body }) => {
  required(body, ["title", "startDate", "endDate"]);
  const tid = teacherIdOf(user);
  const hw = { _id: newId(), teacher: tid, order: db.homework.filter((item) => same(item.teacher, tid)).length + 1, submissionType: "upload", externalLink: "", grade: "", description: "", ...pickFields(body, ["title", "description", "startDate", "endDate", "submissionType", "externalLink", "grade"]), createdAt: nowIso() };
  db.homework.push(hw);
  return homeworkView(hw);
});
route("PATCH", "/teacher/homework/submissions/:id", ({ user, params, body }) => {
  const sub = byId("submissions", params.id) || notFound("Submission");
  ownHomework(user, sub.homework);
  Object.assign(sub, pickFields(body, ["status", "feedback"]), { gradedAt: nowIso(), gradedBy: user.id });
  return { ...sub, student: studentRef(sub.student), gradedByName: personRef(user.id)?.name };
});
route("PATCH", "/teacher/homework/:id", ({ user, params, body }) => {
  const hw = ownHomework(user, params.id);
  Object.assign(hw, pickFields(body, ["title", "description", "startDate", "endDate", "submissionType", "externalLink", "grade"]));
  return homeworkView(hw);
});
route("DELETE", "/teacher/homework/:id", ({ user, params }) => {
  ownHomework(user, params.id);
  db.homework = db.homework.filter((hw) => !same(hw._id, params.id));
  db.submissions = db.submissions.filter((sub) => !same(sub.homework, params.id));
  return { id: params.id };
});
route("GET", "/teacher/homework/:id/submissions", ({ user, params }) => {
  const hw = ownHomework(user, params.id);
  return {
    homework: homeworkView(hw),
    submissions: db.submissions.filter((sub) => same(sub.homework, hw._id)).map((sub) => ({ ...sub, student: studentRef(sub.student), gradedByName: personRef(sub.gradedBy)?.name || "" })),
  };
});

// Lessons
const ownLesson = (user, id) => {
  const lesson = byId("lessons", id);
  if (!lesson || !same(lesson.teacher, teacherIdOf(user))) notFound("Lesson");
  return lesson;
};
const lessonView = (lesson) => ({
  ...lesson,
  sessionLabels: lesson.sessions.map((id) => {
    const session = byId("sessions", id);
    return session ? { _id: id, label: sessionLabel(session) } : { _id: id, label: "Removed session" };
  }),
  grants: db.lessonGrants.filter((grant) => same(grant.lesson, lesson._id)).map((grant) => ({ ...grant, student: studentRef(grant.student) })),
  stats: {
    viewers: new Set(db.watch.filter((row) => same(row.lesson, lesson._id)).map((row) => row.student)).size,
    grants: db.lessonGrants.filter((grant) => same(grant.lesson, lesson._id)).length,
    pendingAnswers: db.answers.filter((answer) => same(answer.lesson, lesson._id) && answer.status === "pending").length,
    durationSeconds: sum(lesson.parts, (part) => part.durationSeconds),
  },
});
route("GET", "/teacher/lessons", ({ user }) => db.lessons.filter((lesson) => same(lesson.teacher, teacherIdOf(user))).sort((a, b) => a.week - b.week || a.order - b.order).map(lessonView));
route("GET", "/teacher/lessons/:id/answers", ({ user, params }) => {
  const lesson = ownLesson(user, params.id);
  return db.answers
    .filter((answer) => same(answer.lesson, lesson._id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((answer) => ({ ...answer, student: studentRef(answer.student), question: pickFields(lesson.questions.find((q) => same(q._id, answer.question)) || {}, ["_id", "text", "type", "bonusPoints", "correct"]) }));
});
route("PATCH", "/teacher/lessons/answers/:id", ({ user, body, params }) => {
  const answer = byId("answers", params.id) || notFound("Answer");
  const lesson = ownLesson(user, answer.lesson);
  const points = Math.max(0, Number(body.points) || 0);
  const entry = enrollment(lesson.teacher, answer.student);
  if (entry) entry.points += points - (answer.points || 0);
  Object.assign(answer, { isCorrect: Boolean(body.isCorrect), points, status: "graded", gradedBy: user.id, gradedAt: nowIso() });
  return answer;
});
route("GET", "/teacher/lessons/:id", ({ user, params }) => lessonView(ownLesson(user, params.id)));
function normalizeLesson(body, lesson = {}) {
  const parts = (body.parts ?? lesson.parts ?? []).map((part, index) => ({ _id: part._id || newId(), category: part.category || "explanation", title: part.title || `Part ${index + 1}`, url: part.url || "", durationSeconds: Number(part.durationSeconds) || 0, order: index + 1 }));
  const questions = (body.questions ?? lesson.questions ?? []).map((question) => ({ ...question, _id: question._id || newId(), bonusPoints: Number(question.bonusPoints) || 0, triggerSeconds: Number(question.triggerSeconds) || 0 }));
  return { parts, questions };
}
route("POST", "/teacher/lessons", ({ user, body }) => {
  required(body, ["title"]);
  const tid = teacherIdOf(user);
  const lesson = { _id: newId(), teacher: tid, description: "", week: 1, order: db.lessons.filter((item) => same(item.teacher, tid)).length + 1, grade: "", isFree: false, price: 0, viewsIfAttended: 2, viewsIfPaid: 3, accessHours: 72, sessions: [], published: false, createdAt: nowIso(), ...pickFields(body, ["title", "description", "week", "grade", "isFree", "price", "viewsIfAttended", "viewsIfPaid", "accessHours", "sessions", "published"]), ...normalizeLesson(body) };
  db.lessons.push(lesson);
  return lessonView(lesson);
});
route("PATCH", "/teacher/lessons/:id", ({ user, params, body }) => {
  const lesson = ownLesson(user, params.id);
  Object.assign(lesson, pickFields(body, ["title", "description", "week", "order", "grade", "isFree", "price", "viewsIfAttended", "viewsIfPaid", "accessHours", "sessions", "published"]), normalizeLesson(body, lesson));
  return lessonView(lesson);
});
route("DELETE", "/teacher/lessons/:id", ({ user, params }) => {
  ownLesson(user, params.id);
  db.lessons = db.lessons.filter((lesson) => !same(lesson._id, params.id));
  return { id: params.id };
});
route("POST", "/teacher/lessons/:id/grants", ({ user, params, body }) => {
  const lesson = ownLesson(user, params.id);
  required(body, ["student"]);
  db.lessonGrants.push({ _id: newId(), lesson: lesson._id, student: body.student, method: "admin_free", maxViews: Number(body.maxViews) || lesson.viewsIfPaid, viewsUsed: 0, startedAt: null, expiresAt: null, hours: Number(body.hours) || lesson.accessHours, createdAt: nowIso() });
  return lessonView(lesson);
});
route("DELETE", "/teacher/lessons/:id/grants/:grantId", ({ user, params }) => {
  const lesson = ownLesson(user, params.id);
  db.lessonGrants = db.lessonGrants.filter((grant) => !same(grant._id, params.grantId));
  return lessonView(lesson);
});

// Booklets
const bookletView = (booklet) => {
  const orders = db.bookletOrders.filter((order) => same(order.booklet, booklet._id) && order.status !== "rejected");
  return { ...booklet, sold: orders.length, delivered: orders.filter((order) => order.delivered).length, collected: sum(orders, (order) => order.paid), outstanding: sum(orders, (order) => order.price - order.paid) };
};
const ownBooklet = (user, id) => {
  const booklet = byId("booklets", id);
  if (!booklet || !same(booklet.teacher, teacherIdOf(user))) notFound("Booklet");
  return booklet;
};
const orderView = (order) => ({ ...order, booklet: pickFields(byId("booklets", order.booklet) || {}, ["_id", "name", "sellPrice"]), student: studentRef(order.student) });
route("GET", "/teacher/booklets/orders", ({ user }) => {
  const ids = new Set(db.booklets.filter((booklet) => same(booklet.teacher, teacherIdOf(user))).map((booklet) => booklet._id));
  return db.bookletOrders.filter((order) => ids.has(order.booklet)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(orderView);
});
route("POST", "/teacher/booklets/orders", ({ user, body }) => {
  required(body, ["booklet", "student"]);
  const booklet = ownBooklet(user, body.booklet);
  if (db.bookletOrders.some((order) => same(order.booklet, booklet._id) && same(order.student, body.student) && order.status !== "rejected")) fail(409, "This student already has this booklet");
  const order = { _id: newId(), booklet: booklet._id, student: body.student, price: Number(body.price) || booklet.sellPrice, paid: Number(body.paid) || 0, delivered: Boolean(body.delivered), deliveredAt: body.delivered ? nowIso() : null, method: "center", status: "verified", receiptUrl: "", reference: "", createdAt: nowIso() };
  db.bookletOrders.push(order);
  if (order.delivered) booklet.stock = Math.max(0, booklet.stock - 1);
  return orderView(order);
});
route("PATCH", "/teacher/booklets/orders/:id", ({ user, params, body }) => {
  const order = byId("bookletOrders", params.id) || notFound("Order");
  const booklet = ownBooklet(user, order.booklet);
  if (body.delivered === true && !order.delivered) {
    order.deliveredAt = nowIso();
    booklet.stock = Math.max(0, booklet.stock - 1);
  }
  Object.assign(order, pickFields(body, ["paid", "price", "delivered", "status"]));
  if (body.paid !== undefined) order.paid = Number(body.paid);
  return orderView(order);
});
route("GET", "/teacher/booklets", ({ user }) => db.booklets.filter((booklet) => same(booklet.teacher, teacherIdOf(user))).map(bookletView));
route("POST", "/teacher/booklets", ({ user, body }) => {
  required(body, ["name", "sellPrice"]);
  const booklet = { _id: newId(), teacher: teacherIdOf(user), isActive: true, grade: "", printPrice: 0, stock: 0, ...pickFields(body, ["name", "grade", "printPrice", "sellPrice", "stock", "isActive"]), createdAt: nowIso() };
  db.booklets.push(booklet);
  return bookletView(booklet);
});
route("PATCH", "/teacher/booklets/:id", ({ user, params, body }) => {
  const booklet = ownBooklet(user, params.id);
  Object.assign(booklet, pickFields(body, ["name", "grade", "printPrice", "sellPrice", "stock", "isActive"]));
  return bookletView(booklet);
});
route("DELETE", "/teacher/booklets/:id", ({ user, params }) => {
  ownBooklet(user, params.id);
  if (db.bookletOrders.some((order) => same(order.booklet, params.id))) fail(409, "This booklet has orders. Hide it instead of deleting it.");
  db.booklets = db.booklets.filter((booklet) => !same(booklet._id, params.id));
  return { id: params.id };
});

// Wallet
route("GET", "/teacher/recharge-codes", ({ user }) =>
  db.codes.filter((code) => same(code.teacher, teacherIdOf(user))).sort((a, b) => Number(a.used) - Number(b.used) || new Date(b.createdAt) - new Date(a.createdAt)).map((code) => ({ ...code, usedBy: code.usedBy ? studentRef(code.usedBy) : null })),
);
route("POST", "/teacher/recharge-codes", ({ user, body }) => {
  const count = Math.min(200, Math.max(1, Number(body?.count) || 1));
  const amount = Number(body?.amount);
  if (!amount || amount <= 0) fail(400, "Enter a positive amount");
  const prefix = String(body.prefix || "LC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "LC";
  const created = [];
  for (let index = 0; index < count; index += 1) {
    let code;
    do code = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    while (db.codes.some((item) => item.code === code));
    const record = { _id: newId(), teacher: teacherIdOf(user), code, amount, used: false, usedBy: null, usedAt: null, batch: body.batch || `Batch ${new Date().toLocaleDateString()}`, createdAt: nowIso() };
    db.codes.push(record);
    created.push(record);
  }
  return created;
});
route("DELETE", "/teacher/recharge-codes/:id", ({ user, params }) => {
  const code = byId("codes", params.id);
  if (!code || !same(code.teacher, teacherIdOf(user))) notFound("Code");
  if (code.used) fail(409, "Used codes can't be deleted");
  db.codes = db.codes.filter((item) => item !== code);
  return { id: params.id };
});
route("GET", "/teacher/topups", ({ user }) =>
  db.topups.filter((topup) => same(topup.teacher, teacherIdOf(user))).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((topup) => ({ ...topup, student: studentRef(topup.student) })),
);
route("PATCH", "/teacher/topups/:id", ({ user, params, body }) => {
  const topup = byId("topups", params.id);
  if (!topup || !same(topup.teacher, teacherIdOf(user))) notFound("Top-up request");
  if (topup.status !== "pending") fail(409, "This request was already reviewed");
  topup.status = body.status === "approved" ? "approved" : "rejected";
  topup.reason = body.reason || "";
  if (topup.status === "approved") {
    const amount = Number(body.amount) || topup.amount;
    topup.amount = amount;
    const entry = enrollment(topup.teacher, topup.student);
    if (entry) entry.balance += amount;
    addTransaction(topup.teacher, topup.student, amount, "topup", `Transfer ${topup.reference || ""} approved`.trim(), user.id);
  }
  return { ...topup, student: studentRef(topup.student) };
});
route("GET", "/teacher/transactions", ({ user, query }) =>
  db.transactions
    .filter((tx) => same(tx.teacher, teacherIdOf(user)) && (!query.type || tx.type === query.type) && (!query.student || same(tx.student, query.student)) && inRange(tx.createdAt, query.from, query.to))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, Number(query.limit) || 300)
    .map(transactionView),
);

// Announcements
const ownAnnouncement = (user, id) => {
  const item = byId("announcements", id);
  if (!item || !same(item.teacher, teacherIdOf(user))) notFound("Announcement");
  return item;
};
const ANNOUNCEMENT_FIELDS = ["title", "body", "imageUrl", "videoUrl", "linkUrl", "audience", "isActive", "pinned"];
route("GET", "/teacher/announcements", ({ user }) => db.announcements.filter((item) => same(item.teacher, teacherIdOf(user))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt) - new Date(a.createdAt)));
route("POST", "/teacher/announcements", ({ user, body }) => {
  required(body, ["title"]);
  const item = { _id: newId(), teacher: teacherIdOf(user), body: "", imageUrl: "", videoUrl: "", linkUrl: "", audience: { grades: [], centers: [] }, isActive: true, pinned: false, ...pickFields(body, ANNOUNCEMENT_FIELDS), createdAt: nowIso() };
  db.announcements.push(item);
  return item;
});
route("PATCH", "/teacher/announcements/:id", ({ user, params, body }) => Object.assign(ownAnnouncement(user, params.id), pickFields(body, ANNOUNCEMENT_FIELDS)));
route("DELETE", "/teacher/announcements/:id", ({ user, params }) => {
  ownAnnouncement(user, params.id);
  db.announcements = db.announcements.filter((item) => !same(item._id, params.id));
  return { id: params.id };
});

// Follow-up
route("GET", "/teacher/follow-up", ({ user, query }) => {
  const tid = teacherIdOf(user);
  const sessions = teacherSessions(tid).filter((session) => session.status === "normal");
  const session = (query.session && sessions.find((item) => same(item._id, query.session))) || sessions.find((item) => !item.active) || sessions[0];
  const mine = user.role === "assistant" && query.mine === "1";
  const roster = activeEnrollments(tid).filter((entry) => !session?.center || same(entry.center, session.center)).filter((entry) => !mine || same(entry.followUpAssistant, user.id));
  const exam = session && db.exams.find((item) => same(item.session, session._id));
  const recent = sessions.filter((item) => !session?.center || same(item.center, session?.center)).slice(0, 4);
  return {
    sessions: sessions.slice(0, 20).map((item) => ({ _id: item._id, label: sessionLabel(item), date: item.date })),
    session: session ? { _id: session._id, label: sessionLabel(session), date: session.date, centerName: centerName(session.center) } : null,
    exam: exam ? pickFields(exam, ["_id", "name", "maxScore"]) : null,
    assistants: db.assistants.filter((assistant) => same(assistant.teacher, tid)).map((assistant) => ({ _id: assistant._id, name: name(assistant), phone: assistant.phone })),
    rows: roster.map((entry) => {
      const row = session?.attendance.find((item) => same(item.student, entry.student));
      const comment = db.followComments.filter((item) => same(item.teacher, tid) && same(item.student, entry.student)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return {
        student: studentRef(entry.student),
        balance: entry.balance,
        attended: Boolean(row),
        homeworkStatus: row?.homeworkStatus || null,
        examScore: exam ? exam.results.find((result) => same(result.student, entry.student))?.score ?? null : undefined,
        absences: recent.filter((item) => !item.attendance.some((att) => same(att.student, entry.student))).length,
        assignedTo: personRef(entry.followUpAssistant),
        lastComment: comment ? { comment: comment.comment, byName: personRef(comment.by)?.name, createdAt: comment.createdAt } : null,
      };
    }),
  };
});
route("POST", "/teacher/follow-up/comments", ({ user, body }) => {
  required(body, ["student", "comment"]);
  const item = { _id: newId(), teacher: teacherIdOf(user), student: body.student, session: body.session || null, comment: body.comment, by: user.id, createdAt: nowIso() };
  db.followComments.push(item);
  return { ...item, byName: personRef(user.id)?.name };
});
route("PUT", "/teacher/follow-up/assign", ({ user, body }) => {
  const tid = teacherIdOf(user);
  for (const studentId of body?.students || []) {
    const entry = enrollment(tid, studentId);
    if (entry) entry.followUpAssistant = body.assistant || null;
  }
  return { updated: (body?.students || []).length };
});

// Assistants
const ownAssistant = (user, id) => {
  const assistant = byId("assistants", id);
  if (!assistant || !same(assistant.teacher, teacherIdOf(user))) notFound("Assistant");
  return assistant;
};
route("GET", "/teacher/assistants", ({ user }) => db.assistants.filter((assistant) => same(assistant.teacher, teacherIdOf(user))).map(assistantView));
route("POST", "/teacher/assistants", ({ user, body }) => {
  if (user.role !== "teacher") fail(403, "Only the teacher can add assistants");
  required(body, ["userName", "email", "phone", "password"]);
  const all = [...db.assistants, ...db.teachers];
  if (all.some((person) => person.email === body.email)) fail(409, "Email already registered");
  if (all.some((person) => person.userName === body.userName)) fail(409, "Username already taken");
  const assistant = { _id: newId(), teacher: user.id, role: "Assistant", permissions: ["dashboard", "students_view", "sessions_view", "scan_attendance"], salary: { type: "fixed", amount: 0 }, ...pickFields(body, ["userName", "email", "phone", "firstName", "lastName", "role", "permissions"]), createdAt: nowIso() };
  db.assistants.push(assistant);
  return { ...assistantView(assistant), id: assistant._id };
});
route("GET", "/teacher/assistants/:id/stats", ({ user, params, query }) => {
  const assistant = ownAssistant(user, params.id);
  const entries = staffEntries(assistant._id, query.from, query.to);
  const marked = db.sessions.filter((session) => same(session.teacher, assistant.teacher)).flatMap((session) => session.attendance).filter((row) => same(row.markedBy, assistant._id) && inRange(row.markedAt, query.from, query.to));
  return {
    assistant: assistantView(assistant),
    sessionsWorked: entries.length,
    minutes: sum(entries, (entry) => entry.minutes),
    attendanceMarked: marked.length,
    homeworkChecked: db.sessions.flatMap((session) => session.attendance).filter((row) => same(row.homeworkBy, assistant._id)).length,
    comments: db.followComments.filter((item) => same(item.by, assistant._id)).length,
    salaryEstimate: salaryFor(assistant, entries),
    log: entries.sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn)),
  };
});
route("PATCH", "/teacher/assistants/:id", ({ user, params, body }) => {
  if (user.role !== "teacher") fail(403, "Only the teacher can change assistants");
  const assistant = ownAssistant(user, params.id);
  Object.assign(assistant, pickFields(body, ["firstName", "lastName", "phone", "email", "role", "permissions", "salary"]));
  return assistantView(assistant);
});
route("DELETE", "/teacher/assistants/:id", ({ user, params }) => {
  if (user.role !== "teacher") fail(403, "Only the teacher can remove assistants");
  ownAssistant(user, params.id);
  db.assistants = db.assistants.filter((assistant) => !same(assistant._id, params.id));
  for (const entry of db.enrollments) if (same(entry.followUpAssistant, params.id)) entry.followUpAssistant = null;
  return { id: params.id };
});

// Centers (teacher side)
const linkView = (link) => ({ _id: link._id, center: centerPublic(byId("centers", link.center)), status: link.status, requestedBy: link.requestedBy, createdAt: link.createdAt });
route("GET", "/teacher/centers", ({ user }) => db.centerLinks.filter((link) => same(link.teacher, teacherIdOf(user)) && link.status !== "rejected").map(linkView));
route("POST", "/teacher/centers/:id/request", ({ user, params }) => {
  const tid = teacherIdOf(user);
  byId("centers", params.id) || notFound("Center");
  const existing = db.centerLinks.find((link) => same(link.teacher, tid) && same(link.center, params.id));
  if (existing?.status === "active") fail(409, "You're already linked to this center");
  if (existing?.status === "pending" && existing.requestedBy === "center") {
    existing.status = "active";
    return linkView(existing);
  }
  if (existing) Object.assign(existing, { status: "pending", requestedBy: "teacher", createdAt: nowIso() });
  const link = existing || { _id: newId(), teacher: tid, center: params.id, status: "pending", requestedBy: "teacher", createdAt: nowIso() };
  if (!existing) db.centerLinks.push(link);
  return linkView(link);
});
route("PATCH", "/teacher/centers/:id", ({ user, params, body }) => {
  const link = db.centerLinks.find((item) => same(item.teacher, teacherIdOf(user)) && same(item.center, params.id)) || notFound("Request");
  if (link.requestedBy !== "center") fail(400, "Only the center can answer your request");
  link.status = body.status === "active" ? "active" : "rejected";
  return linkView(link);
});
route("DELETE", "/teacher/centers/:id", ({ user, params }) => {
  db.centerLinks = db.centerLinks.filter((link) => !(same(link.teacher, teacherIdOf(user)) && same(link.center, params.id)));
  return { id: params.id };
});

// Finance
route("GET", "/teacher/finance", ({ user, query }) => {
  const tid = teacherIdOf(user);
  const from = query.from || new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const to = query.to || new Date().toISOString().slice(0, 10);
  const txs = db.transactions.filter((tx) => same(tx.teacher, tid) && inRange(tx.createdAt, from, to));
  const sessions = teacherSessions(tid).filter((session) => session.status === "normal" && inRange(session.date, from, to));
  const bookletIds = new Set(db.booklets.filter((booklet) => same(booklet.teacher, tid)).map((booklet) => booklet._id));
  const orders = db.bookletOrders.filter((order) => bookletIds.has(order.booklet) && order.status !== "rejected" && inRange(order.createdAt, from, to));
  const expenses = db.expenses.filter((expense) => same(expense.teacher, tid) && inRange(expense.date, from, to));
  const assistants = db.assistants.filter((assistant) => same(assistant.teacher, tid));
  const salaries = sum(assistants, (assistant) => {
    const entries = staffEntries(assistant._id, from, to);
    return assistant.salary?.type === "fixed" ? 0 : salaryFor(assistant, entries);
  });
  const centerCosts = sum(sessions, (session) => closingTotals(session)?.total || 0);
  const cash = sum(txs.filter((tx) => tx.type === "payment"), (tx) => tx.amount);
  const recharge = sum(txs.filter((tx) => tx.type === "recharge"), (tx) => tx.amount);
  const topups = sum(txs.filter((tx) => tx.type === "topup"), (tx) => tx.amount);
  const booklets = sum(orders, (order) => order.paid);
  const expenseTotal = sum(expenses, (expense) => expense.amount);
  const income = cash + recharge + topups + booklets;
  const days = [];
  for (let time = new Date(from).getTime(); time <= new Date(to).getTime(); time += DAY) {
    const day = new Date(time).toISOString().slice(0, 10);
    days.push({
      date: day,
      income: sum(txs.filter((tx) => ["payment", "recharge", "topup"].includes(tx.type) && tx.createdAt.slice(0, 10) === day), (tx) => tx.amount) + sum(orders.filter((order) => order.createdAt.slice(0, 10) === day), (order) => order.paid),
      expenses: sum(expenses.filter((expense) => String(expense.date).slice(0, 10) === day), (expense) => expense.amount),
    });
  }
  return {
    from, to,
    totals: { cash, recharge, topups, booklets, income, expenses: expenseTotal, centerCosts, salaries, net: income - expenseTotal - centerCosts - salaries, charged: -sum(txs.filter((tx) => tx.type === "attendance"), (tx) => tx.amount) },
    byDay: days,
    sessions: sessions.map((session) => ({ _id: session._id, label: sessionLabel(session), date: session.date, centerName: centerName(session.center), present: session.attendance.length, collected: sum(session.attendance, (row) => row.payment), charged: sum(session.attendance, (row) => row.charged), centerCost: closingTotals(session)?.total || 0 })),
  };
});
route("GET", "/teacher/expenses", ({ user, query }) => db.expenses.filter((expense) => same(expense.teacher, teacherIdOf(user)) && inRange(expense.date, query.from, query.to)).sort((a, b) => new Date(b.date) - new Date(a.date)));
route("POST", "/teacher/expenses", ({ user, body }) => {
  required(body, ["amount", "reason"]);
  const expense = { _id: newId(), teacher: teacherIdOf(user), amount: Number(body.amount), reason: body.reason, category: body.category || "other", date: body.date ? new Date(body.date).toISOString() : nowIso() };
  db.expenses.push(expense);
  return expense;
});
route("DELETE", "/teacher/expenses/:id", ({ user, params }) => {
  db.expenses = db.expenses.filter((expense) => !(same(expense._id, params.id) && same(expense.teacher, teacherIdOf(user))));
  return { id: params.id };
});
route("GET", "/teacher/leaderboard", ({ user }) => leaderboard(teacherIdOf(user)));

// ---------- Assistant ----------
route("GET", "/assistant/profile", ({ user }) => {
  if (user.role !== "assistant") fail(403, "Assistants only");
  return { ...assistantView(user.record), teacher: teacherPublic(byId("teachers", user.record.teacher)) };
});
route("PATCH", "/assistant/profile", ({ user, body }) => {
  Object.assign(user.record, pickFields(body, ["firstName", "lastName", "phone", "profilepic"]));
  return { ...assistantView(user.record), teacher: teacherPublic(byId("teachers", user.record.teacher)) };
});
route("GET", "/assistant/work-log", ({ user, query }) => {
  const entries = staffEntries(user.id, query.from, query.to);
  return {
    log: entries.sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn)),
    minutes: sum(entries, (entry) => entry.minutes),
    sessionsWorked: entries.length,
    attendanceMarked: db.sessions.flatMap((session) => session.attendance).filter((row) => same(row.markedBy, user.id)).length,
    salary: user.record.salary,
    salaryEstimate: salaryFor(user.record, entries),
    followUpStudents: db.enrollments.filter((entry) => same(entry.followUpAssistant, user.id) && !entry.archived).length,
  };
});

// ---------- Center ----------
const centerOnly = (user) => (user.role === "center" ? user.id : fail(403, "Centers only"));
const centerTeacherView = (link) => {
  const teacher = byId("teachers", link.teacher);
  const sessions = db.sessions.filter((session) => same(session.teacher, link.teacher) && same(session.center, link.center) && session.status === "normal");
  return {
    teacher: teacherPublic(teacher),
    status: link.status,
    requestedBy: link.requestedBy,
    createdAt: link.createdAt,
    studentsCount: activeEnrollments(link.teacher).filter((entry) => same(entry.center, link.center)).length,
    sessionsCount: sessions.length,
    attendanceCount: sum(sessions, (session) => session.attendance.length),
    lastSessionAt: sessions.map((session) => session.date).sort().pop() || null,
    slots: db.schedule.filter((slot) => same(slot.teacher, link.teacher) && same(slot.center, link.center) && slot.isActive).map(slotView),
  };
};
route("GET", "/center/profile", ({ user }) => centerPublic(byId("centers", centerOnly(user))));
route("PATCH", "/center/profile", ({ user, body }) => Object.assign(byId("centers", centerOnly(user)), pickFields(body, ["name", "phone", "localphone", "textlocation", "Maplocation"])));
route("GET", "/center/teachers", ({ user }) => db.centerLinks.filter((link) => same(link.center, centerOnly(user)) && link.status !== "rejected").map(centerTeacherView));
route("POST", "/center/teachers/invite", ({ user, body }) => {
  const cid = centerOnly(user);
  const needle = String(body?.identifier || "").trim().toLowerCase();
  const teacher = db.teachers.find((item) => [item._id, item.userName, item.email, item.phone].some((value) => String(value).toLowerCase() === needle)) || notFound("Teacher");
  const existing = db.centerLinks.find((link) => same(link.teacher, teacher._id) && same(link.center, cid));
  if (existing?.status === "active") fail(409, "This teacher already works with your center");
  if (existing?.status === "pending" && existing.requestedBy === "teacher") existing.status = "active";
  else if (existing) Object.assign(existing, { status: "pending", requestedBy: "center", createdAt: nowIso() });
  else db.centerLinks.push({ _id: newId(), teacher: teacher._id, center: cid, status: "pending", requestedBy: "center", createdAt: nowIso() });
  return centerTeacherView(db.centerLinks.find((link) => same(link.teacher, teacher._id) && same(link.center, cid)));
});
route("PATCH", "/center/teachers/:id", ({ user, params, body }) => {
  const link = db.centerLinks.find((item) => same(item.center, centerOnly(user)) && same(item.teacher, params.id)) || notFound("Request");
  if (link.requestedBy !== "teacher") fail(400, "Waiting for the teacher to answer your invitation");
  link.status = body.status === "active" ? "active" : "rejected";
  return centerTeacherView(link);
});
route("DELETE", "/center/teachers/:id", ({ user, params }) => {
  const cid = centerOnly(user);
  db.centerLinks = db.centerLinks.filter((link) => !(same(link.center, cid) && same(link.teacher, params.id)));
  return { id: params.id };
});
route("GET", "/center/schedule", ({ user }) => {
  const cid = centerOnly(user);
  const teachers = new Set(db.centerLinks.filter((link) => same(link.center, cid) && link.status === "active").map((link) => link.teacher));
  return db.schedule.filter((slot) => same(slot.center, cid) && teachers.has(slot.teacher)).map(slotView);
});
route("GET", "/center/sessions", ({ user, query }) => {
  const cid = centerOnly(user);
  return db.sessions
    .filter((session) => same(session.center, cid) && inRange(session.date, query.from, query.to))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((session) => ({
      _id: session._id, sequence: session.sequence, week: session.week, number: session.number, date: session.date, status: session.status, active: session.active,
      teacher: teacherPublic(byId("teachers", session.teacher)), presentCount: session.attendance.length, closing: closingTotals(session),
    }));
});
route("GET", "/center/dashboard", ({ user }) => {
  const cid = centerOnly(user);
  const links = db.centerLinks.filter((link) => same(link.center, cid));
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const sessions = db.sessions.filter((session) => same(session.center, cid) && session.status === "normal");
  const thisWeek = sessions.filter((session) => session.date >= weekAgo);
  const today = new Date().getDay();
  const active = new Set(links.filter((link) => link.status === "active").map((link) => link.teacher));
  return {
    counts: {
      teachers: active.size,
      pending: links.filter((link) => link.status === "pending" && link.requestedBy === "teacher").length,
      invitations: links.filter((link) => link.status === "pending" && link.requestedBy === "center").length,
      sessionsThisWeek: thisWeek.length,
      attendanceThisWeek: sum(thisWeek, (session) => session.attendance.length),
      students: new Set(db.enrollments.filter((entry) => same(entry.center, cid) && active.has(entry.teacher) && entry.status === "active" && !entry.archived).map((entry) => entry.student)).size,
    },
    closingsDue: sum(thisWeek, (session) => closingTotals(session)?.total || 0),
    today: db.schedule.filter((slot) => same(slot.center, cid) && slot.dayOfWeek === today && slot.isActive && active.has(slot.teacher)).map(slotView),
    activeSessions: db.sessions.filter((session) => same(session.center, cid) && session.active).map((session) => ({ _id: session._id, sequence: session.sequence, teacher: teacherPublic(byId("teachers", session.teacher)), presentCount: session.attendance.length })),
    byTeacher: [...active].map((tid) => ({ label: name(byId("teachers", tid)), value: sum(sessions.filter((session) => same(session.teacher, tid)), (session) => session.attendance.length) })),
    recentSessions: sessions.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6).map((session) => ({ _id: session._id, sequence: session.sequence, date: session.date, teacher: teacherPublic(byId("teachers", session.teacher)), presentCount: session.attendance.length, closing: closingTotals(session) })),
  };
});

// ---------- Student ----------
const studentOnly = (user) => (user.role === "student" ? user.id : fail(403, "Students only"));
const myEnrollment = (user, teacherId) => {
  const entry = enrollment(teacherId, studentOnly(user));
  if (!entry || entry.status !== "active") fail(403, "You're not subscribed to this teacher yet");
  return entry;
};
route("GET", "/student/profile", ({ user }) => studentPublic(byId("students", studentOnly(user))));
route("PATCH", "/student/profile", ({ user, body }) => {
  const student = byId("students", studentOnly(user));
  Object.assign(student, pickFields(body, ["firstName", "lastName", "parentPhone", "schoolName", "profilepic", "gender"]));
  return studentPublic(student);
});
route("GET", "/student/teachers", ({ user }) =>
  db.enrollments
    .filter((entry) => same(entry.student, studentOnly(user)) && !entry.archived)
    .map((entry) => ({ teacher: teacherPublic(byId("teachers", entry.teacher)), status: entry.status, joinedAt: entry.joinedAt, balance: entry.status === "active" ? entry.balance : null })),
);
route("POST", "/student/teachers/:id/request", ({ user, params }) => {
  const sid = studentOnly(user);
  byId("teachers", params.id) || notFound("Teacher");
  const existing = enrollment(params.id, sid, { includeArchived: true });
  if (existing && !existing.archived) fail(409, existing.status === "active" ? "You're already subscribed" : "Your request is already waiting for approval");
  if (existing) Object.assign(existing, { archived: false, status: "pending", joinedAt: nowIso() });
  else db.enrollments.push({ _id: newId(), teacher: params.id, student: sid, status: "pending", archived: false, balance: 0, points: 0, isBlocked: false, pricePerSession: 80, center: null, adminNote: "", followUpAssistant: null, joinedAt: nowIso() });
  return { status: "pending" };
});
route("DELETE", "/student/teachers/:id/request", ({ user, params }) => {
  const sid = studentOnly(user);
  db.enrollments = db.enrollments.filter((entry) => !(same(entry.teacher, params.id) && same(entry.student, sid) && entry.status === "pending"));
  return { status: "none" };
});
route("GET", "/student/teachers/:id/overview", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  const board = leaderboard(params.id);
  const slots = db.schedule.filter((slot) => same(slot.teacher, params.id) && slot.isActive && (!entry.center || same(slot.center, entry.center)));
  const today = new Date();
  const minutesNow = today.getDay() * 1440 + today.getHours() * 60 + today.getMinutes();
  const nextSlot = slots
    .map((slot) => {
      const [hours, minutes] = slot.startTime.split(":").map(Number);
      let delta = slot.dayOfWeek * 1440 + hours * 60 + minutes - minutesNow;
      if (delta < 0) delta += 7 * 1440;
      return { ...slotView(slot), startsInMinutes: delta };
    })
    .sort((a, b) => a.startsInMinutes - b.startsInMinutes)[0];
  return {
    teacher: teacherPublic(byId("teachers", params.id)),
    balance: entry.balance,
    pricePerSession: entry.pricePerSession,
    points: entry.points,
    rank: board.findIndex((row) => same(row.student._id, entry.student)) + 1,
    classSize: board.length,
    isBlocked: entry.isBlocked,
    centerName: centerName(entry.center),
    warnings: db.warnings.filter((warning) => same(warning.teacher, params.id) && same(warning.student, entry.student)).map((warning) => ({ reason: warning.reason, createdAt: warning.createdAt })),
    nextSlot: nextSlot || null,
    lastSession: studentSessionRows(params.id, entry.student).find((row) => row.status !== "cancelled") || null,
    stats: studentStats(params.id, entry.student),
    announcements: announcementsFor(params.id, entry.student),
    followUp: entry.followUpAssistant ? { name: personRef(entry.followUpAssistant)?.name, phone: byId("assistants", entry.followUpAssistant)?.phone } : null,
  };
});
route("GET", "/student/teachers/:id/sessions", ({ user, params }) => studentSessionRows(params.id, myEnrollment(user, params.id).student));
route("GET", "/student/teachers/:id/lessons", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  const student = byId("students", entry.student);
  return db.lessons
    .filter((lesson) => same(lesson.teacher, params.id) && lesson.published && (!lesson.grade || lesson.grade === student.grade))
    .sort((a, b) => a.week - b.week || a.order - b.order)
    .map((lesson) => ({
      ...pickFields(lesson, ["_id", "title", "description", "week", "order", "isFree", "price"]),
      partsCount: lesson.parts.length,
      questionsCount: lesson.questions.filter((question) => question.isActive).length,
      durationSeconds: sum(lesson.parts, (part) => part.durationSeconds),
      access: lessonAccess(lesson, entry.student),
      watchedSeconds: sum(db.watch.filter((row) => same(row.lesson, lesson._id) && same(row.student, entry.student)), (row) => row.seconds),
    }));
});
const studentLesson = (user, lessonId) => {
  const lesson = byId("lessons", lessonId);
  if (!lesson || !lesson.published) notFound("Lesson");
  const entry = myEnrollment(user, lesson.teacher);
  return { lesson, entry };
};
route("GET", "/student/lessons/:id", ({ user, params }) => {
  const { lesson, entry } = studentLesson(user, params.id);
  const access = lessonAccess(lesson, entry.student);
  const open = ["free", "granted"].includes(access.state);
  const answered = db.answers.filter((answer) => same(answer.lesson, lesson._id) && same(answer.student, entry.student));
  return {
    ...pickFields(lesson, ["_id", "title", "description", "week", "isFree", "price", "accessHours", "viewsIfPaid", "viewsIfAttended"]),
    teacher: teacherPublic(byId("teachers", lesson.teacher)),
    access,
    parts: lesson.parts.map((part) => ({ ...part, url: open ? part.url : null })),
    questions: open
      ? lesson.questions.filter((question) => question.isActive).map((question) => {
          const answer = answered.find((item) => same(item.question, question._id));
          return { ...question, correct: answer ? question.correct : undefined, answer: answer || null };
        })
      : [],
    progress: db.watch.filter((row) => same(row.lesson, lesson._id) && same(row.student, entry.student)),
  };
});
route("POST", "/student/lessons/:id/unlock", ({ user, params }) => {
  const { lesson, entry } = studentLesson(user, params.id);
  const access = lessonAccess(lesson, entry.student);
  if (["free", "granted"].includes(access.state)) return { access };
  const startsAt = new Date();
  const expires = new Date(startsAt.getTime() + lesson.accessHours * 3600000).toISOString();
  if (access.state === "available") {
    db.lessonGrants.push({ _id: newId(), lesson: lesson._id, student: entry.student, method: "attended", maxViews: lesson.viewsIfAttended, viewsUsed: 0, startedAt: startsAt.toISOString(), expiresAt: expires, createdAt: nowIso() });
  } else {
    if (entry.balance < lesson.price) fail(409, `Not enough balance. The lesson costs ${lesson.price} and you have ${entry.balance}.`, { code: "INSUFFICIENT_BALANCE" });
    entry.balance -= lesson.price;
    addTransaction(lesson.teacher, entry.student, -lesson.price, "lesson", `Lesson unlocked · ${lesson.title}`, entry.student);
    db.lessonGrants.push({ _id: newId(), lesson: lesson._id, student: entry.student, method: "paid", maxViews: lesson.viewsIfPaid, viewsUsed: 0, startedAt: startsAt.toISOString(), expiresAt: expires, createdAt: nowIso() });
  }
  return { access: lessonAccess(lesson, entry.student), balance: entry.balance };
});
route("POST", "/student/lessons/:id/progress", ({ user, params, body }) => {
  const { lesson, entry } = studentLesson(user, params.id);
  const access = lessonAccess(lesson, entry.student);
  if (body?.start && access.state === "granted") {
    const grant = byId("lessonGrants", access.grantId);
    grant.viewsUsed += 1;
    if (!grant.startedAt) {
      grant.startedAt = nowIso();
      grant.expiresAt = new Date(Date.now() + (grant.hours || lesson.accessHours) * 3600000).toISOString();
    }
  }
  if (body?.part) {
    const row = db.watch.find((item) => same(item.lesson, lesson._id) && same(item.student, entry.student) && same(item.part, body.part));
    if (row) Object.assign(row, { seconds: Math.max(row.seconds, Number(body.seconds) || 0), updatedAt: nowIso() });
    else db.watch.push({ _id: newId(), lesson: lesson._id, student: entry.student, part: body.part, seconds: Number(body.seconds) || 0, updatedAt: nowIso() });
  }
  return { access: lessonAccess(lesson, entry.student) };
});
route("POST", "/student/questions/:id/answer", ({ user, params, body }) => {
  const lesson = db.lessons.find((item) => item.questions.some((question) => same(question._id, params.id))) || notFound("Question");
  const question = lesson.questions.find((item) => same(item._id, params.id));
  const entry = myEnrollment(user, lesson.teacher);
  const existing = db.answers.find((answer) => same(answer.question, question._id) && same(answer.student, entry.student));
  if (existing) return { ...existing, correct: question.correct };
  const answer = { _id: newId(), question: question._id, lesson: lesson._id, student: entry.student, choice: body?.choice || null, imageUrl: body?.imageUrl || "", createdAt: nowIso() };
  if (question.type === "mcq") {
    if (!body?.choice) fail(400, "Choose an answer");
    Object.assign(answer, { status: "answered", isCorrect: body.choice === question.correct, points: body.choice === question.correct ? question.bonusPoints : 0 });
    entry.points += answer.points;
    if (answer.points) db.pointsLog.push({ _id: newId(), teacher: lesson.teacher, student: entry.student, points: answer.points, reason: `Video question · ${lesson.title}`, by: "system", createdAt: nowIso() });
  } else {
    if (!body?.imageUrl && !body?.text) fail(400, "Upload a photo of your answer");
    Object.assign(answer, { status: "pending", isCorrect: null, points: 0, text: body.text || "" });
  }
  db.answers.push(answer);
  return { ...answer, correct: question.correct };
});
route("GET", "/student/teachers/:id/homework", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  const student = byId("students", entry.student);
  return db.homework
    .filter((hw) => same(hw.teacher, params.id) && (!hw.grade || hw.grade === student.grade))
    .sort((a, b) => b.order - a.order)
    .map((hw) => ({ ...homeworkView(hw), submission: db.submissions.find((sub) => same(sub.homework, hw._id) && same(sub.student, entry.student)) || null }));
});
route("POST", "/student/homework/:id/submit", ({ user, params, body }) => {
  const hw = byId("homework", params.id) || notFound("Homework");
  const entry = myEnrollment(user, hw.teacher);
  if (new Date(hw.endDate).getTime() + DAY < Date.now()) fail(400, "The deadline for this homework has passed");
  const existing = db.submissions.find((sub) => same(sub.homework, hw._id) && same(sub.student, entry.student));
  if (existing && existing.status !== "submitted") fail(409, "Your homework was already corrected");
  if (hw.submissionType === "upload" && !(body?.files || []).length) fail(400, "Upload at least one photo or PDF");
  const data = { files: body.files || [], comment: body.comment || "", link: body.link || "", status: "submitted", submittedAt: nowIso() };
  if (existing) Object.assign(existing, data);
  else db.submissions.push({ _id: newId(), homework: hw._id, student: entry.student, feedback: "", gradedAt: null, gradedBy: null, ...data });
  return { submitted: true };
});
route("GET", "/student/teachers/:id/exams", ({ user, params }) => studentExamRows(params.id, myEnrollment(user, params.id).student));
route("GET", "/student/teachers/:id/booklets", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  const student = byId("students", entry.student);
  return db.booklets
    .filter((booklet) => same(booklet.teacher, params.id) && booklet.isActive && (!booklet.grade || booklet.grade === student.grade))
    .map((booklet) => ({ booklet: pickFields(booklet, ["_id", "name", "sellPrice", "grade", "stock"]), order: db.bookletOrders.filter((order) => same(order.booklet, booklet._id) && same(order.student, entry.student)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null }));
});
route("POST", "/student/booklets/:id/reserve", ({ user, params, body }) => {
  const booklet = byId("booklets", params.id) || notFound("Booklet");
  const entry = myEnrollment(user, booklet.teacher);
  const existing = db.bookletOrders.find((order) => same(order.booklet, booklet._id) && same(order.student, entry.student) && order.status !== "rejected");
  if (existing) fail(409, "You already reserved this booklet");
  if (body?.method === "transfer" && !body.receiptUrl) fail(400, "Upload the transfer receipt");
  const order = { _id: newId(), booklet: booklet._id, student: entry.student, price: booklet.sellPrice, paid: body?.method === "transfer" ? booklet.sellPrice : 0, delivered: false, deliveredAt: null, method: body?.method === "transfer" ? "transfer" : "center", status: "pending", receiptUrl: body?.receiptUrl || "", reference: body?.reference || "", createdAt: nowIso() };
  db.bookletOrders.push(order);
  return order;
});
route("GET", "/student/teachers/:id/transactions", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  return db.transactions.filter((tx) => same(tx.teacher, params.id) && same(tx.student, entry.student)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(transactionView);
});
route("POST", "/student/recharge", ({ user, body }) => {
  const sid = studentOnly(user);
  const code = db.codes.find((item) => item.code.toLowerCase() === String(body?.code || "").trim().toLowerCase());
  if (!code) fail(404, "This code doesn't exist. Check it and try again.");
  if (code.used) fail(409, "This code was already used");
  const entry = enrollment(code.teacher, sid);
  if (!entry || entry.status !== "active") fail(403, "This code belongs to a teacher you're not subscribed to");
  Object.assign(code, { used: true, usedBy: sid, usedAt: nowIso() });
  entry.balance += code.amount;
  addTransaction(code.teacher, sid, code.amount, "recharge", `Recharge code ${code.code}`, sid);
  return { amount: code.amount, balance: entry.balance, teacher: teacherPublic(byId("teachers", code.teacher)) };
});
route("POST", "/student/teachers/:id/topups", ({ user, params, body }) => {
  const entry = myEnrollment(user, params.id);
  required(body, ["amount", "receiptUrl"]);
  if (body.reference && db.topups.some((topup) => topup.reference && topup.reference === body.reference)) fail(409, "This transfer reference was already submitted");
  const topup = { _id: newId(), teacher: params.id, student: entry.student, amount: Number(body.amount), method: body.method || "Transfer", reference: body.reference || "", receiptUrl: body.receiptUrl, status: "pending", reason: "", createdAt: nowIso() };
  db.topups.push(topup);
  return topup;
});
route("GET", "/student/teachers/:id/leaderboard", ({ user, params }) => {
  const entry = myEnrollment(user, params.id);
  return leaderboard(params.id).map((row) => ({
    rank: row.rank,
    name: same(row.student._id, entry.student) ? name(row.student) : `${row.student.firstName} ${String(row.student.lastName || "").charAt(0)}.`,
    points: row.points,
    isMe: same(row.student._id, entry.student),
    centerName: row.centerName,
  }));
});
route("GET", "/student/topups", ({ user }) => db.topups.filter((topup) => same(topup.student, studentOnly(user))));

// ---------- Parent ----------
const parentOnly = (user) => (user.role === "parent" ? user.record : fail(403, "Parents only"));
const childView = (studentId) => {
  const student = byId("students", studentId);
  return {
    ...studentPublic(student),
    teachers: db.enrollments.filter((entry) => same(entry.student, studentId) && entry.status === "active" && !entry.archived).map((entry) => teacherPublic(byId("teachers", entry.teacher))),
  };
};
route("GET", "/parent/profile", ({ user }) => {
  const parent = parentOnly(user);
  return { _id: parent._id, name: parent.name, phone: parent.phone, children: parent.children.map(childView) };
});
route("POST", "/parent/children", ({ user, body }) => {
  const parent = parentOnly(user);
  const student = db.students.find((item) => item.userID.toLowerCase() === String(body?.code || "").trim().toLowerCase()) || notFound("Student");
  if (student.parentPhone !== parent.phone) fail(403, "This student registered a different parent phone number");
  if (parent.children.includes(student._id)) fail(409, "This child is already linked");
  parent.children.push(student._id);
  return childView(student._id);
});
route("DELETE", "/parent/children/:id", ({ user, params }) => {
  const parent = parentOnly(user);
  parent.children = parent.children.filter((child) => !same(child, params.id));
  return { id: params.id };
});
route("GET", "/parent/children/:id/report", ({ user, params, query }) => {
  const parent = parentOnly(user);
  if (!parent.children.some((child) => same(child, params.id))) notFound("Child");
  const teachers = db.enrollments.filter((entry) => same(entry.student, params.id) && entry.status === "active" && !entry.archived);
  const entry = teachers.find((item) => same(item.teacher, query.teacher)) || teachers[0];
  if (!entry) return { student: childView(params.id), teachers: [], teacher: null };
  const comment = db.followComments.filter((item) => same(item.teacher, entry.teacher) && same(item.student, params.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return {
    student: childView(params.id),
    teachers: teachers.map((item) => teacherPublic(byId("teachers", item.teacher))),
    teacher: teacherPublic(byId("teachers", entry.teacher)),
    balance: entry.balance,
    points: entry.points,
    isBlocked: entry.isBlocked,
    centerName: centerName(entry.center),
    stats: studentStats(entry.teacher, params.id),
    sessions: studentSessionRows(entry.teacher, params.id),
    exams: studentExamRows(entry.teacher, params.id),
    transactions: db.transactions.filter((tx) => same(tx.teacher, entry.teacher) && same(tx.student, params.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30).map(transactionView),
    warnings: db.warnings.filter((warning) => same(warning.teacher, entry.teacher) && same(warning.student, params.id)).map((warning) => ({ reason: warning.reason, createdAt: warning.createdAt })),
    followUp: {
      assistant: entry.followUpAssistant ? { name: personRef(entry.followUpAssistant)?.name, phone: byId("assistants", entry.followUpAssistant)?.phone } : null,
      lastComment: comment ? { comment: comment.comment, createdAt: comment.createdAt } : null,
      teacherPhone: byId("teachers", entry.teacher)?.phone,
    },
  };
});

// Expose a couple of handlers for internal reuse (bulk import).
const handlers = {
  createStudent: ({ user, body }) => routes.find((item) => item.method === "POST" && item.regex.test("/teacher/myStudents")).handler({ user, body, params: {}, query: {} }),
};

// ---------- entry point ----------
export async function handle(method, url, body) {
  await new Promise((resolve) => window.setTimeout(resolve, 120 + Math.random() * 160));
  const [path, search = ""] = url.split("?");
  const query = Object.fromEntries(new URLSearchParams(search));
  const match = routes.map((item) => ({ item, found: item.method === method && path.match(item.regex) })).find(({ found }) => found);
  if (!match) throw new ApiError(`This feature is waiting for the backend endpoint ${method} ${path}.`, { status: 404, missing: true });
  const params = Object.fromEntries(match.item.keys.map((key, index) => [key, decodeURIComponent(match.found[index + 1])]));
  const user = currentUser();
  const result = await match.item.handler({ user, params, query, body: body || {} });
  persist();
  return clone(result);
}
