import { icon } from "../../core/icons.js";
import { barChart, date, emptyState, fullName, html, money, mount, pageHeader, statTile, table } from "../../core/ui.js";
import { personCell } from "../shared/common.js";

export default async function centerDashboard(ctx) {
  const { root, api, me } = ctx;
  const data = await api.center.dashboard();
  const { counts } = data;

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Learning center",
      title: me.person.name,
      text: "Teachers working at your center, today's groups and the closing of every session held here.",
      actions: html`<a class="btn btn-primary" href="#/teachers">${icon("users")} Teachers</a>`,
    })}
    ${counts.pending ? html`<div class="notice mb row-between"><span><strong>${counts.pending}</strong> teacher${counts.pending > 1 ? "s" : ""} asked to teach at your center.</span><a class="btn btn-sm btn-primary" href="#/teachers">Review</a></div>` : ""}
    <section class="stats">
      ${statTile("Teachers", counts.teachers, { icon: icon("users", 15), hint: counts.invitations ? `${counts.invitations} invitation(s) sent` : "" })}
      ${statTile("Students", counts.students, { icon: icon("user", 15), hint: "taught at your center" })}
      ${statTile("Sessions this week", counts.sessionsThisWeek, { icon: icon("calendar", 15) })}
      ${statTile("Attendance this week", counts.attendanceThisWeek, { icon: icon("check", 15) })}
      ${statTile("Closings this week", money(data.closingsDue), { tone: "accent", hint: "owed by teachers" })}
    </section>
    <div class="grid grid-main">
      <div class="stack">
        ${data.activeSessions.length
          ? html`<section class="card card-accent"><div class="card-head"><div><p class="eyebrow">Live now</p><h3>Sessions in progress</h3></div></div>
              <ul class="list">${data.activeSessions.map((session) => html`<li class="list-item">${personCell(session.teacher, { sub: session.sequence })}<span class="badge badge-success">${session.presentCount} present</span></li>`)}</ul></section>`
          : ""}
        <section class="card"><div class="card-head"><h3>Attendance by teacher</h3></div>${barChart(data.byTeacher, { empty: "No sessions held at your center yet." })}</section>
        <section class="card card-flush"><div class="card-head"><h3>Recent sessions</h3><a class="btn btn-ghost btn-sm" href="#/sessions">All →</a></div>${table(
          [
            { label: "Teacher", render: (row) => personCell(row.teacher) },
            { label: "Session", render: (row) => row.sequence },
            { label: "Date", render: (row) => date(row.date) },
            { label: "Present", className: "num", render: (row) => row.presentCount },
            { label: "Closing", className: "num", render: (row) => (row.closing ? money(row.closing.total) : html`<span class="muted">Not set</span>`) },
          ],
          data.recentSessions,
          { empty: "No sessions yet." },
        )}</section>
      </div>
      <section class="card"><div class="card-head"><div><p class="eyebrow">Today</p><h3>Groups at your center</h3></div><a class="btn btn-ghost btn-sm" href="#/schedule">Week →</a></div>
        ${data.today.length
          ? html`<ul class="list">${data.today
              .sort((a, b) => a.startTime.localeCompare(b.startTime))
              .map((slot) => html`<li class="list-item"><div class="grow"><p class="strong">${slot.startTime} · ${fullName(slot.teacher)}</p><p class="muted small">${slot.title} · ${slot.durationMinutes} min${slot.notes ? ` · ${slot.notes}` : ""}</p></div></li>`)}</ul>`
          : emptyState("No groups today")}
      </section>
    </div>`,
  );
}
