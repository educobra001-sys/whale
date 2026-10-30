import { STORAGE_KEYS, SUBJECTS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { $, avatar, badge, confirmDialog, debounce, emptyState, fullName, html, money, mount, on, openDialog, pageHeader, toast, withBusy } from "../../core/ui.js";
import { weekGrid } from "../teacher/schedule.js";

export default async function studentTeachers(ctx) {
  const { root, api, me, reloadMe } = ctx;
  let directory = [];
  const filters = { q: "", subject: "" };

  const statusOf = (teacherId) => (me.teachers || []).find((entry) => String(entry.teacher._id) === String(teacherId));

  function teacherCard(teacher) {
    const entry = statusOf(teacher._id);
    const state = entry?.status === "active" ? badge("Subscribed", "success") : entry?.status === "pending" ? badge("Request sent", "warn") : badge("Not subscribed", "muted");
    let action;
    if (entry?.status === "active") action = html`<button class="btn btn-sm btn-primary" data-action="open" data-id="${teacher._id}">Open</button>`;
    else if (entry?.status === "pending") action = html`<button class="btn btn-sm btn-ghost" data-action="cancel" data-id="${teacher._id}">Cancel request</button>`;
    else action = html`<button class="btn btn-sm btn-primary" data-action="request" data-id="${teacher._id}">Request to join</button>`;
    return html`<article class="tile">
      <div class="row-between"><div class="person">${avatar(teacher)}<div><strong>${fullName(teacher)}</strong><span>${teacher.companyName || `@${teacher.userName}`}</span></div></div>${state}</div>
      <div class="status-chips">${(teacher.subject || []).map((subject) => badge(subject, "accent"))}${teacher.teachingLanguage ? badge(teacher.teachingLanguage, "muted") : ""}</div>
      ${teacher.bio ? html`<p>${teacher.bio}</p>` : ""}
      ${teacher.centers?.length ? html`<p class="small">${icon("building", 14)} ${teacher.centers.join(" · ")}</p>` : ""}
      ${entry?.status === "active" && entry.balance !== null && entry.balance !== undefined ? html`<p class="small">Your balance: <strong>${money(entry.balance)}</strong></p>` : ""}
      <div class="tile-foot"><button class="btn btn-sm btn-ghost" data-action="profile" data-id="${teacher._id}">View profile</button>${action}</div>
    </article>`;
  }

  function directoryHtml() {
    const subscribed = new Set((me.teachers || []).map((entry) => String(entry.teacher._id)));
    const others = directory.filter((teacher) => !subscribed.has(String(teacher._id)));
    return others.length ? html`<div class="tile-grid">${others.map(teacherCard)}</div>` : html`<div class="card">${emptyState("No other teachers found", "Try another name or subject.")}</div>`;
  }

  function render() {
    const mine = (me.teachers || []).map((entry) => ({ ...entry.teacher }));
    mount(
      root,
      html`${pageHeader({ eyebrow: "Teachers", title: "Your teachers", text: "One account for all your teachers. Teachers you haven't joined show as “Not subscribed” — send a request and the teacher approves it." })}
      <section class="mb">${mine.length ? html`<div class="tile-grid">${mine.map(teacherCard)}</div>` : html`<div class="card">${emptyState("You haven't joined a teacher yet", "Find your teacher below and send a request.")}</div>`}</section>
      <section class="card mb"><div class="card-head"><div><p class="eyebrow">Directory</p><h3>Discover teachers</h3></div></div>
        <div class="toolbar"><label class="search">${icon("search", 16)}<input type="search" id="dir-search" placeholder="Teacher name or username…" value="${filters.q}" aria-label="Search teachers"></label>
          <select class="select-sm" id="dir-subject" aria-label="Subject"><option value="">All subjects</option>${SUBJECTS.map((subject) => html`<option ${filters.subject === subject ? html`selected` : ""}>${subject}</option>`)}</select></div>
      </section>
      <div id="dir-results">${directoryHtml()}</div>`,
    );
  }

  async function search() {
    directory = (await api.directory.teachers({ q: filters.q, subject: filters.subject }).catch(() => [])) || [];
    mount($("#dir-results", root), directoryHtml());
  }
  const searchSoon = debounce(search, 300);

  on(root, "input", "#dir-search", (event, input) => {
    filters.q = input.value;
    searchSoon();
  });
  on(root, "change", "#dir-subject", (event, select) => {
    filters.subject = select.value;
    search();
  });
  on(root, "click", "[data-action]", async (event, button) => {
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (action === "request") {
      if (!(await withBusy(button, () => api.student.requestTeacher(id)))) return;
      toast("Request sent. You'll get access once the teacher approves.");
      await reloadMe();
    }
    if (action === "cancel") {
      if (!(await confirmDialog("Cancel your join request?", { confirmLabel: "Cancel request" }))) return;
      if (!(await withBusy(button, () => api.student.cancelRequest(id)))) return;
      await reloadMe();
    }
    if (action === "open") {
      localStorage.setItem(STORAGE_KEYS.activeTeacher, id);
      await reloadMe();
      ctx.navigate("#/home");
    }
    if (action === "profile") {
      const profile = await withBusy(button, () => api.directory.teacher(id));
      if (!profile) return;
      openDialog({
        title: fullName(profile),
        eyebrow: (profile.subject || []).join(", "),
        size: "xl",
        body: html`<div class="person mb">${avatar(profile, "lg")}<div><strong>${profile.companyName || fullName(profile)}</strong><span>${profile.studentsCount ?? 0} students · teaches in ${profile.teachingLanguage || "—"}</span></div></div>
          ${profile.bio ? html`<p>${profile.bio}</p>` : ""}
          ${profile.centers?.length ? html`<p class="strong">Centers</p><ul class="list mb">${profile.centers.map((center) => html`<li class="list-item"><span>${center.name}</span><span class="muted small">${center.textlocation || ""}</span></li>`)}</ul>` : ""}
          <p class="strong">Weekly groups</p>${profile.schedule?.length ? weekGrid(profile.schedule) : emptyState("No public schedule")}`,
        actions: html`<button class="btn btn-primary" data-close>Close</button>`,
      });
    }
  });

  render();
  search();
}
