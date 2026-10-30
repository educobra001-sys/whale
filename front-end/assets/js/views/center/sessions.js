import { icon } from "../../core/icons.js";
import { badge, date, downloadCSV, fullName, html, isoDate, money, mount, on, pageHeader, statTile, table } from "../../core/ui.js";
import { personCell } from "../shared/common.js";

export default async function centerSessions(ctx) {
  const { root, api } = ctx;
  const range = { from: isoDate(Date.now() - 29 * 86400000), to: isoDate() };
  let sessions = [];
  let teacherFilter = "";

  async function load() {
    sessions = (await api.center.sessions(range)) || [];
  }

  function render() {
    const visible = sessions.filter((session) => !teacherFilter || String(session.teacher?._id) === teacherFilter);
    const held = visible.filter((session) => session.status !== "cancelled");
    const teachers = [...new Map(sessions.map((session) => [session.teacher?._id, session.teacher])).values()].filter(Boolean);
    const totalClosing = held.reduce((total, session) => total + (session.closing?.total || 0), 0);
    const missing = held.filter((session) => !session.closing).length;
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Center",
        title: "Sessions & closings",
        text: "Every session held at your center and the amount each teacher owes you (calculated by the teacher from the session's attendance).",
        actions: html`<button class="btn btn-secondary" data-action="export">${icon("download")} Export</button>`,
      })}
      <div class="toolbar">
        <div class="field"><label for="cs-from">From</label><input id="cs-from" type="date" value="${range.from}" data-range="from"></div>
        <div class="field"><label for="cs-to">To</label><input id="cs-to" type="date" value="${range.to}" data-range="to"></div>
        ${teachers.length > 1 ? html`<div class="field"><label for="cs-teacher">Teacher</label><select id="cs-teacher"><option value="">All teachers</option>${teachers.map((teacher) => html`<option value="${teacher._id}" ${teacherFilter === String(teacher._id) ? html`selected` : ""}>${fullName(teacher)}</option>`)}</select></div>` : ""}
      </div>
      <section class="stats">
        ${statTile("Sessions held", held.length)}
        ${statTile("Check-ins", held.reduce((total, session) => total + session.presentCount, 0))}
        ${statTile("Closings total", money(totalClosing), { tone: "accent" })}
        ${statTile("Closings not set", missing, { tone: missing ? "danger" : "", hint: "ask the teacher to calculate" })}
      </section>
      <div class="card card-flush">${table(
        [
          { label: "Teacher", render: (session) => personCell(session.teacher, { sub: (session.teacher?.subject || []).join(", ") }) },
          { label: "Session", render: (session) => html`<strong>Week ${session.week} · #${session.number}</strong><div class="muted small">${session.sequence}</div>` },
          { label: "Date", render: (session) => date(session.date) },
          { label: "Status", render: (session) => (session.status === "cancelled" ? badge("Cancelled", "muted") : session.active ? badge("Live", "success") : badge("Held", "accent")) },
          { label: "Present", className: "num", render: (session) => session.presentCount },
          { label: "Per student", className: "num", render: (session) => (session.closing ? html`${money(session.closing.normalCost)}${session.closing.reducedCount ? html`<div class="muted small">${session.closing.reducedCount} × ${money(session.closing.reducedCost)}</div>` : ""}` : "—") },
          { label: "Closing", className: "num", render: (session) => (session.closing ? html`<strong>${money(session.closing.total)}</strong>` : badge("Not set", "warn")) },
        ],
        visible,
        { empty: "No sessions at your center in this period." },
      )}</div>`,
    );
  }

  on(root, "change", "[data-range]", async (event, input) => {
    range[input.dataset.range] = input.value;
    await load();
    render();
  });
  on(root, "change", "#cs-teacher", (event, select) => {
    teacherFilter = select.value;
    render();
  });
  on(root, "click", "[data-action=export]", () =>
    downloadCSV(`center-closings-${range.from}-to-${range.to}`, [
      { label: "Date", value: (s) => isoDate(s.date) },
      { label: "Teacher", value: (s) => fullName(s.teacher) },
      { label: "Session", value: (s) => `Week ${s.week} #${s.number} ${s.sequence}` },
      { label: "Status", value: (s) => s.status },
      { label: "Present", value: (s) => s.presentCount },
      { label: "Closing", value: (s) => s.closing?.total ?? "" },
    ], sessions),
  );

  await load();
  render();
}
