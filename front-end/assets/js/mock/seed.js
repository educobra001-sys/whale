// Sample data for demo mode. Shapes mirror what the real backend is expected to store.
// Demo accounts: teacher t1, assistant a1 (admin) / a2 (limited), center c1, student s1, parent p1.

const DAY = 86_400_000;

function rng(seed) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function seed() {
  const random = rng(42);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const now = Date.now();
  const ago = (days, hour = 16) => {
    const value = new Date(now - days * DAY);
    value.setHours(hour, 0, 0, 0);
    return value.toISOString();
  };

  const centers = [
    { _id: "c1", name: "Nile Learning Center", phone: "01001234567", localphone: "0222601234", textlocation: "12 Abbas El Akkad St, Nasr City", Maplocation: "https://maps.google.com/?q=Nasr+City", createdAt: ago(300) },
    { _id: "c2", name: "Horizon Academy", phone: "01112223344", localphone: "0224150000", textlocation: "5 El Merghany St, Heliopolis", Maplocation: "https://maps.google.com/?q=Heliopolis", createdAt: ago(280) },
    { _id: "c3", name: "Bright Minds Center", phone: "01223334455", localphone: "", textlocation: "Road 9, Maadi", Maplocation: "", createdAt: ago(200) },
  ];

  const teachers = [
    { _id: "t1", userName: "ahmed.hassan", firstName: "Ahmed", lastName: "Hassan", email: "ahmed@example.com", phone: "01011112222", companyName: "Hassan Math Academy", subject: ["Math"], teachingLanguage: "Arabic", gender: "male", bio: "Secondary-school math with weekly exams and video lessons.", confirmEmail: true, createdAt: ago(320) },
    { _id: "t2", userName: "mona.adel", firstName: "Mona", lastName: "Adel", email: "mona@example.com", phone: "01022223333", companyName: "Physics with Mona", subject: ["Physics"], teachingLanguage: "English", gender: "female", bio: "Physics for S2 and S3, experiments every week.", confirmEmail: true, createdAt: ago(250) },
    { _id: "t3", userName: "karim.fathy", firstName: "Karim", lastName: "Fathy", email: "karim@example.com", phone: "01033334444", companyName: "", subject: ["Chemistry"], teachingLanguage: "Arabic", gender: "male", bio: "Organic and inorganic chemistry made simple.", confirmEmail: true, createdAt: ago(190) },
    { _id: "t4", userName: "sara.nabil", firstName: "Sara", lastName: "Nabil", email: "sara@example.com", phone: "01044445555", companyName: "Sara's English Club", subject: ["English"], teachingLanguage: "English", gender: "female", bio: "Grammar, writing and speaking for all secondary grades.", confirmEmail: true, createdAt: ago(150) },
  ];

  const centerLinks = [
    { _id: "cl1", teacher: "t1", center: "c1", status: "active", requestedBy: "teacher", createdAt: ago(300) },
    { _id: "cl2", teacher: "t1", center: "c2", status: "active", requestedBy: "center", createdAt: ago(260) },
    { _id: "cl3", teacher: "t1", center: "c3", status: "pending", requestedBy: "center", createdAt: ago(3) },
    { _id: "cl4", teacher: "t2", center: "c1", status: "active", requestedBy: "teacher", createdAt: ago(240) },
    { _id: "cl5", teacher: "t3", center: "c1", status: "pending", requestedBy: "teacher", createdAt: ago(1) },
    { _id: "cl6", teacher: "t4", center: "c2", status: "active", requestedBy: "teacher", createdAt: ago(140) },
  ];

  const assistants = [
    { _id: "a1", teacher: "t1", userName: "omar.khaled", firstName: "Omar", lastName: "Khaled", email: "omar@example.com", phone: "01055556666", role: "Admin", permissions: [], salary: { type: "per_session", amount: 150 }, createdAt: ago(200) },
    { _id: "a2", teacher: "t1", userName: "nour.samir", firstName: "Nour", lastName: "Samir", email: "nour@example.com", phone: "01066667777", role: "Assistant", permissions: ["dashboard", "students_view", "sessions_view", "scan_attendance", "scan_homework", "door_check", "follow_up", "warnings"], salary: { type: "hourly", amount: 60 }, createdAt: ago(120) },
  ];

  const firstNames = ["Youssef", "Mariam", "Omar", "Salma", "Ali", "Farida", "Hamza", "Jana", "Ziad", "Malak", "Adam", "Habiba", "Seif", "Nour", "Mostafa", "Laila", "Karim", "Hana", "Yassin", "Rana", "Marwan", "Judy", "Khaled", "Mai"];
  const lastNames = ["Ali", "Mahmoud", "Ibrahim", "Hassan", "Mostafa", "Saleh", "Fouad", "Gamal", "Sherif", "Tarek", "Adel", "Nasser"];
  const schools = ["El Orman Language School", "Port Said School", "Nefertari Girls School", "Manor House School", "El Nasr Boys School"];

  const students = firstNames.map((firstName, index) => ({
    _id: `s${index + 1}`,
    userID: `STU-${String(index + 1).padStart(6, "0")}`,
    firstName,
    lastName: index === 0 ? "Ali" : pick(lastNames),
    phone: `0127${String(1000000 + index * 7919).slice(0, 7)}`,
    parentPhone: `0100${String(2000000 + index * 6151).slice(0, 7)}`,
    gender: ["Mariam", "Salma", "Farida", "Jana", "Malak", "Habiba", "Nour", "Laila", "Hana", "Rana", "Judy", "Mai"].includes(firstName) ? "female" : "male",
    grade: index < 14 ? "2" : index < 20 ? "1" : "0",
    schoolName: pick(schools),
    learningLanguage: index % 3 === 0 ? "1" : "0",
    profilepic: "",
    createdAt: ago(200 - index),
  }));

  const enrollments = [];
  students.forEach((student, index) => {
    const status = index >= 22 ? "pending" : "active";
    enrollments.push({
      _id: `e${index + 1}`,
      teacher: "t1",
      student: student._id,
      status,
      archived: index === 20 || index === 21,
      removedAt: index === 20 || index === 21 ? ago(10) : null,
      removedReason: index === 20 ? "Moved to another city" : index === 21 ? "Stopped attending" : "",
      balance: index === 0 ? 240 : Math.round(random() * 400) - 60,
      points: Math.round(random() * 180),
      isBlocked: index === 9,
      pricePerSession: index % 5 === 0 ? 60 : 80,
      center: student.grade === "2" ? "c1" : "c2",
      adminNote: index === 3 ? "Pays monthly — remind the parent at the start of each month." : "",
      followUpAssistant: index % 3 === 0 ? "a2" : index % 3 === 1 ? "a1" : null,
      joinedAt: ago(180 - index),
    });
  });
  // Student s1 also learns with Mona (Physics), and has a pending request with Sara (English).
  enrollments.push({ _id: "e101", teacher: "t2", student: "s1", status: "active", archived: false, balance: 120, points: 45, isBlocked: false, pricePerSession: 90, center: "c1", adminNote: "", followUpAssistant: null, joinedAt: ago(90) });
  enrollments.push({ _id: "e102", teacher: "t4", student: "s1", status: "pending", archived: false, balance: 0, points: 0, isBlocked: false, pricePerSession: 70, center: null, adminNote: "", followUpAssistant: null, joinedAt: ago(2) });
  for (const index of [1, 2, 4, 5]) {
    enrollments.push({ _id: `e2${index}`, teacher: "t2", student: `s${index + 1}`, status: "active", archived: false, balance: 60, points: 20, isBlocked: false, pricePerSession: 90, center: "c1", adminNote: "", followUpAssistant: null, joinedAt: ago(80) });
  }

  const parents = [{ _id: "p1", name: "Ali Mahmoud", phone: students[0].parentPhone, children: ["s1"], createdAt: ago(150) }];

  const schedule = [
    { _id: "sl1", teacher: "t1", dayOfWeek: 0, startTime: "16:00", durationMinutes: 120, center: "c1", grade: "2", title: "S3 · Group A", isActive: true, notes: "Hall 2" },
    { _id: "sl2", teacher: "t1", dayOfWeek: 2, startTime: "16:00", durationMinutes: 120, center: "c1", grade: "2", title: "S3 · Group A", isActive: true, notes: "Hall 2" },
    { _id: "sl3", teacher: "t1", dayOfWeek: 1, startTime: "18:00", durationMinutes: 90, center: "c2", grade: "1", title: "S2 · Heliopolis", isActive: true, notes: "" },
    { _id: "sl4", teacher: "t1", dayOfWeek: 4, startTime: "18:00", durationMinutes: 90, center: "c2", grade: "1", title: "S2 · Heliopolis", isActive: true, notes: "" },
    { _id: "sl5", teacher: "t1", dayOfWeek: 6, startTime: "12:00", durationMinutes: 90, center: "c1", grade: "0", title: "S1 · Foundations", isActive: false, notes: "Starts next term" },
    { _id: "sl6", teacher: "t2", dayOfWeek: 3, startTime: "17:00", durationMinutes: 120, center: "c1", grade: "2", title: "Physics S3", isActive: true, notes: "" },
    { _id: "sl7", teacher: "t4", dayOfWeek: 5, startTime: "11:00", durationMinutes: 90, center: "c2", grade: "1", title: "English S2", isActive: true, notes: "" },
  ];

  const topics = ["Limits and continuity", "Derivatives: first principles", "Product and quotient rules", "Chain rule", "Applications of derivatives", "Integration basics", "Definite integrals", "Area under curves", "Vectors in space", "Matrices review"];
  const homeworkStatuses = ["complete", "complete", "complete", "incomplete", "no_steps", "not_done"];
  const sessions = [];
  const transactions = [];
  let txCounter = 1;
  const activeEnrollments = enrollments.filter((entry) => entry.teacher === "t1" && entry.status === "active" && !entry.archived);

  for (let index = 0; index < 10; index += 1) {
    const isS3 = index % 2 === 0;
    const daysAgo = 33 - index * 3.5;
    const date = ago(Math.round(daysAgo), isS3 ? 16 : 18);
    const center = isS3 ? "c1" : "c2";
    const grade = isS3 ? "2" : "1";
    const roster = activeEnrollments.filter((entry) => entry.center === center);
    const attendance = [];
    for (const entry of roster) {
      if (random() < 0.18) continue;
      const payment = random() < 0.3 ? entry.pricePerSession * (random() < 0.5 ? 1 : 4) : 0;
      attendance.push({
        student: entry.student,
        markedAt: new Date(new Date(date).getTime() + Math.round(random() * 25) * 60000).toISOString(),
        payment,
        charged: entry.pricePerSession,
        comment: random() < 0.08 ? "Came late" : "",
        homeworkStatus: index === 9 ? null : pick(homeworkStatuses),
        markedBy: random() < 0.5 ? "a2" : "t1",
        location: center,
      });
      transactions.push({ _id: `tx${txCounter++}`, teacher: "t1", student: entry.student, amount: -entry.pricePerSession, type: "attendance", reason: `Session · Week ${Math.floor(index / 2) + 1} #${index + 1}`, session: `ss${index + 1}`, by: "t1", createdAt: date });
      if (payment) transactions.push({ _id: `tx${txCounter++}`, teacher: "t1", student: entry.student, amount: payment, type: "payment", reason: "Cash paid at attendance", session: `ss${index + 1}`, by: "a2", createdAt: date });
    }
    sessions.push({
      _id: `ss${index + 1}`,
      teacher: "t1",
      sequence: topics[index],
      week: Math.floor(index / 2) + 1,
      number: index + 1,
      date,
      center,
      grade,
      price: 80,
      status: index === 3 ? "cancelled" : "normal",
      active: false,
      attendance: index === 3 ? [] : attendance,
      staff: index < 9 ? [{ _id: `st${index}`, assistant: "a2", checkIn: date, checkOut: new Date(new Date(date).getTime() + 125 * 60000).toISOString(), notes: "" }] : [],
      closing: index < 6 && index !== 3 ? { normalCost: 15, reducedCost: 10, reducedCount: 2, notes: "" } : null,
      createdAt: date,
    });
  }
  sessions.push({ _id: "ss201", teacher: "t2", sequence: "Electric circuits", week: 4, number: 7, date: ago(2, 17), center: "c1", grade: "2", price: 90, status: "normal", active: false, attendance: [{ student: "s1", markedAt: ago(2, 17), payment: 0, charged: 90, comment: "", homeworkStatus: "complete", markedBy: "t2", location: "c1" }, { student: "s2", markedAt: ago(2, 17), payment: 90, charged: 90, comment: "", homeworkStatus: "incomplete", markedBy: "t2", location: "c1" }], staff: [], closing: { normalCost: 20, reducedCost: 10, reducedCount: 0, notes: "" }, createdAt: ago(2) });
  sessions.push({ _id: "ss202", teacher: "t2", sequence: "Ohm's law lab", week: 4, number: 8, date: ago(9, 17), center: "c1", grade: "2", price: 90, status: "normal", active: false, attendance: [{ student: "s1", markedAt: ago(9, 17), payment: 180, charged: 90, comment: "", homeworkStatus: "complete", markedBy: "t2", location: "c1" }], staff: [], closing: null, createdAt: ago(9) });

  const examResults = (maxScore) =>
    activeEnrollments.filter(() => random() > 0.15).map((entry) => ({ student: entry.student, score: Math.round((0.45 + random() * 0.55) * maxScore) }));
  const exams = [
    { _id: "x1", teacher: "t1", name: "Limits quiz", maxScore: 20, date: ago(26), session: "ss3", grade: "2", results: examResults(20), createdAt: ago(26) },
    { _id: "x2", teacher: "t1", name: "Derivatives monthly exam", maxScore: 50, date: ago(12), session: null, grade: "2", results: examResults(50), createdAt: ago(12) },
    { _id: "x3", teacher: "t1", name: "Chain rule quiz", maxScore: 10, date: ago(5), session: "ss8", grade: "2", results: examResults(10), createdAt: ago(5) },
    { _id: "x201", teacher: "t2", name: "Circuits quiz", maxScore: 20, date: ago(2), session: "ss201", grade: "2", results: [{ student: "s1", score: 17 }, { student: "s2", score: 12 }], createdAt: ago(2) },
  ];

  const homework = [
    { _id: "h1", teacher: "t1", title: "Limits worksheet", description: "Solve questions 1–20 and show every step.", order: 1, startDate: ago(25), endDate: ago(18), submissionType: "upload", externalLink: "", grade: "2", createdAt: ago(25) },
    { _id: "h2", teacher: "t1", title: "Derivatives practice", description: "Online practice set on the platform.", order: 2, startDate: ago(10), endDate: ago(-4), submissionType: "link", externalLink: "https://forms.gle/example", grade: "2", createdAt: ago(10) },
    { _id: "h3", teacher: "t1", title: "Chain rule problems", description: "Book page 54, all exercises. Upload clear photos.", order: 3, startDate: ago(3), endDate: ago(-5), submissionType: "upload", externalLink: "", grade: "", createdAt: ago(3) },
    { _id: "h201", teacher: "t2", title: "Circuits sheet", description: "Exercises 1–12.", order: 1, startDate: ago(4), endDate: ago(-3), submissionType: "upload", externalLink: "", grade: "2", createdAt: ago(4) },
  ];
  const submissions = [];
  activeEnrollments.slice(0, 12).forEach((entry, index) => {
    submissions.push({ _id: `sub${index + 1}`, homework: "h1", student: entry.student, files: ["https://images.unsplash.com/photo-1455390582262-044cdead277a?w=600"], comment: index % 4 === 0 ? "Question 14 was hard" : "", status: index % 5 === 0 ? "submitted" : pick(["complete", "complete", "incomplete", "no_steps"]), feedback: "", submittedAt: ago(20 - (index % 3)), gradedAt: index % 5 === 0 ? null : ago(17), gradedBy: index % 5 === 0 ? null : "t1" });
  });
  submissions.push({ _id: "sub100", homework: "h3", student: "s2", files: ["https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600"], comment: "", status: "submitted", feedback: "", submittedAt: ago(1), gradedAt: null, gradedBy: null });

  const lessons = [
    {
      _id: "l1", teacher: "t1", title: "Introduction to calculus", description: "Why calculus matters and the key ideas behind it.", week: 1, order: 1, grade: "2", isFree: true, price: 0, viewsIfAttended: 3, viewsIfPaid: 3, accessHours: 72, sessions: ["ss1"], published: true, createdAt: ago(32),
      parts: [
        { _id: "lp1", category: "explanation", title: "The essence of calculus", url: "https://www.youtube.com/embed/WUvTyaaNkzM", durationSeconds: 1020, order: 1 },
        { _id: "lp2", category: "questions", title: "Practice questions", url: "https://www.youtube.com/embed/9vKqVkMQHKk", durationSeconds: 1060, order: 2 },
      ],
      questions: [
        { _id: "q1", part: "lp1", type: "mcq", trigger: "end", triggerSeconds: 0, text: "The derivative of a function at a point describes…", imageUrl: "", choices: { a: "Its area", b: "Its instantaneous rate of change", c: "Its maximum value", d: "Its average value" }, correct: "b", bonusPoints: 5, isActive: true },
        { _id: "q2", part: "lp2", type: "essay", trigger: "end", triggerSeconds: 0, text: "Explain in your own words what a limit is. Upload a photo of your answer.", imageUrl: "", choices: {}, correct: null, bonusPoints: 10, isActive: true },
      ],
    },
    {
      _id: "l2", teacher: "t1", title: "Derivatives from first principles", description: "Building the derivative from the limit definition.", week: 2, order: 2, grade: "2", isFree: false, price: 40, viewsIfAttended: 2, viewsIfPaid: 3, accessHours: 72, sessions: ["ss3"], published: true, createdAt: ago(25),
      parts: [
        { _id: "lp3", category: "explanation", title: "Derivative formulas through geometry", url: "https://www.youtube.com/embed/S0_qX4VJhMQ", durationSeconds: 1080, order: 1 },
        { _id: "lp4", category: "homework_solution", title: "Homework solution", url: "https://www.youtube.com/embed/rfG8ce4nNh0", durationSeconds: 700, order: 2 },
      ],
      questions: [
        { _id: "q3", part: "lp3", type: "mcq", trigger: "time", triggerSeconds: 300, text: "What is the derivative of x²?", imageUrl: "", choices: { a: "x", b: "2x", c: "x³/3", d: "2" }, correct: "b", bonusPoints: 5, isActive: true },
      ],
    },
    {
      _id: "l3", teacher: "t1", title: "The chain rule", description: "Visualising the chain rule and product rule.", week: 4, order: 3, grade: "2", isFree: false, price: 40, viewsIfAttended: 2, viewsIfPaid: 3, accessHours: 48, sessions: ["ss7"], published: true, createdAt: ago(12),
      parts: [{ _id: "lp5", category: "explanation", title: "Chain rule intuition", url: "https://www.youtube.com/embed/YG15m2VwSjA", durationSeconds: 960, order: 1 }],
      questions: [],
    },
    {
      _id: "l4", teacher: "t1", title: "Vectors review (draft)", description: "Not published yet.", week: 5, order: 4, grade: "1", isFree: false, price: 30, viewsIfAttended: 2, viewsIfPaid: 2, accessHours: 72, sessions: [], published: false, createdAt: ago(1),
      parts: [{ _id: "lp6", category: "explanation", title: "Vectors, what even are they?", url: "https://www.youtube.com/embed/fNk_zzaMoSs", durationSeconds: 590, order: 1 }],
      questions: [],
    },
    {
      _id: "l201", teacher: "t2", title: "Electric circuits basics", description: "Current, voltage and resistance.", week: 4, order: 1, grade: "2", isFree: true, price: 0, viewsIfAttended: 3, viewsIfPaid: 3, accessHours: 72, sessions: ["ss201"], published: true, createdAt: ago(2),
      parts: [{ _id: "lp201", category: "explanation", title: "Circuits explained", url: "https://www.youtube.com/embed/kYB8IZa5AuE", durationSeconds: 600, order: 1 }],
      questions: [],
    },
  ];
  const lessonGrants = [
    { _id: "g1", lesson: "l2", student: "s1", method: "attended", maxViews: 2, viewsUsed: 1, startedAt: ago(20), expiresAt: ago(17), createdAt: ago(20) },
    { _id: "g2", lesson: "l3", student: "s1", method: "paid", maxViews: 3, viewsUsed: 1, startedAt: ago(1), expiresAt: ago(-1), createdAt: ago(1) },
    { _id: "g3", lesson: "l2", student: "s2", method: "admin_free", maxViews: 3, viewsUsed: 0, startedAt: null, expiresAt: null, createdAt: ago(4) },
  ];
  const answers = [
    { _id: "an1", question: "q1", lesson: "l1", student: "s2", choice: "b", imageUrl: "", status: "answered", isCorrect: true, points: 5, createdAt: ago(20) },
    { _id: "an2", question: "q2", lesson: "l1", student: "s2", choice: null, imageUrl: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=600", status: "pending", isCorrect: null, points: 0, createdAt: ago(19) },
    { _id: "an3", question: "q1", lesson: "l1", student: "s3", choice: "a", imageUrl: "", status: "answered", isCorrect: false, points: 0, createdAt: ago(18) },
  ];
  const watch = [{ _id: "w1", lesson: "l1", student: "s1", part: "lp1", seconds: 1020, updatedAt: ago(20) }];

  const booklets = [
    { _id: "b1", teacher: "t1", name: "Calculus booklet — Term 1", grade: "2", printPrice: 70, sellPrice: 150, stock: 40, isActive: true, createdAt: ago(60) },
    { _id: "b2", teacher: "t1", name: "Revision booklet", grade: "2", printPrice: 40, sellPrice: 90, stock: 25, isActive: true, createdAt: ago(20) },
    { _id: "b3", teacher: "t1", name: "S2 algebra booklet", grade: "1", printPrice: 50, sellPrice: 110, stock: 18, isActive: true, createdAt: ago(50) },
    { _id: "b201", teacher: "t2", name: "Physics notes", grade: "2", printPrice: 40, sellPrice: 100, stock: 30, isActive: true, createdAt: ago(40) },
  ];
  const bookletOrders = [];
  activeEnrollments.slice(0, 10).forEach((entry, index) => {
    bookletOrders.push({ _id: `bo${index + 1}`, booklet: "b1", student: entry.student, price: 150, paid: index % 3 === 0 ? 75 : 150, delivered: index % 4 !== 0, deliveredAt: index % 4 !== 0 ? ago(30) : null, method: "center", status: "verified", receiptUrl: "", reference: "", createdAt: ago(40) });
  });
  bookletOrders.push({ _id: "bo50", booklet: "b2", student: "s3", price: 90, paid: 90, delivered: false, deliveredAt: null, method: "transfer", status: "pending", receiptUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600", reference: "VF-88231", createdAt: ago(1) });

  const codes = [];
  for (let index = 0; index < 14; index += 1) {
    const used = index < 5;
    codes.push({ _id: `rc${index + 1}`, teacher: "t1", code: `${["MATH", "CALC"][index % 2]}-${String(482913 + index * 7331).slice(0, 6)}`, amount: index < 7 ? 100 : 200, used, usedBy: used ? `s${index + 2}` : null, usedAt: used ? ago(10 - index) : null, batch: index < 7 ? "Batch A" : "Batch B", createdAt: ago(15) });
  }
  for (const code of codes.filter((entry) => entry.used)) {
    transactions.push({ _id: `tx${txCounter++}`, teacher: "t1", student: code.usedBy, amount: code.amount, type: "recharge", reason: `Recharge code ${code.code}`, by: code.usedBy, createdAt: code.usedAt });
  }
  const topups = [
    { _id: "tp1", teacher: "t1", student: "s4", amount: 200, method: "Vodafone Cash", reference: "VF-77120", receiptUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600", status: "pending", reason: "", createdAt: ago(0.3) },
    { _id: "tp2", teacher: "t1", student: "s7", amount: 300, method: "InstaPay", reference: "IP-55102", receiptUrl: "https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=600", status: "pending", reason: "", createdAt: ago(1) },
    { _id: "tp3", teacher: "t1", student: "s1", amount: 150, method: "Vodafone Cash", reference: "VF-60001", receiptUrl: "", status: "approved", reason: "", createdAt: ago(14) },
  ];
  transactions.push({ _id: `tx${txCounter++}`, teacher: "t1", student: "s1", amount: 150, type: "topup", reason: "Transfer VF-60001 approved", by: "t1", createdAt: ago(14) });
  transactions.push({ _id: `tx${txCounter++}`, teacher: "t2", student: "s1", amount: 180, type: "payment", reason: "Cash paid at attendance", by: "t2", createdAt: ago(9) });
  transactions.push({ _id: `tx${txCounter++}`, teacher: "t2", student: "s1", amount: -90, type: "attendance", reason: "Session · Electric circuits", by: "t2", createdAt: ago(2) });

  const announcements = [
    { _id: "an-1", teacher: "t1", title: "Monthly exam next Sunday", body: "The derivatives monthly exam covers weeks 2–4. Bring a calculator.", imageUrl: "", videoUrl: "", linkUrl: "", audience: { grades: ["2"], centers: [] }, isActive: true, pinned: true, createdAt: ago(2) },
    { _id: "an-2", teacher: "t1", title: "New booklet available", body: "The revision booklet is now available. Reserve it from the Booklets page.", imageUrl: "https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=900", videoUrl: "", linkUrl: "", audience: { grades: [], centers: [] }, isActive: true, pinned: false, createdAt: ago(6) },
    { _id: "an-3", teacher: "t1", title: "Holiday schedule", body: "No sessions during the mid-year break.", imageUrl: "", videoUrl: "", linkUrl: "", audience: { grades: [], centers: [] }, isActive: false, pinned: false, createdAt: ago(40) },
    { _id: "an-201", teacher: "t2", title: "Lab session on Wednesday", body: "We'll build simple circuits in class.", imageUrl: "", videoUrl: "", linkUrl: "", audience: { grades: [], centers: [] }, isActive: true, pinned: false, createdAt: ago(1) },
  ];

  const warnings = [
    { _id: "wr1", teacher: "t1", student: "s4", reason: "Homework not done twice in a row", by: "a2", createdAt: ago(12) },
    { _id: "wr2", teacher: "t1", student: "s10", reason: "Disrespectful behaviour", by: "t1", createdAt: ago(20) },
    { _id: "wr3", teacher: "t1", student: "s10", reason: "Absent without notice", by: "t1", createdAt: ago(13) },
    { _id: "wr4", teacher: "t1", student: "s10", reason: "Phone during the exam", by: "t1", createdAt: ago(5) },
  ];
  const pointsLog = [
    { _id: "pt1", teacher: "t1", student: "s1", points: 20, reason: "Top score in limits quiz", by: "t1", createdAt: ago(25) },
    { _id: "pt2", teacher: "t1", student: "s1", points: 5, reason: "Video question answered correctly", by: "system", createdAt: ago(20) },
  ];
  const followComments = [
    { _id: "fc1", teacher: "t1", student: "s4", session: "ss9", comment: "Called the parent — he was sick.", by: "a2", createdAt: ago(1) },
    { _id: "fc2", teacher: "t1", student: "s7", session: "ss9", comment: "No answer, will call again tomorrow.", by: "a2", createdAt: ago(1) },
  ];
  const expenses = [
    { _id: "ex1", teacher: "t1", amount: 1200, reason: "Booklet printing", category: "printing", date: ago(40) },
    { _id: "ex2", teacher: "t1", amount: 350, reason: "Whiteboard markers and paper", category: "supplies", date: ago(18) },
    { _id: "ex3", teacher: "t1", amount: 600, reason: "Social media ads", category: "marketing", date: ago(7) },
  ];

  return {
    version: 1,
    centers, teachers, centerLinks, assistants, students, enrollments, parents, schedule, sessions,
    exams, homework, submissions, lessons, lessonGrants, answers, watch, booklets, bookletOrders,
    codes, topups, transactions, announcements, warnings, pointsLog, followComments, expenses,
  };
}
