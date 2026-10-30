import { dateTime, html, money, mount, pageHeader, statTile, table } from "../../core/ui.js";

const SALARY_LABELS = { fixed: "Fixed monthly", hourly: "Per hour", per_session: "Per session" };

export default async function myWork(ctx) {
  const { root, api, me } = ctx;
  const data = await api.assistant.workLog();
  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: "My work", text: `Your check-ins and pay with ${me.teacher.firstName || "your teacher"}. Your teacher records check-in and check-out from each session report.` })}
    <section class="stats">
      ${statTile("Sessions worked", data.sessionsWorked)}
      ${statTile("Hours", Math.round((data.minutes / 60) * 10) / 10)}
      ${statTile("Check-ins recorded", data.attendanceMarked)}
      ${statTile("Students to follow up", data.followUpStudents)}
      ${statTile("Salary estimate", money(data.salaryEstimate), { tone: "accent", hint: data.salary ? `${money(data.salary.amount)} · ${SALARY_LABELS[data.salary.type] || ""}` : "" })}
    </section>
    <section class="card card-flush">${table(
      [
        { label: "Session", render: (row) => row.session.label },
        { label: "Check-in", render: (row) => dateTime(row.checkIn) },
        { label: "Check-out", render: (row) => (row.checkOut ? dateTime(row.checkOut) : "—") },
        { label: "Worked", className: "num", render: (row) => (row.minutes ? `${Math.floor(row.minutes / 60)}h ${row.minutes % 60}m` : "—") },
      ],
      data.log || [],
      { empty: "No check-ins recorded yet." },
    )}</section>`,
  );
}
