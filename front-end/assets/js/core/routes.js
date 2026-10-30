// Route table per role. `view` is a module path under assets/js/views.
// `perm` gates assistant access (string or array = any of). `teacherOnly` hides from assistants.
// Routes with `nav` appear in the sidebar under their group.

const teacherRoutes = [
  { path: "/dashboard", view: "teacher/dashboard", title: "Dashboard", perm: "dashboard", nav: { group: "Overview", icon: "grid" } },
  { path: "/students", view: "teacher/students", title: "Students", perm: "students_view", nav: { group: "Classroom", icon: "users" } },
  { path: "/students/:id", view: "teacher/student-profile", title: "Student", perm: "students_view" },
  { path: "/sessions", view: "teacher/sessions", title: "Sessions", perm: "sessions_view", nav: { group: "Classroom", icon: "calendar" } },
  { path: "/sessions/:id", view: "teacher/session-report", title: "Session report", perm: "sessions_view" },
  { path: "/scan", view: "teacher/scan", title: "Live scan", perm: ["scan_attendance", "scan_homework", "door_check"], nav: { group: "Classroom", icon: "scan" } },
  { path: "/schedule", view: "teacher/schedule", title: "Weekly schedule", perm: "schedule", nav: { group: "Classroom", icon: "clock" } },
  { path: "/lessons", view: "teacher/lessons", title: "Video lessons", perm: "lessons", nav: { group: "Teaching", icon: "play" } },
  { path: "/lessons/:id", view: "teacher/lesson-editor", title: "Lesson", perm: "lessons" },
  { path: "/homework", view: "teacher/homework", title: "Online homework", perm: "homework_online", nav: { group: "Teaching", icon: "pencil" } },
  { path: "/homework/:id", view: "teacher/homework-detail", title: "Homework", perm: "homework_online" },
  { path: "/exams", view: "teacher/exams", title: "Exams", perm: "exams", nav: { group: "Teaching", icon: "award" } },
  { path: "/exams/:id", view: "teacher/exam-detail", title: "Exam", perm: "exams" },
  { path: "/booklets", view: "teacher/booklets", title: "Booklets", perm: "booklets", nav: { group: "Teaching", icon: "book" } },
  { path: "/follow-up", view: "teacher/follow-up", title: "Follow-up", perm: "follow_up", nav: { group: "Engagement", icon: "target" } },
  { path: "/announcements", view: "teacher/announcements", title: "Announcements", perm: "announcements", nav: { group: "Engagement", icon: "megaphone" } },
  { path: "/leaderboard", view: "teacher/leaderboard", title: "Leaderboard", perm: "students_view", nav: { group: "Engagement", icon: "trophy" } },
  { path: "/wallet", view: "teacher/wallet", title: "Wallet & payments", perm: "wallet", nav: { group: "Money", icon: "wallet" } },
  { path: "/finance", view: "teacher/finance", title: "Finance", perm: "finance", nav: { group: "Money", icon: "chart" } },
  { path: "/assistants", view: "teacher/assistants", title: "Assistants", teacherOnly: true, nav: { group: "Team", icon: "shield" } },
  { path: "/centers", view: "teacher/centers", title: "Learning centers", teacherOnly: true, nav: { group: "Team", icon: "building" } },
  { path: "/account", view: "teacher/account", title: "Account", teacherOnly: true, nav: { group: "Account", icon: "settings" } },
];

const assistantOwnRoutes = [
  { path: "/my-work", view: "teacher/my-work", title: "My work", nav: { group: "Account", icon: "clock" } },
  { path: "/account", view: "teacher/assistant-account", title: "My account", nav: { group: "Account", icon: "user" } },
];

export const ROUTES = {
  teacher: teacherRoutes,
  assistant: [...teacherRoutes.filter((route) => !route.teacherOnly), ...assistantOwnRoutes],
  center: [
    { path: "/dashboard", view: "center/dashboard", title: "Dashboard", nav: { group: "Overview", icon: "grid" } },
    { path: "/teachers", view: "center/teachers", title: "Teachers", nav: { group: "Center", icon: "users" } },
    { path: "/schedule", view: "center/schedule", title: "Schedule", nav: { group: "Center", icon: "clock" } },
    { path: "/sessions", view: "center/sessions", title: "Sessions & closings", nav: { group: "Center", icon: "calendar" } },
    { path: "/account", view: "center/account", title: "Account", nav: { group: "Account", icon: "settings" } },
  ],
  student: [
    { path: "/home", view: "student/home", title: "Home", nav: { group: "Overview", icon: "home" } },
    { path: "/teachers", view: "student/teachers", title: "Teachers", nav: { group: "Overview", icon: "users" } },
    { path: "/sessions", view: "student/sessions", title: "My sessions", nav: { group: "Learning", icon: "calendar" } },
    { path: "/lessons", view: "student/lessons", title: "Video lessons", nav: { group: "Learning", icon: "play" } },
    { path: "/lessons/:id", view: "student/lesson-player", title: "Lesson" },
    { path: "/homework", view: "student/homework", title: "Homework", nav: { group: "Learning", icon: "pencil" } },
    { path: "/exams", view: "student/exams", title: "Exams", nav: { group: "Learning", icon: "award" } },
    { path: "/booklets", view: "student/booklets", title: "Booklets", nav: { group: "Learning", icon: "book" } },
    { path: "/wallet", view: "student/wallet", title: "Wallet", nav: { group: "Account", icon: "wallet" } },
    { path: "/leaderboard", view: "student/leaderboard", title: "Leaderboard", nav: { group: "Account", icon: "trophy" } },
    { path: "/account", view: "student/account", title: "Profile", nav: { group: "Account", icon: "user" } },
  ],
  parent: [
    { path: "/home", view: "parent/home", title: "Follow-up", nav: { group: "Overview", icon: "heart" } },
    { path: "/children", view: "parent/children", title: "My children", nav: { group: "Overview", icon: "users" } },
  ],
};

export function matchRoute(routes, path) {
  for (const route of routes) {
    const names = [];
    const pattern = new RegExp(
      `^${route.path.replace(/:[^/]+/g, (segment) => {
        names.push(segment.slice(1));
        return "([^/]+)";
      })}/?$`,
    );
    const match = path.match(pattern);
    if (match) {
      const params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      return { route, params };
    }
  }
  return null;
}
