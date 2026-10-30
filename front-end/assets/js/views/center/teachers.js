import { icon } from "../../core/icons.js";
import {
  $, avatar, badge, confirmDialog, date, debounce, emptyState, formDialog, fullName, html, mount, on, openDialog, pageHeader, relative, toast, whatsappLink, withBusy,
} from "../../core/ui.js";
import { weekGrid } from "../teacher/schedule.js";

export default async function centerTeachers(ctx) {
  const { root, api } = ctx;
  let links = [];
  let results = [];

  async function load() {
    links = (await api.center.teachers()) || [];
  }

  function teacherTile(link, footer) {
    const teacher = link.teacher;
    return html`<article class="tile">
      <div class="person">${avatar(teacher)}<div><strong>${fullName(teacher)}</strong><span>@${teacher.userName}${teacher.companyName ? ` · ${teacher.companyName}` : ""}</span></div></div>
      <div class="status-chips">${(teacher.subject || []).map((subject) => badge(subject, "accent"))}</div>
      ${link.status === "active" ? html`<p>${link.studentsCount} students here · ${link.sessionsCount} sessions · ${link.attendanceCount} check-ins${link.lastSessionAt ? ` · last ${date(link.lastSessionAt)}` : ""}</p>` : ""}
      <div class="tile-foot">${footer}</div>
    </article>`;
  }

  function searchResults() {
    if (!results.length) return html`<p class="muted small">Search the teacher directory by name, username or subject.</p>`;
    return html`<div class="tile-grid">${results.map((teacher) => {
      const link = links.find((item) => String(item.teacher._id) === String(teacher._id));
      return teacherTile({ teacher, status: "none" }, link ? badge(link.status === "active" ? "Linked" : "Pending", link.status === "active" ? "success" : "warn") : html`<button class="btn btn-sm btn-primary" data-action="invite-id" data-id="${teacher.userName}">Invite</button>`);
    })}</div>`;
  }

  function render() {
    const active = links.filter((link) => link.status === "active");
    const requests = links.filter((link) => link.status === "pending" && link.requestedBy === "teacher");
    const invited = links.filter((link) => link.status === "pending" && link.requestedBy === "center");
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Center",
        title: "Teachers",
        text: "Teachers who teach at your center. You see their groups and session closings here — their students' personal data stays private to them.",
        actions: html`<button class="btn btn-primary" data-action="invite">${icon("plus")} Invite a teacher</button>`,
      })}
      ${requests.length
        ? html`<section class="card card-accent mb"><div class="card-head"><div><p class="eyebrow">Requests</p><h3>Teachers asking to join</h3></div></div>
            <div class="tile-grid">${requests.map((link) =>
              teacherTile(link, html`<span class="muted small">${relative(link.createdAt)}</span><span class="row"><button class="btn btn-sm btn-secondary" data-action="reject" data-id="${link.teacher._id}">Decline</button><button class="btn btn-sm btn-primary" data-action="accept" data-id="${link.teacher._id}">Accept</button></span>`),
            )}</div></section>`
        : ""}
      <section class="mb"><h2 class="eyebrow" style="font-size:12px">Teaching at your center (${active.length})</h2>
        ${active.length
          ? html`<div class="tile-grid">${active.map((link) =>
              teacherTile(link, html`<button class="btn btn-sm btn-secondary" data-action="view" data-id="${link.teacher._id}">Groups & contact</button><button class="btn btn-sm btn-ghost" data-action="remove" data-id="${link.teacher._id}">Remove</button>`),
            )}</div>`
          : html`<div class="card">${emptyState("No teachers yet", "Invite teachers by their username, or share your center name so they can request to join.")}</div>`}
      </section>
      ${invited.length
        ? html`<section class="mb"><h2 class="eyebrow" style="font-size:12px">Invitations waiting for an answer</h2>
            <div class="tile-grid">${invited.map((link) => teacherTile(link, html`${badge("Invited", "warn")}<button class="btn btn-sm btn-ghost" data-action="remove" data-id="${link.teacher._id}">Cancel</button>`))}</div></section>`
        : ""}
      <section class="card"><div class="card-head"><div><p class="eyebrow">Directory</p><h3>Find teachers</h3></div></div>
        <label class="search mb">${icon("search", 16)}<input type="search" id="teacher-search" placeholder="Name, username or subject…" aria-label="Search teachers"></label>
        <div id="teacher-results">${searchResults()}</div></section>`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  const search = debounce(async (value) => {
    results = value.trim() ? (await api.directory.teachers({ q: value.trim() }).catch(() => [])) || [] : [];
    mount($("#teacher-results", root), searchResults());
  }, 300);
  on(root, "input", "#teacher-search", (event, input) => search(input.value));

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const id = button.dataset.id;
    const link = links.find((item) => String(item.teacher._id) === id);
    if (action === "invite") {
      const saved = await formDialog({
        title: "Invite a teacher",
        intro: "The teacher gets an invitation in their Learning centers page and can accept it.",
        fields: [{ name: "identifier", label: "Teacher's username, email or phone", required: true, full: true }],
        submitLabel: "Send invitation",
        onSubmit: (body) => api.center.inviteTeacher(body),
      });
      if (saved) await reload(saved.status === "active" ? "Teacher linked." : "Invitation sent.");
    }
    if (action === "invite-id") {
      if (!(await withBusy(button, () => api.center.inviteTeacher({ identifier: id })))) return;
      await reload("Invitation sent.");
      mount($("#teacher-results", root), searchResults());
    }
    if (action === "accept" || action === "reject") {
      if (!(await withBusy(button, () => api.center.answerTeacher(id, action === "accept" ? "active" : "rejected")))) return;
      await reload(action === "accept" ? "Teacher accepted." : "Request declined.");
    }
    if (action === "remove") {
      if (!(await confirmDialog(`Remove ${fullName(link.teacher)} from your center?`, { danger: true, confirmLabel: "Remove" }))) return;
      if (!(await withBusy(button, () => api.center.removeTeacher(id)))) return;
      await reload("Teacher removed.");
    }
    if (action === "view") {
      const teacher = link.teacher;
      openDialog({
        title: fullName(teacher),
        eyebrow: (teacher.subject || []).join(", "),
        size: "xl",
        body: html`<div class="row mb">${teacher.phone ? html`<a class="btn btn-sm btn-secondary" href="tel:${teacher.phone}">${teacher.phone}</a><a class="btn btn-sm btn-success" href="${whatsappLink(teacher.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${teacher.email ? html`<a class="btn btn-sm btn-ghost" href="mailto:${teacher.email}">${teacher.email}</a>` : ""}</div>
          ${link.slots.length ? weekGrid(link.slots) : emptyState("No weekly groups at your center yet")}`,
        actions: html`<button class="btn btn-primary" data-close>Close</button>`,
      });
    }
  });

  await load();
  render();
}
