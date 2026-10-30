import { date, homeworkBadge, html, money, mount, pageHeader, statTile, table, time } from "../../core/ui.js";
import { statusBadge } from "../shared/common.js";
import { requireTeacher } from "./common.js";

export default async function studentSessions(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  const rows = (await api.student.sessions(ctx.teacherId)) || [];
  const counted = rows.filter((row) => ["present", "absent"].includes(row.status));
  const present = counted.filter((row) => row.status === "present").length;

  mount(
    root,
    html`${pageHeader({ eyebrow: "Learning", title: "My sessions", text: "Your attendance, homework result and payments for every session." })}
    <section class="stats">
      ${statTile("Attended", present, { tone: "success" })}
      ${statTile("Missed", counted.length - present, { tone: counted.length - present ? "danger" : "" })}
      ${statTile("Attendance", `${counted.length ? Math.round((present / counted.length) * 100) : 0}%`)}
    </section>
    <div class="card card-flush">${table(
      [
        { label: "Session", render: (row) => html`<strong>Week ${row.session.week} · #${row.session.number}</strong><div class="muted small">${row.session.sequence}</div>` },
        { label: "Date", render: (row) => date(row.session.date) },
        { label: "Attendance", render: (row) => html`${statusBadge(row.status)}${row.markedAt ? html`<div class="muted small">${time(row.markedAt)}${row.location ? ` · ${row.location}` : ""}</div>` : ""}` },
        { label: "Homework", render: (row) => (row.status === "present" ? homeworkBadge(row.homeworkStatus) : "—") },
        { label: "Paid", className: "num", render: (row) => (row.payment ? money(row.payment) : "—") },
        { label: "Note", render: (row) => row.comment || "—" },
      ],
      rows,
      { empty: "No sessions yet." },
    )}</div>`,
  );
}
