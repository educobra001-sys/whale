// Compatibility shims: when a newer endpoint isn't implemented yet (404), rebuild its response
// from endpoints the current backend already has (/teacher/myStudents, /teacher/sessions).
// Safe to delete once the backend implements the real endpoints.

const same = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);

export async function sessionFromList(teacherApi, sessionId) {
  const sessions = (await teacherApi.sessions()) || [];
  const session = sessions.find((item) => same(item, sessionId));
  if (!session) throw new Error("Session not found");
  return normalizeSession(session);
}

export function normalizeSession(session) {
  const attendance = (session.attendance || []).map((row) => ({
    ...row,
    student: typeof row.student === "object" ? row.student : { _id: row.student },
    payment: row.payment || 0,
    charged: row.charged || 0,
  }));
  return { staff: [], closing: null, status: "normal", ...session, attendance, presentCount: attendance.length };
}

export async function lookupFromLists(teacherApi, identifier) {
  const needle = String(identifier || "").trim().toLowerCase();
  const [students, sessions] = await Promise.all([teacherApi.students(), teacherApi.sessions()]);
  const student = (students || []).find((item) => [item._id, item.userID, item.phone].some((value) => String(value || "").toLowerCase() === needle));
  if (!student) throw new Error("No student in your class matches that code");
  const active = (sessions || []).find((session) => session.active);
  const row = active?.attendance?.find((item) => same(item.student, student));
  return {
    student: { balance: 0, ...student },
    activeSession: active || null,
    attended: Boolean(row),
    attendance: row || null,
    price: student.pricePerSession ?? active?.price ?? 0,
    allowed: !student.isBlocked,
    reasons: student.isBlocked ? ["Student is blocked"] : [],
    warnings: [],
    booklets: [],
    lastSessions: [],
  };
}

export async function historyFromSessions(teacherApi, studentId) {
  const sessions = (await teacherApi.sessions()) || [];
  const attendance = sessions.map((session) => {
    const row = (session.attendance || []).find((item) => same(item.student, studentId));
    return {
      session: { _id: session._id, sequence: session.sequence, week: session.week, number: session.number, date: session.date || session.createdAt },
      status: row ? "present" : session.active ? "pending" : "absent",
      markedAt: row?.markedAt || null,
      payment: row?.payment || 0,
      comment: row?.comment || "",
      homeworkStatus: row?.homeworkStatus || null,
      markedBy: null,
    };
  });
  const present = attendance.filter((row) => row.status === "present").length;
  const counted = attendance.filter((row) => row.status !== "pending").length;
  return {
    attendance,
    exams: [],
    homework: [],
    transactions: [],
    warnings: [],
    points: [],
    booklets: [],
    lessons: [],
    stats: { present, absent: counted - present, attendanceRate: counted ? Math.round((present / counted) * 100) : 0, homeworkRate: 0, examAvg: 0 },
  };
}

export async function dashboardFromLists(teacherApi) {
  const [students, sessions] = await Promise.all([teacherApi.students(), teacherApi.sessions()]);
  const list = students || [];
  const all = (sessions || []).map(normalizeSession);
  const lowBalance = list.filter((student) => (student.balance ?? 0) < (student.pricePerSession ?? 0));
  const byGrade = new Map();
  for (const student of list) {
    const label = ["S1", "S2", "S3"][Number(student.grade)] || "Unassigned";
    byGrade.set(label, (byGrade.get(label) || 0) + 1);
  }
  return {
    counts: { students: list.length, assistants: 0, centers: 0, pendingRequests: 0, pendingTopups: 0, pendingSubmissions: 0, lowBalance: lowBalance.length, blocked: list.filter((student) => student.isBlocked).length },
    totalBalance: list.reduce((total, student) => total + (Number(student.balance) || 0), 0),
    activeSession: all.find((session) => session.active) || null,
    todaySlots: [],
    attendanceTrend: all.slice(0, 8).reverse().map((session) => ({ label: `#${session.number}`, value: session.attendance.length })),
    byCenter: [],
    byGrade: [...byGrade].map(([label, value]) => ({ label, value })),
    lowBalanceStudents: lowBalance.slice(0, 6),
    recent: [],
  };
}
