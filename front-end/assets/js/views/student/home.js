import { DAYS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { badge, date, emptyState, fullName, gradeLabel, homeworkBadge, html, money, mount, qrDataUrl, statTile, whatsappLink } from "../../core/ui.js";
import { announcementCard } from "../teacher/announcements.js";
import { statusBadge } from "../shared/common.js";
import { requireTeacher } from "./common.js";

function startsIn(minutes) {
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 1440) return `in ${Math.round(minutes / 60)} h`;
  return `in ${Math.round(minutes / 1440)} day${Math.round(minutes / 1440) === 1 ? "" : "s"}`;
}

export default async function studentHome(ctx) {
  const { root, api, me } = ctx;
  const student = me.person;
  const qr = await qrDataUrl(student.userID).catch(() => "");
  const idCard = html`<section class="id-card mb">
    <div><p class="eyebrow">Hello, ${student.firstName} 👋</p><p class="code">${student.userID}</p>
      <p class="muted small" style="margin:0">${gradeLabel(student.grade)} · ${student.schoolName || ""}<br>Show this QR code at the door to check in.</p></div>
    ${qr ? html`<img class="qr-img" src="${qr}" alt="Your student QR code">` : ""}
  </section>`;

  if (!ctx.teacherId) {
    mount(root, html`${idCard}<div id="no-teacher"></div>`);
    requireTeacher({ ...ctx, root: root.querySelector("#no-teacher") });
    return;
  }

  const data = await api.student.overview(ctx.teacherId);
  const teacher = data.teacher;
  const lowBalance = data.balance < (data.pricePerSession || 0);

  mount(
    root,
    html`${idCard}
    ${data.isBlocked ? html`<div class="notice notice-danger mb"><strong>Your account with ${fullName(teacher)} is blocked.</strong> Please contact your teacher.</div>` : ""}
    ${lowBalance ? html`<div class="notice mb row-between"><span>Your balance (${money(data.balance)}) doesn't cover the next session (${money(data.pricePerSession)}).</span><a class="btn btn-sm btn-primary" href="#/wallet">Top up</a></div>` : ""}
    <section class="stats">
      ${statTile("Wallet", money(data.balance), { icon: icon("wallet", 15), tone: data.balance < 0 ? "danger" : "accent", hint: `${money(data.pricePerSession)} per session` })}
      ${statTile("Points", data.points, { icon: icon("trophy", 15), hint: data.rank ? `Rank ${data.rank} of ${data.classSize}` : "" })}
      ${statTile("Attendance", `${data.stats.attendanceRate}%`, { icon: icon("calendar", 15), hint: `${data.stats.present} sessions attended` })}
      ${statTile("Homework done", `${data.stats.homeworkRate}%`, { icon: icon("pencil", 15) })}
      ${statTile("Exam average", `${data.stats.examAvg}%`, { icon: icon("award", 15) })}
    </section>
    <div class="grid grid-main">
      <div class="stack">
        <section class="card card-accent">
          <div class="card-head"><div><p class="eyebrow">Next session</p><h3>${data.nextSlot ? `${DAYS[data.nextSlot.dayOfWeek]} at ${data.nextSlot.startTime}` : "No upcoming group"}</h3></div>
            ${data.nextSlot ? badge(startsIn(data.nextSlot.startsInMinutes), "accent") : ""}</div>
          ${data.nextSlot ? html`<p class="muted">${data.nextSlot.title} · ${data.nextSlot.centerName || "Online"} · ${data.nextSlot.durationMinutes} min</p>` : ""}
          ${data.lastSession
            ? html`<div class="card-section"><p class="eyebrow">Last session</p>
                <p class="strong" style="margin:0">${data.lastSession.session.sequence}</p>
                <p class="muted small">${date(data.lastSession.session.date)} · ${statusBadge(data.lastSession.status)} ${data.lastSession.status === "present" ? homeworkBadge(data.lastSession.homeworkStatus) : ""}</p></div>`
            : ""}
        </section>
        <section><h2 class="eyebrow" style="font-size:12px">From ${fullName(teacher)}</h2>
          ${data.announcements.length ? html`<div class="tile-grid">${data.announcements.map((item) => announcementCard(item))}</div>` : html`<div class="card">${emptyState("No announcements")}</div>`}
        </section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h3>Quick links</h3></div>
          <div class="grid grid-2">
            <a class="btn btn-secondary" href="#/lessons">${icon("play", 16)} Lessons</a>
            <a class="btn btn-secondary" href="#/homework">${icon("pencil", 16)} Homework</a>
            <a class="btn btn-secondary" href="#/exams">${icon("award", 16)} Exams</a>
            <a class="btn btn-secondary" href="#/booklets">${icon("book", 16)} Booklets</a>
          </div></section>
        ${data.followUp
          ? html`<section class="card"><div class="card-head"><h3>Your follow-up assistant</h3></div>
              <p class="strong">${data.followUp.name}</p>
              ${data.followUp.phone ? html`<a class="btn btn-sm btn-success" href="${whatsappLink(data.followUp.phone, `Hello, I'm ${fullName(student)} (${student.userID}).`)}" target="_blank" rel="noopener">Message on WhatsApp</a>` : ""}</section>`
          : ""}
        ${data.warnings.length
          ? html`<section class="card"><div class="card-head"><h3>Warnings</h3>${badge(`${data.warnings.length} / 3`, "danger")}</div>
              <ul class="list">${data.warnings.map((warning) => html`<li class="list-item"><span>${warning.reason || "Warning"}</span><span class="muted small">${date(warning.createdAt)}</span></li>`)}</ul>
              <p class="muted small">Three warnings block your account with this teacher.</p></section>`
          : ""}
      </div>
    </div>`,
  );
}
