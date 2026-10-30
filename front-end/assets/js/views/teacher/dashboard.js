import { icon } from "../../core/icons.js";
import { barChart, emptyState, fullName, html, money, mount, pageHeader, relative, statTile, badge } from "../../core/ui.js";
import { balanceText, studentCell } from "../shared/common.js";

export default async function dashboard({ root, api, me, can, role }) {
  const data = await api.teacher.dashboard();
  const { counts } = data;
  const active = data.activeSession;
  const firstName = me.person.firstName || me.name;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const tasks = [
    counts.pendingRequests && can("students_manage") ? { href: "#/students?tab=requests", text: `${counts.pendingRequests} student${counts.pendingRequests === 1 ? "" : "s"} asked to join`, icon: "users" } : null,
    counts.pendingTopups && can("wallet") ? { href: "#/wallet?tab=topups", text: `${counts.pendingTopups} transfer receipt${counts.pendingTopups === 1 ? "" : "s"} to review`, icon: "wallet" } : null,
    counts.pendingSubmissions && can("homework_online") ? { href: "#/homework", text: `${counts.pendingSubmissions} homework submission${counts.pendingSubmissions === 1 ? "" : "s"} to correct`, icon: "pencil" } : null,
    counts.lowBalance ? { href: "#/students?filter=low", text: `${counts.lowBalance} student${counts.lowBalance === 1 ? "" : "s"} can't cover the next session`, icon: "wallet" } : null,
  ].filter(Boolean);

  mount(
    root,
    html`${pageHeader({
      eyebrow: role === "assistant" ? `Assisting ${fullName(me.teacher)}` : "Overview",
      title: `${greeting}, ${firstName}.`,
      text: "Here's what's happening in your classroom today.",
      actions: html`${can("sessions_manage") ? html`<a class="btn btn-secondary" href="#/sessions?new=1">${icon("plus")} New session</a>` : ""}
        ${can(["scan_attendance", "scan_homework", "door_check"]) ? html`<a class="btn btn-primary" href="#/scan">${icon("scan")} Open live scan</a>` : ""}`,
    })}

    ${active
      ? html`<div class="notice notice-success mb row-between">
          <span><strong>Live now:</strong> Week ${active.week} · Session ${active.number} — ${active.sequence} · ${active.presentCount} present</span>
          <span class="row"><a class="btn btn-sm btn-success" href="#/scan">Scan students</a><a class="btn btn-sm btn-secondary" href="#/sessions/${active._id}">Open report</a></span>
        </div>`
      : ""}

    <section class="stats">
      ${statTile("Active students", counts.students, { icon: icon("users", 15), hint: `${counts.blocked} blocked` })}
      ${statTile("Students' balances", money(data.totalBalance), { icon: icon("wallet", 15), tone: data.totalBalance < 0 ? "danger" : "" })}
      ${statTile("Low balance", counts.lowBalance, { icon: icon("flag", 15), tone: counts.lowBalance ? "danger" : "", hint: "below one session price" })}
      ${statTile("Team", `${counts.assistants} · ${counts.centers}`, { icon: icon("building", 15), hint: "assistants · centers" })}
    </section>

    <div class="grid grid-main">
      <div class="stack">
        <section class="card card-accent">
          <div class="card-head"><div><p class="eyebrow">Attendance</p><h2>Last sessions</h2></div>
            ${can("sessions_view") ? html`<a class="btn btn-ghost btn-sm" href="#/sessions">All sessions →</a>` : ""}</div>
          ${barChart(data.attendanceTrend, { empty: "Attendance will appear after your first session." })}
        </section>
        <div class="grid grid-2">
          <section class="card">
            <div class="card-head"><h3>By center</h3></div>
            ${data.byCenter.length ? html`<ul class="list">${data.byCenter.map((row) => html`<li class="list-item"><span>${row.label}</span><strong>${row.value}</strong></li>`)}</ul>` : emptyState("No students yet")}
          </section>
          <section class="card">
            <div class="card-head"><h3>By grade</h3></div>
            ${data.byGrade.length ? html`<ul class="list">${data.byGrade.map((row) => html`<li class="list-item"><span>${row.label}</span><strong>${row.value}</strong></li>`)}</ul>` : emptyState("No students yet")}
          </section>
        </div>
        <section class="card">
          <div class="card-head"><div><p class="eyebrow">Needs attention</p><h3>Lowest balances</h3></div>
            ${can("students_view") ? html`<a class="btn btn-ghost btn-sm" href="#/students?filter=low">See all →</a>` : ""}</div>
          ${data.lowBalanceStudents.length
            ? html`<ul class="list">${data.lowBalanceStudents.map(
                (student) => html`<li class="list-item">${studentCell(student, student.centerName)}<span>${balanceText(student.balance)}</span></li>`,
              )}</ul>`
            : emptyState("Everyone is covered", "No student is below one session price.")}
        </section>
      </div>

      <div class="stack">
        <section class="card card-accent">
          <div class="card-head"><div><p class="eyebrow">To do</p><h3>Waiting for you</h3></div></div>
          ${tasks.length
            ? html`<ul class="list">${tasks.map((task) => html`<li class="list-item"><a class="person" href="${task.href}"><span class="avatar avatar-sm">${icon(task.icon, 15)}</span><div><strong>${task.text}</strong></div></a></li>`)}</ul>`
            : emptyState("All caught up", "Nothing is waiting for you right now.")}
        </section>
        <section class="card">
          <div class="card-head"><div><p class="eyebrow">Today</p><h3>Your schedule</h3></div>
            ${can("schedule") ? html`<a class="btn btn-ghost btn-sm" href="#/schedule">Week →</a>` : ""}</div>
          ${data.todaySlots.length
            ? html`<ul class="list">${data.todaySlots.map(
                (slot) => html`<li class="list-item"><div class="grow"><p class="strong">${slot.startTime} · ${slot.title}</p><p class="muted small">${slot.centerName || "No center"} · ${slot.durationMinutes} min</p></div>
                  ${can("sessions_manage") ? html`<a class="btn btn-sm btn-secondary" href="#/schedule">Start</a>` : ""}</li>`,
              )}</ul>`
            : emptyState("No groups today")}
        </section>
        <section class="card">
          <div class="card-head"><h3>Recent activity</h3></div>
          ${data.recent.length
            ? html`<ul class="timeline">${data.recent.map(
                (item) => html`<li><p>${item.text} ${item.amount ? badge(money(item.amount), item.amount > 0 ? "success" : "danger") : ""}</p><p class="muted small">${relative(item.createdAt)}</p></li>`,
              )}</ul>`
            : emptyState("No activity yet")}
        </section>
      </div>
    </div>`,
  );
}
