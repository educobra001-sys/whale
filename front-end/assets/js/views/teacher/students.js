import { GRADES, LANGUAGES } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, date, downloadCSV, emptyState, formDialog, fullName, gradeLabel, html, mount, on, openDialog,
  pageHeader, parseCSV, plural, qrDataUrl, relative, table, tabs, toast, withBusy,
} from "../../core/ui.js";
import { balanceText, centerOptions, gradeOptions, matches, studentCell } from "../shared/common.js";

const studentFields = (centers, values = {}) => [
  { name: "firstName", label: "First name", required: true, value: values.firstName },
  { name: "lastName", label: "Last name", value: values.lastName },
  { name: "phone", label: "Student phone", type: "tel", required: true, value: values.phone },
  { name: "parentPhone", label: "Parent phone", type: "tel", value: values.parentPhone },
  { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade },
  { name: "gender", label: "Gender", type: "select", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }], value: values.gender || "male" },
  { name: "schoolName", label: "School", value: values.schoolName },
  { name: "learningLanguage", label: "Learning language", type: "select", options: LANGUAGES.map((label, index) => ({ value: String(index), label })), value: values.learningLanguage },
  { name: "center", label: "Home center", type: "select", options: centers, value: values.center, emptyLabel: "No center" },
  { name: "pricePerSession", label: "Price per session", type: "number", min: 0, value: values.pricePerSession ?? 80 },
];

export async function showCredentials({ userID, password, student }) {
  const qr = await qrDataUrl(userID).catch(() => "");
  openDialog({
    title: "Student account ready",
    eyebrow: fullName(student),
    size: "sm",
    body: html`<div class="id-card">
        <div><p class="eyebrow">Student code</p><p class="code">${userID}</p>
          ${password ? html`<p class="small muted">Temporary password</p><p class="strong mono">${password}</p>` : ""}</div>
        ${qr ? html`<img class="qr-img" src="${qr}" alt="QR code for ${userID}">` : ""}
      </div>
      <p class="dialog-text mt">Give these details to the student. They sign in with the code and password, and show the QR code at the door.</p>`,
    actions: html`<button class="btn btn-secondary" type="button" onclick="window.print()">Print</button><button class="btn btn-primary" type="button" data-close>Done</button>`,
  });
}

export default async function students(ctx) {
  const { root, api, query, setQuery, can, navigate } = ctx;
  let tab = query.tab || "class";
  let list = [];
  let requests = [];
  let archive = [];
  const centers = await centerOptions();
  const filters = { q: query.q || "", center: query.center || "", grade: "", filter: query.filter || "" };

  async function load() {
    const [studentsResult, requestsResult, archiveResult] = await Promise.all([
      api.teacher.students(),
      can("students_manage") ? api.teacher.joinRequests().catch(() => []) : [],
      can("students_manage") ? api.teacher.archive().catch(() => []) : [],
    ]);
    list = studentsResult || [];
    requests = requestsResult || [];
    archive = archiveResult || [];
  }

  function filtered() {
    return list.filter((student) => {
      if (!matches(filters.q, fullName(student), student.userID, student.phone, student.parentPhone, student.schoolName)) return false;
      if (filters.center && String(student.center) !== filters.center) return false;
      if (filters.grade && String(student.grade) !== filters.grade) return false;
      if (filters.filter === "low" && !(student.balance < (student.pricePerSession || 0))) return false;
      if (filters.filter === "blocked" && !student.isBlocked) return false;
      if (filters.filter === "warned" && !student.warningsCount) return false;
      return true;
    });
  }

  function classResults() {
    const rows = filtered();
    return html`<p class="muted small mb">${plural(rows.length, "student")} shown${rows.length !== list.length ? ` of ${list.length}` : ""}</p>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (student) => studentCell(student) },
          { label: "Grade", render: (student) => gradeLabel(student.grade) },
          { label: "Center", render: (student) => student.centerName || html`<span class="muted">—</span>` },
          { label: "Phone", render: (student) => html`<span class="nowrap">${student.phone || "—"}</span>` },
          { label: "Balance", className: "num", render: (student) => balanceText(student.balance) },
          { label: "Points", className: "num", render: (student) => student.points ?? 0 },
          {
            label: "Status",
            render: (student) => html`<span class="status-chips">${student.isBlocked ? badge("Blocked", "danger") : ""}${student.warningsCount ? badge(`${student.warningsCount} warning${student.warningsCount > 1 ? "s" : ""}`, "warn") : ""}${!student.isBlocked && !student.warningsCount ? badge("Good", "success") : ""}</span>`,
          },
          { label: "Last seen", render: (student) => html`<span class="muted small">${student.lastAttendedAt ? relative(student.lastAttendedAt) : "Never"}</span>` },
        ],
        rows,
        { empty: list.length ? "No students match these filters." : "No students yet — add your first student or share your profile so students can request to join." },
      )}</div>`;
  }

  function classTab() {
    return html`<div class="toolbar">
        <label class="search"><span class="sr-only">Search students</span>${icon("search", 16)}<input type="search" id="student-search" placeholder="Search name, code, phone, school…  ( / )" value="${filters.q}"></label>
        <select class="select-sm" data-filter="center" aria-label="Center"><option value="">All centers</option>${centers.map((center) => html`<option value="${center.value}" ${filters.center === center.value ? html`selected` : ""}>${center.label}</option>`)}</select>
        <select class="select-sm" data-filter="grade" aria-label="Grade"><option value="">All grades</option>${GRADES.map((grade, index) => html`<option value="${index}" ${filters.grade === String(index) ? html`selected` : ""}>${grade}</option>`)}</select>
        <select class="select-sm" data-filter="filter" aria-label="Status"><option value="">Everyone</option>
          <option value="low" ${filters.filter === "low" ? html`selected` : ""}>Low balance</option>
          <option value="blocked" ${filters.filter === "blocked" ? html`selected` : ""}>Blocked</option>
          <option value="warned" ${filters.filter === "warned" ? html`selected` : ""}>Has warnings</option></select>
      </div>
      <div id="class-results">${classResults()}</div>`;
  }

  function requestsTab() {
    if (!requests.length) return emptyState("No join requests", "Students can find you in the teacher directory and ask to join your class.");
    return html`<div class="card card-flush">${table(
      [
        { label: "Student", render: (row) => studentCell(row.student) },
        { label: "Grade", render: (row) => gradeLabel(row.student.grade) },
        { label: "School", render: (row) => row.student.schoolName || "—" },
        { label: "Phone", render: (row) => row.student.phone || "—" },
        { label: "Requested", render: (row) => relative(row.createdAt) },
        {
          label: "",
          className: "actions",
          render: (row) => html`<button class="btn btn-sm btn-secondary" data-action="reject" data-id="${row._id}">Decline</button><button class="btn btn-sm btn-primary" data-action="accept" data-id="${row._id}">Accept</button>`,
        },
      ],
      requests,
    )}</div>`;
  }

  function archiveTab() {
    if (!archive.length) return emptyState("No removed students", "Students you remove from your class are kept here so you can restore them with their full history.");
    return html`<div class="card card-flush">${table(
      [
        { label: "Student", render: (row) => html`${row.student.firstName} ${row.student.lastName} <span class="muted small">${row.student.userID}</span>` },
        { label: "Removed", render: (row) => date(row.removedAt) },
        { label: "Reason", render: (row) => row.reason || html`<span class="muted">—</span>` },
        { label: "Balance", className: "num", render: (row) => balanceText(row.balance) },
        { label: "", className: "actions", render: (row) => html`<button class="btn btn-sm btn-secondary" data-action="restore" data-id="${row.student._id}">Restore</button>` },
      ],
      archive,
    )}</div>`;
  }

  function render() {
    const manage = can("students_manage");
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Classroom",
        title: "Students",
        text: "Everyone enrolled in your class. Open a student to see attendance, payments, exams and more.",
        actions: html`<button class="btn btn-secondary" data-action="export" type="button">${icon("download")} Export</button>
          ${manage ? html`<button class="btn btn-secondary" data-action="import" type="button">${icon("upload")} Import</button>
            <button class="btn btn-secondary" data-action="link" type="button">${icon("link")} Link existing</button>
            <button class="btn btn-primary" data-action="add" type="button">${icon("plus")} Add student</button>` : ""}`,
      })}
      ${manage
        ? tabs(
            [
              { key: "class", label: "Class list", count: list.length },
              { key: "requests", label: "Join requests", count: requests.length },
              { key: "archive", label: "Removed", count: archive.length },
            ],
            tab,
          )
        : ""}
      <div id="tab-body">${tab === "requests" ? requestsTab() : tab === "archive" ? archiveTab() : classTab()}</div>`,
    );
  }

  const renderResults = () => mount($("#class-results", root), classResults());

  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab: tab === "class" ? "" : tab });
    render();
  });
  on(root, "input", "#student-search", (event, input) => {
    filters.q = input.value;
    setQuery({ q: filters.q });
    renderResults();
  });
  on(root, "change", "[data-filter]", (event, select) => {
    filters[select.dataset.filter] = select.value;
    setQuery({ [select.dataset.filter]: select.value });
    renderResults();
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "add") {
      const result = await formDialog({
        title: "Add a new student",
        eyebrow: "Creates a student account",
        intro: "We'll create the student's account and generate a student code and a temporary password.",
        fields: [...studentFields(centers), { name: "balance", label: "Opening balance", type: "number", value: 0, hint: "Money the student already paid you" }],
        submitLabel: "Create student",
        onSubmit: (values) => api.teacher.createStudent(values),
      });
      if (result?.userID) {
        await load();
        render();
        showCredentials(result);
      }
    }
    if (action === "link") {
      const result = await formDialog({
        title: "Link an existing student",
        intro: "If the student already has a Learning Center account (for example with another teacher), enter their student code or phone number.",
        fields: [
          { name: "identifier", label: "Student code or phone", required: true, placeholder: "STU-000123", full: true },
          { name: "center", label: "Home center", type: "select", options: centers, emptyLabel: "No center" },
          { name: "pricePerSession", label: "Price per session", type: "number", value: 80, min: 0 },
        ],
        submitLabel: "Add to my class",
        onSubmit: (values) => api.teacher.linkStudent(values),
      });
      if (result) {
        toast(`${fullName(result)} joined your class.`);
        await load();
        render();
      }
    }
    if (action === "import") importDialog();
    if (action === "export") {
      downloadCSV(
        `students-${new Date().toISOString().slice(0, 10)}`,
        [
          { label: "Code", value: (s) => s.userID },
          { label: "First name", value: (s) => s.firstName },
          { label: "Last name", value: (s) => s.lastName },
          { label: "Phone", value: (s) => s.phone },
          { label: "Parent phone", value: (s) => s.parentPhone },
          { label: "Grade", value: (s) => gradeLabel(s.grade) },
          { label: "School", value: (s) => s.schoolName },
          { label: "Center", value: (s) => s.centerName },
          { label: "Price per session", value: (s) => s.pricePerSession },
          { label: "Balance", value: (s) => s.balance },
          { label: "Points", value: (s) => s.points },
          { label: "Blocked", value: (s) => (s.isBlocked ? "Yes" : "No") },
        ],
        filtered(),
      );
    }
    if (action === "accept" || action === "reject") {
      if (!(await withBusy(button, () => api.teacher.answerRequest(button.dataset.id, action === "accept" ? "accepted" : "rejected"), action === "accept" ? "Student added to your class." : "Request declined."))) return;
      await load();
      render();
    }
    if (action === "restore") {
      if (!(await confirmDialog("Restore this student to your class with their previous balance and history?", { confirmLabel: "Restore" }))) return;
      if (!(await withBusy(button, () => api.teacher.restoreStudent(button.dataset.id), "Student restored."))) return;
      await load();
      render();
    }
  });
  on(root, "click", "tbody tr", (event, row) => {
    if (event.target.closest("a,button,input,select")) return;
    const link = row.querySelector("a.person");
    if (link) navigate(link.getAttribute("href"));
  });

  function importDialog() {
    const { dialog, close } = openDialog({
      title: "Import students from a spreadsheet",
      size: "lg",
      body: html`<p class="dialog-text">Upload a CSV file (Excel → Save as → CSV UTF-8). Columns: <span class="mono small">firstName, lastName, phone, parentPhone, grade (S1/S2/S3), schoolName, pricePerSession, balance</span>.</p>
        <div class="row mb"><button class="btn btn-secondary btn-sm" type="button" data-template>${icon("download", 15)} Download template</button></div>
        <div class="field"><label for="csv-file">CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv"></div>
        <div id="import-preview" class="mt"></div>`,
      actions: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="button" data-import disabled>Import</button>`,
    });
    let rows = [];
    $("[data-template]", dialog).addEventListener("click", () =>
      downloadCSV(
        "students-template",
        ["firstName", "lastName", "phone", "parentPhone", "grade", "schoolName", "pricePerSession", "balance"].map((key) => ({ label: key, value: (row) => row[key] })),
        [{ firstName: "Mariam", lastName: "Hassan", phone: "01234567890", parentPhone: "01098765432", grade: "S3", schoolName: "El Orman School", pricePerSession: 80, balance: 0 }],
      ),
    );
    $("#csv-file", dialog).addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      rows = parseCSV(await file.text()).map((row) => ({
        ...row,
        grade: /^\d+$/.test(row.grade) ? row.grade : String(Math.max(0, GRADES.indexOf(String(row.grade).toUpperCase()))),
        pricePerSession: Number(row.pricePerSession) || 80,
        balance: Number(row.balance) || 0,
      }));
      const invalid = rows.filter((row) => !row.firstName || !row.phone).length;
      mount(
        $("#import-preview", dialog),
        html`<div class="notice ${invalid ? "notice-danger" : ""}">${plural(rows.length, "row")} found${invalid ? ` · ${invalid} missing a first name or phone (they'll be skipped)` : ""}.</div>
          ${table([{ label: "Name", render: (row) => `${row.firstName} ${row.lastName}` }, { label: "Phone", render: (row) => row.phone }, { label: "Grade", render: (row) => gradeLabel(row.grade) }], rows.slice(0, 6))}
          ${rows.length > 6 ? html`<p class="muted small">…and ${rows.length - 6} more</p>` : ""}`,
      );
      $("[data-import]", dialog).disabled = !rows.length;
    });
    $("[data-import]", dialog).addEventListener("click", async (event) => {
      const result = await withBusy(event.currentTarget, () => api.teacher.importStudents(rows));
      if (!result) return;
      close();
      toast(`${plural(result.created.length, "student")} imported${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.`, result.skipped.length ? "warn" : "success");
      if (result.created.length) {
        downloadCSV("new-student-credentials", [
          { label: "Name", value: (row) => row.name },
          { label: "Student code", value: (row) => row.userID },
          { label: "Temporary password", value: (row) => row.password },
        ], result.created);
      }
      if (result.skipped.length) {
        openDialog({
          title: "Some rows were skipped",
          body: table([{ label: "Row", render: (row) => `${row.row.firstName || ""} ${row.row.lastName || ""} · ${row.row.phone || ""}` }, { label: "Reason", render: (row) => row.reason }], result.skipped),
          actions: html`<button class="btn btn-primary" data-close>OK</button>`,
        });
      }
      await load();
      render();
    });
  }

  await load();
  render();
}
