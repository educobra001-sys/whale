import { LANGUAGES } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  avatar, badge, confirmDialog, date, dateTime, emptyState, formDialog, fullName, gradeLabel, homeworkBadge, html,
  languageLabel, lineChart, money, mount, on, openDialog, qrDataUrl, statTile, table, tabs, toast, whatsappLink, withBusy,
} from "../../core/ui.js";
import { accessBadge, balanceText, centerOptions, durationText, gradeOptions, statusBadge, txBadge } from "../shared/common.js";

export default async function studentProfile(ctx) {
  const { root, api, params, query, setQuery, can, navigate } = ctx;
  let tab = query.tab || "overview";
  let student;
  let history;
  const centers = await centerOptions();
  const assistants = ctx.role === "teacher" ? await api.teacher.assistants().catch(() => []) : [];

  async function load() {
    [student, history] = await Promise.all([api.teacher.student(params.id), api.teacher.studentHistory(params.id)]);
  }

  const contact = (label, phone, message) =>
    phone
      ? html`<div class="row"><span class="muted small">${label}</span><a href="tel:${phone}" class="strong">${phone}</a>
          <a class="badge badge-success" href="${whatsappLink(phone, message)}" target="_blank" rel="noopener">WhatsApp</a></div>`
      : "";

  function overviewTab() {
    const warnings = history.warnings || [];
    return html`<div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h3>Details</h3></div>
        <dl class="kv">
          <dt>Student code</dt><dd class="mono">${student.userID}</dd>
          <dt>Grade</dt><dd>${gradeLabel(student.grade)}</dd>
          <dt>School</dt><dd>${student.schoolName || "—"}</dd>
          <dt>Learning language</dt><dd>${languageLabel(student.learningLanguage)}</dd>
          <dt>Gender</dt><dd>${student.gender || "—"}</dd>
          <dt>Home center</dt><dd>${student.centerName || "—"}</dd>
          <dt>Price per session</dt><dd>${money(student.pricePerSession)}</dd>
          <dt>Follow-up assistant</dt><dd>${student.followUpAssistantName || "—"}</dd>
          <dt>Joined</dt><dd>${date(student.joinedAt)}</dd>
        </dl>
        ${student.adminNote ? html`<div class="notice mt"><strong>Note:</strong> ${student.adminNote}</div>` : ""}
      </section>
      <section class="card">
        <div class="card-head"><div><h3>Warnings</h3><p class="muted small" style="margin:4px 0 0">Three warnings block the student automatically.</p></div>
          ${can("warnings") ? html`<button class="btn btn-sm btn-secondary" data-action="warn">${icon("flag", 15)} Add warning</button>` : ""}</div>
        ${warnings.length
          ? html`<ul class="list">${warnings.map(
              (warning) => html`<li class="list-item"><div class="grow"><p class="strong">${warning.reason || "No reason given"}</p><p class="muted small">${date(warning.createdAt)} · ${warning.byName || ""}</p></div>
                ${can("warnings") ? html`<button class="btn btn-sm btn-ghost" data-action="unwarn" data-id="${warning._id}">Remove</button>` : ""}</li>`,
            )}</ul>`
          : emptyState("No warnings", "This student has a clean record.")}
      </section>
      <section class="card">
        <div class="card-head"><h3>Progress</h3></div>
        ${lineChart(
          [
            { name: "Exam %", points: history.exams.filter((row) => row.score !== null).slice(0, 8).reverse().map((row) => ({ label: row.exam.name.slice(0, 10), value: (row.score / row.exam.maxScore) * 100 })) },
          ],
          { empty: "No exam scores yet." },
        )}
      </section>
      <section class="card">
        <div class="card-head"><h3>Points history</h3>${can("students_balance") ? html`<button class="btn btn-sm btn-secondary" data-action="points">${icon("award", 15)} Add points</button>` : ""}</div>
        ${history.points.length
          ? html`<ul class="list">${history.points.slice(0, 10).map((row) => html`<li class="list-item"><div class="grow"><p>${row.reason || "Points"}</p><p class="muted small">${date(row.createdAt)} · ${row.byName || ""}</p></div>${badge(`${row.points > 0 ? "+" : ""}${row.points}`, row.points > 0 ? "success" : "danger")}</li>`)}</ul>`
          : emptyState("No points yet")}
      </section>
    </div>`;
  }

  const tables = {
    attendance: () =>
      table(
        [
          { label: "Session", render: (row) => html`<a href="#/sessions/${row.session._id}" class="strong">Week ${row.session.week} · #${row.session.number}</a><div class="muted small">${row.session.sequence}</div>` },
          { label: "Date", render: (row) => date(row.session.date) },
          { label: "Status", render: (row) => statusBadge(row.status) },
          { label: "Arrived", render: (row) => (row.markedAt ? html`${dateTime(row.markedAt)}<div class="muted small">${row.location || ""}</div>` : "—") },
          { label: "Homework", render: (row) => (row.status === "present" ? homeworkBadge(row.homeworkStatus) : "—") },
          { label: "Paid", className: "num", render: (row) => (row.payment ? money(row.payment) : "—") },
          { label: "Comment", render: (row) => row.comment || "—" },
          { label: "Recorded by", render: (row) => row.markedBy?.name || "—" },
        ],
        history.attendance,
        { empty: "No sessions yet." },
      ),
    exams: () =>
      table(
        [
          { label: "Exam", render: (row) => html`<a href="#/exams/${row.exam._id}" class="strong">${row.exam.name}</a>` },
          { label: "Date", render: (row) => date(row.exam.date) },
          { label: "Score", className: "num", render: (row) => (row.score === null ? badge("Absent", "danger") : html`<strong>${row.score}</strong> / ${row.exam.maxScore}`) },
          { label: "Rank", className: "num", render: (row) => (row.rank ? `${row.rank} of ${row.participants}` : "—") },
          { label: "Class average", className: "num", render: (row) => `${row.stats.avg} / ${row.exam.maxScore}` },
        ],
        history.exams,
        { empty: "No exams yet." },
      ),
    homework: () =>
      table(
        [
          { label: "Homework", render: (row) => html`<a href="#/homework/${row.homework._id}" class="strong">#${row.homework.order} ${row.homework.title}</a>` },
          { label: "Due", render: (row) => date(row.homework.endDate) },
          { label: "Status", render: (row) => (row.status ? homeworkBadge(row.status) : badge("Not submitted", "muted")) },
          { label: "Submitted", render: (row) => (row.submittedAt ? dateTime(row.submittedAt) : "—") },
          { label: "Feedback", render: (row) => row.feedback || "—" },
        ],
        history.homework,
        { empty: "No online homework yet." },
      ),
    payments: () =>
      html`<div class="row-between mb"><p class="muted small" style="margin:0">Every change to the student's balance with you.</p>
        ${can("students_balance") ? html`<button class="btn btn-sm btn-primary" data-action="balance">${icon("wallet", 15)} Add payment / adjust</button>` : ""}</div>
        ${table(
          [
            { label: "Date", render: (row) => dateTime(row.createdAt) },
            { label: "Type", render: (row) => txBadge(row.type) },
            { label: "Details", render: (row) => row.reason },
            { label: "By", render: (row) => row.byName || "—" },
            { label: "Amount", className: "num", render: (row) => html`<span class="${row.amount < 0 ? "text-danger" : "text-success"} strong">${row.amount > 0 ? "+" : ""}${money(row.amount)}</span>` },
          ],
          history.transactions,
          { empty: "No transactions yet." },
        )}`,
    booklets: () =>
      table(
        [
          { label: "Booklet", render: (row) => html`<strong>${row.booklet.name}</strong>` },
          { label: "Price", className: "num", render: (row) => money(row.price) },
          { label: "Paid", className: "num", render: (row) => money(row.paid) },
          { label: "Remaining", className: "num", render: (row) => (row.price - row.paid > 0 ? html`<span class="text-danger strong">${money(row.price - row.paid)}</span>` : badge("Paid", "success")) },
          { label: "Delivery", render: (row) => (row.delivered ? badge(`Delivered ${date(row.deliveredAt)}`, "success") : badge("Not delivered", "warn")) },
          { label: "Status", render: (row) => statusBadge(row.status) },
        ],
        history.booklets,
        { empty: "No booklets yet. Assign one from the Booklets page." },
      ),
    lessons: () =>
      table(
        [
          { label: "Lesson", render: (row) => html`<a class="strong" href="#/lessons/${row.lesson._id}">${row.lesson.title}</a><div class="muted small">Week ${row.lesson.week}</div>` },
          { label: "Access", render: (row) => accessBadge(row.access) },
          { label: "Views left", className: "num", render: (row) => (row.access.viewsLeft ?? "—") },
          { label: "Expires", render: (row) => (row.access.expiresAt ? dateTime(row.access.expiresAt) : "—") },
          {
            label: "Watched",
            render: (row) => html`<div style="min-width:120px"><div class="meter"><span style="width:${Math.min(100, row.totalSeconds ? (row.watchedSeconds / row.totalSeconds) * 100 : 0)}%"></span></div><span class="muted small">${durationText(row.watchedSeconds)} of ${durationText(row.totalSeconds)}</span></div>`,
          },
        ],
        history.lessons,
        { empty: "No published lessons yet." },
      ),
  };

  function render() {
    const stats = history.stats;
    const manage = can("students_manage");
    mount(
      root,
      html`<a class="back-link" href="#/students">${icon("arrowLeft", 15)} All students</a>
      <section class="card card-accent mb">
        <div class="profile-hero">
          ${avatar(student, "xl")}
          <div class="grow">
            <p class="eyebrow">${student.userID}</p>
            <h1>${fullName(student)}</h1>
            <div class="status-chips mb">
              ${badge(gradeLabel(student.grade), "accent")}
              ${student.centerName ? badge(student.centerName, "muted") : ""}
              ${student.isBlocked ? badge("Blocked", "danger") : ""}
              ${student.warningsCount ? badge(`${student.warningsCount} warning${student.warningsCount > 1 ? "s" : ""}`, "warn") : ""}
            </div>
            ${contact("Student", student.phone, `Hello ${student.firstName}`)}
            ${contact("Parent", student.parentPhone, `Hello, this is about ${fullName(student)}.`)}
          </div>
          <div class="row">
            <button class="btn btn-secondary" data-action="qr">${icon("qr")} QR card</button>
            ${manage ? html`<button class="btn btn-secondary" data-action="edit">${icon("pencil")} Edit</button>` : ""}
            ${can("students_balance") ? html`<button class="btn btn-primary" data-action="balance">${icon("wallet")} Payment</button>` : ""}
          </div>
        </div>
      </section>

      ${student.isBlocked ? html`<div class="notice notice-danger mb row-between"><span>This student is blocked and can't be checked in or open paid lessons.</span>${manage ? html`<button class="btn btn-sm btn-secondary" data-action="unblock">Unblock</button>` : ""}</div>` : ""}

      <section class="stats">
        ${statTile("Balance", balanceText(student.balance), { hint: `${money(student.pricePerSession)} per session`, tone: student.balance < 0 ? "danger" : "" })}
        ${statTile("Points", student.points ?? 0)}
        ${statTile("Attendance", `${stats.attendanceRate}%`, { hint: `${stats.present} present · ${stats.absent} absent` })}
        ${statTile("Homework done", `${stats.homeworkRate}%`)}
        ${statTile("Exam average", `${stats.examAvg}%`)}
      </section>

      ${tabs(
        [
          { key: "overview", label: "Overview" },
          { key: "attendance", label: "Attendance", count: history.attendance.length },
          { key: "exams", label: "Exams", count: history.exams.length },
          { key: "homework", label: "Homework" },
          { key: "payments", label: "Payments", count: history.transactions.length },
          { key: "booklets", label: "Booklets", count: history.booklets.length },
          { key: "lessons", label: "Lessons" },
        ],
        tab,
      )}
      <div id="tab-body">${tab === "overview" ? overviewTab() : html`<div class="card card-flush">${tables[tab]()}</div>`}</div>

      ${manage
        ? html`<section class="card mt"><div class="row-between">
            <div><h3 style="margin:0 0 4px">Danger zone</h3><p class="muted small" style="margin:0">Blocking stops check-ins. Removing keeps the history so you can restore the student later.</p></div>
            <div class="row">${student.isBlocked ? "" : html`<button class="btn btn-secondary" data-action="block">Block student</button>`}
              <button class="btn btn-danger" data-action="remove">Remove from class</button></div>
          </div></section>`
        : ""}`,
    );
  }

  async function reload(message) {
    await load();
    render();
    if (message) toast(message);
  }

  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab: tab === "overview" ? "" : tab });
    render();
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "qr") {
      const qr = await qrDataUrl(student.userID);
      openDialog({
        title: fullName(student),
        eyebrow: "Student card",
        size: "sm",
        body: html`<div class="id-card"><div><p class="eyebrow">Student code</p><p class="code">${student.userID}</p><p class="muted small">${gradeLabel(student.grade)} · ${student.centerName || ""}</p></div><img class="qr-img" src="${qr}" alt="QR code"></div>`,
        actions: html`<a class="btn btn-secondary" href="${qr}" download="${student.userID}.png">Download</a><button class="btn btn-primary" onclick="window.print()">Print</button>`,
      });
    }
    if (action === "edit") {
      const result = await formDialog({
        title: "Edit student",
        eyebrow: student.userID,
        size: "lg",
        fields: [
          { name: "firstName", label: "First name", required: true, value: student.firstName },
          { name: "lastName", label: "Last name", value: student.lastName },
          { name: "phone", label: "Student phone", type: "tel", value: student.phone },
          { name: "parentPhone", label: "Parent phone", type: "tel", value: student.parentPhone },
          { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: student.grade },
          { name: "schoolName", label: "School", value: student.schoolName },
          { name: "learningLanguage", label: "Learning language", type: "select", options: LANGUAGES.map((label, index) => ({ value: String(index), label })), value: student.learningLanguage },
          { name: "gender", label: "Gender", type: "select", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }], value: student.gender },
          { name: "center", label: "Home center", type: "select", options: centers, value: student.center, emptyLabel: "No center" },
          { name: "pricePerSession", label: "Price per session", type: "number", min: 0, value: student.pricePerSession },
          ...(assistants.length ? [{ name: "followUpAssistant", label: "Follow-up assistant", type: "select", options: assistants.map((a) => ({ value: a._id, label: fullName(a) })), value: student.followUpAssistant, emptyLabel: "Nobody" }] : []),
          { name: "adminNote", label: "Private note", type: "textarea", value: student.adminNote, full: true, hint: "Only you and your assistants see this. It shows up when the student is scanned." },
        ],
        onSubmit: (values) => api.teacher.updateStudent(student._id, values),
      });
      if (result) await reload("Student updated.");
    }
    if (action === "balance") {
      const result = await formDialog({
        title: "Payment or balance adjustment",
        eyebrow: `Current balance ${money(student.balance)}`,
        fields: [
          { name: "kind", label: "Type", type: "select", options: [{ value: "add", label: "Add — student paid" }, { value: "deduct", label: "Deduct — correction or charge" }], value: "add", required: true },
          { name: "amount", label: "Amount", type: "number", min: 1, required: true },
          { name: "reason", label: "Reason", full: true, placeholder: "e.g. Monthly payment, refund, booklet…" },
        ],
        submitLabel: "Save",
        onSubmit: ({ kind, amount, reason }) => api.teacher.adjustBalance(student._id, { amount: kind === "deduct" ? -Math.abs(amount) : Math.abs(amount), reason }),
      });
      if (result) await reload("Balance updated.");
    }
    if (action === "points") {
      const result = await formDialog({
        title: "Add or remove points",
        fields: [
          { name: "points", label: "Points (use a minus sign to remove)", type: "number", required: true },
          { name: "reason", label: "Reason", full: true, placeholder: "e.g. Top of the class in the quiz" },
        ],
        onSubmit: (values) => api.teacher.addPoints(student._id, values),
      });
      if (result) await reload("Points updated.");
    }
    if (action === "warn") {
      const result = await formDialog({
        title: "Give a warning",
        intro: (student.warningsCount || 0) >= 2 ? "This will be the third warning — the student will be blocked automatically." : "",
        fields: [{ name: "reason", label: "Reason", full: true, required: true }],
        submitLabel: "Give warning",
        danger: true,
        onSubmit: (values) => api.teacher.addWarning(student._id, values),
      });
      if (result) await reload("Warning recorded.");
    }
    if (action === "unwarn") {
      if (!(await confirmDialog("Remove this warning?", { confirmLabel: "Remove" }))) return;
      if (!(await withBusy(button, () => api.teacher.removeWarning(student._id, button.dataset.id)))) return;
      await reload("Warning removed.");
    }
    if (action === "block" || action === "unblock") {
      const blocking = action === "block";
      if (!(await confirmDialog(blocking ? "Blocked students can't be checked in or open paid lessons." : "Allow this student to attend again?", { title: blocking ? "Block this student?" : "Unblock this student?", confirmLabel: blocking ? "Block" : "Unblock", danger: blocking }))) return;
      if (!(await withBusy(button, () => api.teacher.setBlocked(student._id, blocking)))) return;
      await reload(blocking ? "Student blocked." : "Student unblocked.");
    }
    if (action === "remove") {
      const result = await formDialog({
        title: `Remove ${fullName(student)}?`,
        intro: "The student leaves your class but keeps their account. Their history is archived and you can restore them from Students → Removed.",
        fields: [{ name: "reason", label: "Reason", full: true }],
        submitLabel: "Remove from class",
        danger: true,
        onSubmit: (values) => api.teacher.removeStudent(student._id, values),
      });
      if (result) {
        toast("Student removed from your class.");
        navigate("#/students");
      }
    }
  });

  await load();
  render();
}
