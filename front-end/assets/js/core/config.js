// Shared constants for the whole front-end.
// When the page is served by VS Code Live Server (port 5500) the API lives on :3000,
// otherwise the backend serves the front-end itself, so the API is same-origin.
export const API_BASE =
  window.location.port === "5500" ? "http://127.0.0.1:3000" : window.location.origin;

export const APP_NAME = "Learning Center";
export const CURRENCY = "EGP";

export const ROLES = {
  teacher: { label: "Teacher", home: "#/dashboard", loginPath: "/login/teacher" },
  assistant: { label: "Assistant", home: "#/dashboard", loginPath: "/login/assistant" },
  center: { label: "Learning center", home: "#/dashboard", loginPath: "/login/center" },
  student: { label: "Student", home: "#/home", loginPath: "/login/student" },
  parent: { label: "Parent", home: "#/home", loginPath: "/login/parent" },
};

// Enum values match the backend: grade / learningLanguage are stored as index strings ("0", "1", ...).
export const GRADES = ["S1", "S2", "S3"];
export const LANGUAGES = ["Arabic", "English"];
export const SUBJECTS = ["Math", "Physics", "English", "Science", "Biology", "Chemistry", "Arabic"];
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const HOMEWORK_STATUS = {
  complete: { label: "Complete", tone: "success" },
  incomplete: { label: "Incomplete", tone: "warn" },
  no_steps: { label: "No steps", tone: "warn" },
  not_done: { label: "Not done", tone: "danger" },
  submitted: { label: "Submitted", tone: "info" },
};

// Permissions a teacher can grant to an assistant. Keys are sent to / stored by the backend.
export const PERMISSIONS = [
  { key: "dashboard", label: "View dashboard" },
  { key: "students_view", label: "View students" },
  { key: "students_manage", label: "Add, edit and remove students" },
  { key: "students_balance", label: "Adjust balance and points" },
  { key: "warnings", label: "Give and remove warnings" },
  { key: "sessions_view", label: "View sessions and reports" },
  { key: "sessions_manage", label: "Create and edit sessions" },
  { key: "scan_attendance", label: "Scan attendance" },
  { key: "scan_homework", label: "Check homework at the door" },
  { key: "door_check", label: "Door check" },
  { key: "schedule", label: "Manage weekly schedule" },
  { key: "homework_online", label: "Online homework" },
  { key: "exams", label: "Exams and scores" },
  { key: "lessons", label: "Video lessons" },
  { key: "booklets", label: "Booklets" },
  { key: "wallet", label: "Recharge codes and top-ups" },
  { key: "announcements", label: "Announcements" },
  { key: "follow_up", label: "Student follow-up" },
  { key: "finance", label: "Finance and expenses" },
];

export const STORAGE_KEYS = {
  accessToken: "accessToken",
  refreshToken: "refreshToken",
  role: "lc.role",
  demo: "lc.demo",
  theme: "lc.theme",
  activeTeacher: "lc.activeTeacher",
  activeChild: "lc.activeChild",
  scanQueue: "lc.scanQueue",
  demoDb: "lc.demo.db",
};
