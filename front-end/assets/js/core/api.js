// Single source of truth for every backend call the front-end makes.
// Every response is expected in the backend's envelope: { message, data }.
// Endpoints marked "existing" are already implemented in src/; everything else is the
// contract the backend still needs to implement (see FRONTEND_REPORT.md).
import { API_BASE } from "./config.js";
import { getRole, isDemo, logout, refreshAccessToken, validAccessToken } from "./session.js";

export class ApiError extends Error {
  constructor(message, { status = 0, missing = false, details } = {}) {
    super(message);
    this.status = status;
    this.missing = missing;
    this.details = details;
  }
}

const isAuthFailure = (status, message = "") =>
  status === 401 ||
  (status === 400 && /token|session time expired/i.test(message) && !/refresh/i.test(message));

function toQuery(params) {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function send(method, path, { body, query, auth = true, form } = {}) {
  const url = `${path}${toQuery(query)}`;
  if (isDemo()) {
    const mock = await import("../mock/server.js");
    return mock.handle(method, url, form ? Object.fromEntries(form.entries()) : body, getRole());
  }

  const doFetch = async (token) => {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }
    return fetch(`${API_BASE}${url}`, { method, headers, body: payload });
  };

  let response;
  try {
    response = await doFetch(auth ? await validAccessToken() : null);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (auth && isAuthFailure(response.status, result?.message)) {
    try {
      response = await doFetch(await refreshAccessToken());
      result = await response.json().catch(() => null);
    } catch {
      logout();
      throw new ApiError("Your session expired. Please sign in again.", { status: 401 });
    }
  }

  if (!result) {
    if (response.status === 404) {
      throw new ApiError(`This feature is waiting for the backend endpoint ${method} ${path}.`, {
        status: 404,
        missing: true,
      });
    }
    throw new ApiError("The server returned an unreadable response.", { status: response.status });
  }
  if (!response.ok) {
    if (response.status === 403) {
      throw new ApiError(result.message || "You don't have permission to do that.", { status: 403 });
    }
    throw new ApiError(result.message || "The request could not be completed.", {
      status: response.status,
      details: result.cause,
    });
  }
  return result.data;
}

// Try an endpoint; if the backend doesn't have it yet (404 "missing"), use a fallback built from older endpoints.
const orFallback = (primary, fallback) =>
  primary().catch((error) => {
    if (error instanceof ApiError && error.missing) return fallback();
    throw error;
  });
const shims = () => import("./fallbacks.js");

const get = (path, query) => send("GET", path, { query });
const post = (path, body) => send("POST", path, { body });
const patch = (path, body) => send("PATCH", path, { body });
const put = (path, body) => send("PUT", path, { body });
const del = (path, body) => send("DELETE", path, { body });
const id = (value) => encodeURIComponent(value);

export const api = {
  // ---------- Auth (public) ----------
  auth: {
    signup: (role, body) => send("POST", `/signup/${role}`, { body, auth: false }), // existing: teacher, student, center. new: parent
    login: (role, body) => send("POST", `/login/${role}`, { body, auth: false }), // existing: teacher, student, center. new: assistant, parent
    verify: (body) => send("POST", "/verify-acc", { body, auth: false }), // existing (teacher email OTP)
    resendOtp: (body) => send("POST", "/resend-otp", { body, auth: false }),
    forgotPassword: (role, body) => send("POST", `/forgot-password/${role}`, { body, auth: false }),
    resetPassword: (role, body) => send("POST", `/reset-password/${role}`, { body, auth: false }),
  },

  // ---------- Shared ----------
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return send("POST", "/uploads", { form });
  },
  directory: {
    teachers: (query) => get("/teachers/search", query), // public teacher directory: q, subject, grade
    teacher: (teacherId) => get(`/teachers/${id(teacherId)}`),
    centers: (query) => get("/centers/search", query),
  },
  changePassword: (role, body) => patch(`/${role}/password`, body),

  // ---------- Teacher (assistants call the same /teacher routes with their own token) ----------
  teacher: {
    profile: () => get("/teacher/profile"), // existing
    updateProfile: (body) => patch("/teacher/profile", body), // existing
    deleteAccount: () => del("/teacher/profile"), // existing
    dashboard: () => orFallback(() => get("/teacher/dashboard"), async () => (await shims()).dashboardFromLists(api.teacher)),

    students: () => get("/teacher/myStudents"), // existing (must also return enrollment fields)
    student: (studentId) => get(`/teacher/myStudents/${id(studentId)}`), // existing
    updateStudent: (studentId, body) => patch(`/teacher/myStudents/${id(studentId)}`, body), // existing
    createStudent: (body) => post("/teacher/myStudents", body),
    linkStudent: (body) => post("/teacher/myStudents/link", body),
    importStudents: (students) => post("/teacher/myStudents/import", { students }),
    removeStudent: (studentId, body) => del(`/teacher/myStudents/${id(studentId)}`, body),
    studentHistory: (studentId) =>
      orFallback(() => get(`/teacher/myStudents/${id(studentId)}/history`), async () => (await shims()).historyFromSessions(api.teacher, studentId)),
    adjustBalance: (studentId, body) => post(`/teacher/myStudents/${id(studentId)}/balance`, body),
    addPoints: (studentId, body) => post(`/teacher/myStudents/${id(studentId)}/points`, body),
    addWarning: (studentId, body) => post(`/teacher/myStudents/${id(studentId)}/warnings`, body),
    removeWarning: (studentId, warningId) =>
      del(`/teacher/myStudents/${id(studentId)}/warnings/${id(warningId)}`),
    setBlocked: (studentId, blocked) => patch(`/teacher/myStudents/${id(studentId)}/block`, { blocked }),
    joinRequests: () => get("/teacher/requests"),
    answerRequest: (requestId, status) => patch(`/teacher/requests/${id(requestId)}`, { status }),
    archive: () => get("/teacher/archive"),
    restoreStudent: (studentId) => post(`/teacher/archive/${id(studentId)}/restore`),

    sessions: (query) => get("/teacher/sessions", query), // existing
    session: (sessionId) =>
      orFallback(() => get(`/teacher/sessions/${id(sessionId)}`), async () => (await shims()).sessionFromList(api.teacher, sessionId)),
    createSession: (body) => post("/teacher/sessions", body), // existing (extra optional fields are new)
    updateSession: (sessionId, body) => patch(`/teacher/sessions/${id(sessionId)}`, body),
    deleteSession: (sessionId) => del(`/teacher/sessions/${id(sessionId)}`),
    setSessionActive: (sessionId, active) => patch(`/teacher/sessions/${id(sessionId)}/active`, { active }), // existing
    markAttendance: (sessionId, body) => post(`/teacher/sessions/${id(sessionId)}/attendance`, body), // existing ({identifier}); extra fields new
    updateAttendance: (sessionId, studentId, body) =>
      patch(`/teacher/sessions/${id(sessionId)}/attendance/${id(studentId)}`, body),
    removeAttendance: (sessionId, studentId) =>
      del(`/teacher/sessions/${id(sessionId)}/attendance/${id(studentId)}`),
    checkHomework: (sessionId, body) => post(`/teacher/sessions/${id(sessionId)}/homework`, body),
    saveClosing: (sessionId, body) => put(`/teacher/sessions/${id(sessionId)}/closing`, body),
    staffCheckIn: (sessionId, body) => post(`/teacher/sessions/${id(sessionId)}/staff`, body),
    staffUpdate: (sessionId, entryId, body) =>
      patch(`/teacher/sessions/${id(sessionId)}/staff/${id(entryId)}`, body),
    staffRemove: (sessionId, entryId) => del(`/teacher/sessions/${id(sessionId)}/staff/${id(entryId)}`),
    scanLookup: (identifier) =>
      orFallback(() => get("/teacher/scan/lookup", { identifier }), async () => (await shims()).lookupFromLists(api.teacher, identifier)),

    schedule: () => get("/teacher/schedule"),
    createSlot: (body) => post("/teacher/schedule", body),
    updateSlot: (slotId, body) => patch(`/teacher/schedule/${id(slotId)}`, body),
    deleteSlot: (slotId) => del(`/teacher/schedule/${id(slotId)}`),
    startSlot: (slotId, body) => post(`/teacher/schedule/${id(slotId)}/start`, body),

    exams: () => get("/teacher/exams"),
    exam: (examId) => get(`/teacher/exams/${id(examId)}`),
    createExam: (body) => post("/teacher/exams", body),
    updateExam: (examId, body) => patch(`/teacher/exams/${id(examId)}`, body),
    deleteExam: (examId) => del(`/teacher/exams/${id(examId)}`),
    saveScores: (examId, scores) => put(`/teacher/exams/${id(examId)}/scores`, { scores }),

    homework: () => get("/teacher/homework"),
    createHomework: (body) => post("/teacher/homework", body),
    updateHomework: (homeworkId, body) => patch(`/teacher/homework/${id(homeworkId)}`, body),
    deleteHomework: (homeworkId) => del(`/teacher/homework/${id(homeworkId)}`),
    submissions: (homeworkId) => get(`/teacher/homework/${id(homeworkId)}/submissions`),
    gradeSubmission: (submissionId, body) => patch(`/teacher/homework/submissions/${id(submissionId)}`, body),

    lessons: () => get("/teacher/lessons"),
    lesson: (lessonId) => get(`/teacher/lessons/${id(lessonId)}`),
    createLesson: (body) => post("/teacher/lessons", body),
    updateLesson: (lessonId, body) => patch(`/teacher/lessons/${id(lessonId)}`, body),
    deleteLesson: (lessonId) => del(`/teacher/lessons/${id(lessonId)}`),
    grantLesson: (lessonId, body) => post(`/teacher/lessons/${id(lessonId)}/grants`, body),
    revokeLesson: (lessonId, grantId) => del(`/teacher/lessons/${id(lessonId)}/grants/${id(grantId)}`),
    lessonAnswers: (lessonId) => get(`/teacher/lessons/${id(lessonId)}/answers`),
    gradeAnswer: (answerId, body) => patch(`/teacher/lessons/answers/${id(answerId)}`, body),

    booklets: () => get("/teacher/booklets"),
    createBooklet: (body) => post("/teacher/booklets", body),
    updateBooklet: (bookletId, body) => patch(`/teacher/booklets/${id(bookletId)}`, body),
    deleteBooklet: (bookletId) => del(`/teacher/booklets/${id(bookletId)}`),
    bookletOrders: () => get("/teacher/booklets/orders"),
    createBookletOrder: (body) => post("/teacher/booklets/orders", body),
    updateBookletOrder: (orderId, body) => patch(`/teacher/booklets/orders/${id(orderId)}`, body),

    rechargeCodes: () => get("/teacher/recharge-codes"),
    generateCodes: (body) => post("/teacher/recharge-codes", body),
    deleteCode: (codeId) => del(`/teacher/recharge-codes/${id(codeId)}`),
    topups: () => get("/teacher/topups"),
    reviewTopup: (topupId, body) => patch(`/teacher/topups/${id(topupId)}`, body),
    transactions: (query) => get("/teacher/transactions", query),

    announcements: () => get("/teacher/announcements"),
    createAnnouncement: (body) => post("/teacher/announcements", body),
    updateAnnouncement: (announcementId, body) => patch(`/teacher/announcements/${id(announcementId)}`, body),
    deleteAnnouncement: (announcementId) => del(`/teacher/announcements/${id(announcementId)}`),

    followUp: (query) => get("/teacher/follow-up", query),
    followUpComment: (body) => post("/teacher/follow-up/comments", body),
    assignFollowUp: (body) => put("/teacher/follow-up/assign", body),

    assistants: () => get("/teacher/assistants"), // existing (currently broken: Teacher schema has no `assistants` field)
    addAssistant: (body) => post("/teacher/assistants", body), // existing
    updateAssistant: (assistantId, body) => patch(`/teacher/assistants/${id(assistantId)}`, body),
    removeAssistant: (assistantId) => del(`/teacher/assistants/${id(assistantId)}`),
    assistantStats: (assistantId) => get(`/teacher/assistants/${id(assistantId)}/stats`),

    centers: () => get("/teacher/centers"),
    requestCenter: (centerId) => post(`/teacher/centers/${id(centerId)}/request`),
    answerCenter: (centerId, status) => patch(`/teacher/centers/${id(centerId)}`, { status }),
    leaveCenter: (centerId) => del(`/teacher/centers/${id(centerId)}`),

    finance: (query) => get("/teacher/finance", query),
    expenses: (query) => get("/teacher/expenses", query),
    addExpense: (body) => post("/teacher/expenses", body),
    deleteExpense: (expenseId) => del(`/teacher/expenses/${id(expenseId)}`),

    leaderboard: () => get("/teacher/leaderboard"),
  },

  // ---------- Assistant (own account only; teaching data goes through api.teacher) ----------
  assistant: {
    profile: () => get("/assistant/profile"),
    updateProfile: (body) => patch("/assistant/profile", body),
    workLog: () => get("/assistant/work-log"),
  },

  // ---------- Learning center ----------
  center: {
    profile: () => get("/center/profile"),
    updateProfile: (body) => patch("/center/profile", body),
    dashboard: () => get("/center/dashboard"),
    teachers: () => get("/center/teachers"),
    inviteTeacher: (body) => post("/center/teachers/invite", body),
    answerTeacher: (teacherId, status) => patch(`/center/teachers/${id(teacherId)}`, { status }),
    removeTeacher: (teacherId) => del(`/center/teachers/${id(teacherId)}`),
    schedule: () => get("/center/schedule"),
    sessions: (query) => get("/center/sessions", query),
  },

  // ---------- Student ----------
  student: {
    profile: () => get("/student/profile"),
    updateProfile: (body) => patch("/student/profile", body),
    teachers: () => get("/student/teachers"),
    requestTeacher: (teacherId) => post(`/student/teachers/${id(teacherId)}/request`),
    cancelRequest: (teacherId) => del(`/student/teachers/${id(teacherId)}/request`),
    overview: (teacherId) => get(`/student/teachers/${id(teacherId)}/overview`),
    sessions: (teacherId) => get(`/student/teachers/${id(teacherId)}/sessions`),
    lessons: (teacherId) => get(`/student/teachers/${id(teacherId)}/lessons`),
    lesson: (lessonId) => get(`/student/lessons/${id(lessonId)}`),
    unlockLesson: (lessonId) => post(`/student/lessons/${id(lessonId)}/unlock`),
    lessonProgress: (lessonId, body) => post(`/student/lessons/${id(lessonId)}/progress`, body),
    answerQuestion: (questionId, body) => post(`/student/questions/${id(questionId)}/answer`, body),
    homework: (teacherId) => get(`/student/teachers/${id(teacherId)}/homework`),
    submitHomework: (homeworkId, body) => post(`/student/homework/${id(homeworkId)}/submit`, body),
    exams: (teacherId) => get(`/student/teachers/${id(teacherId)}/exams`),
    booklets: (teacherId) => get(`/student/teachers/${id(teacherId)}/booklets`),
    reserveBooklet: (bookletId, body) => post(`/student/booklets/${id(bookletId)}/reserve`, body),
    transactions: (teacherId) => get(`/student/teachers/${id(teacherId)}/transactions`),
    recharge: (code) => post("/student/recharge", { code }),
    topup: (teacherId, body) => post(`/student/teachers/${id(teacherId)}/topups`, body),
    leaderboard: (teacherId) => get(`/student/teachers/${id(teacherId)}/leaderboard`),
  },

  // ---------- Parent ----------
  parent: {
    profile: () => get("/parent/profile"),
    linkChild: (body) => post("/parent/children", body),
    unlinkChild: (studentId) => del(`/parent/children/${id(studentId)}`),
    report: (studentId, teacherId) => get(`/parent/children/${id(studentId)}/report`, { teacher: teacherId }),
  },
};
