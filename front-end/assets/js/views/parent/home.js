import {
  $, date, dateTime, emptyState, fullName, gradeLabel, homeworkBadge, html, money, mount, on, pageHeader, relative, statTile, table, tabs, whatsappLink,
} from "../../core/ui.js";
import { statusBadge, txBadge } from "../shared/common.js";
import { examsChart, examsTable } from "../student/exams.js";

export default async function parentHome(ctx) {
  const { root, api, childId, query, setQuery } = ctx;
  if (!childId) {
    mount(root, html`<div class="card">${emptyState("Link your child", "Add your child with their student code to follow their progress.", html`<a class="btn btn-primary" href="#/children">Add a child</a>`)}</div>`);
    return;
  }
  let teacherId = query.teacher || "";
  let tab = query.tab || "sessions";
  let report;

  async function load() {
    report = await api.parent.report(childId, teacherId);
    teacherId = report.teacher?._id || "";
  }

  function render() {
    const child = report.student;
    if (!report.teacher) {
      mount(root, html`${pageHeader({ eyebrow: "Follow-up", title: fullName(child) })}<div class="card">${emptyState("No teachers yet", `${child.firstName} hasn't joined a teacher yet.`)}</div>`);
      return;
    }
    const { stats } = report;
    const teacher = report.teacher;
    mount(
      root,
      html`${pageHeader({ eyebrow: `${child.userID} · ${gradeLabel(child.grade)}`, title: fullName(child), text: `Following ${child.firstName}'s progress${report.teachers.length > 1 ? " — choose a teacher below" : ` with ${fullName(teacher)}`}.` })}
      ${report.teachers.length > 1
        ? html`<div class="toolbar">${report.teachers.map((item) => html`<button class="btn ${String(item._id) === String(teacherId) ? "btn-primary" : "btn-secondary"}" data-teacher="${item._id}">${fullName(item)} · ${(item.subject || []).join(", ")}</button>`)}</div>`
        : ""}
      ${report.isBlocked ? html`<div class="notice notice-danger mb">${child.firstName}'s account with ${fullName(teacher)} is blocked. Please contact the teacher.</div>` : ""}
      ${report.warnings.length ? html`<div class="notice mb"><strong>${report.warnings.length} warning${report.warnings.length > 1 ? "s" : ""}:</strong> ${report.warnings.map((warning) => `${warning.reason || "Warning"} (${date(warning.createdAt)})`).join(" · ")}</div>` : ""}
      <section class="stats">
        ${statTile("Attendance", `${stats.attendanceRate}%`, { hint: `${stats.present} present · ${stats.absent} absent`, tone: stats.attendanceRate < 75 ? "danger" : "success" })}
        ${statTile("Homework done", `${stats.homeworkRate}%`)}
        ${statTile("Exam average", `${stats.examAvg}%`)}
        ${statTile("Balance", money(report.balance), { tone: report.balance < 0 ? "danger" : "accent" })}
        ${statTile("Points", report.points)}
      </section>
      <div class="grid grid-main">
        <div>
          ${tabs([{ key: "sessions", label: "Sessions", count: report.sessions.length }, { key: "exams", label: "Exams", count: report.exams.length }, { key: "payments", label: "Payments" }], tab)}
          <div id="tab-body">${tabBody()}</div>
        </div>
        <div class="stack">
          <section class="card card-accent"><div class="card-head"><h3>Contact</h3></div>
            ${report.followUp.assistant
              ? html`<p class="small muted" style="margin:0">Follow-up assistant</p><p class="strong">${report.followUp.assistant.name}</p>
                  ${report.followUp.assistant.phone ? html`<a class="btn btn-sm btn-success" href="${whatsappLink(report.followUp.assistant.phone, `Hello, I'm ${child.firstName}'s parent (${child.userID}).`)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}`
              : ""}
            ${report.followUp.teacherPhone ? html`<p class="small muted mt" style="margin-bottom:0">Teacher</p><p class="strong">${fullName(teacher)}</p><a class="btn btn-sm btn-secondary" href="${whatsappLink(report.followUp.teacherPhone, `Hello, I'm ${child.firstName}'s parent (${child.userID}).`)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          </section>
          ${report.followUp.lastComment ? html`<section class="card"><div class="card-head"><h3>Latest follow-up note</h3></div><p>“${report.followUp.lastComment.comment}”</p><p class="muted small">${relative(report.followUp.lastComment.createdAt)}</p></section>` : ""}
          <section class="card"><div class="card-head"><h3>Center</h3></div><p style="margin:0">${report.centerName || "—"}</p></section>
        </div>
      </div>`,
    );
  }

  function tabBody() {
    if (tab === "exams") return html`<section class="card mb">${examsChart(report.exams)}</section><div class="card card-flush">${examsTable(report.exams)}</div>`;
    if (tab === "payments")
      return html`<div class="card card-flush">${table(
        [
          { label: "Date", render: (tx) => dateTime(tx.createdAt) },
          { label: "Type", render: (tx) => txBadge(tx.type) },
          { label: "Details", render: (tx) => tx.reason },
          { label: "Amount", className: "num", render: (tx) => html`<span class="${tx.amount < 0 ? "text-danger" : "text-success"} strong">${tx.amount > 0 ? "+" : ""}${money(tx.amount)}</span>` },
        ],
        report.transactions,
        { empty: "No payments yet." },
      )}</div>`;
    return html`<div class="card card-flush">${table(
      [
        { label: "Session", render: (row) => html`<strong>Week ${row.session.week} · #${row.session.number}</strong><div class="muted small">${row.session.sequence}</div>` },
        { label: "Date", render: (row) => date(row.session.date) },
        { label: "Attendance", render: (row) => statusBadge(row.status) },
        { label: "Homework", render: (row) => (row.status === "present" ? homeworkBadge(row.homeworkStatus) : "—") },
        { label: "Note", render: (row) => row.comment || "—" },
      ],
      report.sessions,
      { empty: "No sessions yet." },
    )}</div>`;
  }

  on(root, "click", "[data-teacher]", async (event, button) => {
    teacherId = button.dataset.teacher;
    setQuery({ teacher: teacherId });
    await load();
    render();
  });
  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab });
    mount($("#tab-body", root), tabBody());
    for (const item of root.querySelectorAll("[data-tab]")) item.classList.toggle("is-active", item === button);
  });

  await load();
  render();
}
