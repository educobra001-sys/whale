import { PERMISSIONS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  avatar, badge, confirmDialog, dateTime, emptyState, formDialog, fullName, html, money, mount, on, openDialog, pageHeader, statTile, table, toast, withBusy,
} from "../../core/ui.js";

const SALARY_TYPES = [
  { value: "fixed", label: "Fixed monthly" },
  { value: "hourly", label: "Per hour" },
  { value: "per_session", label: "Per session" },
];
const DEFAULT_PERMISSIONS = ["dashboard", "students_view", "sessions_view", "scan_attendance", "scan_homework", "door_check"];

const isAdmin = (assistant) => assistant.role === "Admin" || assistant.role === 0 || assistant.role === "0";

export default async function assistants(ctx) {
  const { root, api } = ctx;
  let list = [];

  async function load() {
    list = (await api.teacher.assistants()) || [];
  }

  const permissionField = (values) => ({
    name: "permissions",
    label: "What can this assistant do?",
    type: "checkboxes",
    options: PERMISSIONS.map((permission) => ({ value: permission.key, label: permission.label })),
    value: values,
  });

  function render() {
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Team",
        title: "Assistants",
        text: "Assistants sign in with their own account and see your students and sessions — only the pages you allow. Full-access assistants can do everything except manage the team, centers and your account.",
        actions: html`<button class="btn btn-primary" data-action="add">${icon("plus")} Add assistant</button>`,
      })}
      ${list.length
        ? html`<div class="tile-grid">${list.map(
            (assistant) => html`<article class="tile">
              <div class="person">${avatar(assistant)}<div><strong>${fullName(assistant)}</strong><span>@${assistant.userName} · ${assistant.phone || ""}</span></div></div>
              <div class="status-chips">${isAdmin(assistant) ? badge("Full access", "accent") : badge(`${(assistant.permissions || []).length} permissions`, "muted")}
                ${assistant.salary?.amount ? badge(`${money(assistant.salary.amount)} ${SALARY_TYPES.find((type) => type.value === assistant.salary.type)?.label.toLowerCase() || ""}`, "info") : ""}
                ${assistant.followUpCount ? badge(`${assistant.followUpCount} students to follow`, "success") : ""}</div>
              <p>${isAdmin(assistant) ? "Can use every teaching page." : (assistant.permissions || []).map((key) => PERMISSIONS.find((permission) => permission.key === key)?.label).filter(Boolean).join(" · ") || "No access yet."}</p>
              <div class="tile-foot">
                <button class="btn btn-sm btn-secondary" data-action="stats" data-id="${assistant._id}">Work & pay</button>
                <span class="row"><button class="btn btn-sm btn-ghost" data-action="edit" data-id="${assistant._id}">Edit</button>
                <button class="btn btn-sm btn-ghost" data-action="remove" data-id="${assistant._id}">Remove</button></span>
              </div>
            </article>`,
          )}</div>`
        : html`<div class="card">${emptyState("No assistants yet", "Add an assistant to help you scan students, check homework and call parents.")}</div>`}`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const assistant = list.find((item) => String(item._id ?? item.id) === button.dataset.id);
    if (action === "add") {
      const saved = await formDialog({
        title: "Add an assistant",
        intro: "The assistant signs in from the Assistant portal with these details.",
        size: "lg",
        fields: [
          { name: "firstName", label: "First name" },
          { name: "lastName", label: "Last name" },
          { name: "userName", label: "Username", required: true, autocomplete: "off" },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "phone", label: "Phone", type: "tel", required: true },
          { name: "password", label: "Password", type: "password", required: true, hint: "At least 8 characters", autocomplete: "new-password" },
          { name: "fullAccess", label: "Full access (admin assistant)", type: "checkbox", full: true },
          permissionField(DEFAULT_PERMISSIONS),
        ],
        submitLabel: "Add assistant",
        onSubmit: async ({ fullAccess, permissions, ...body }) => {
          if (String(body.password).length < 8) throw new Error("The password must be at least 8 characters.");
          const created = await api.teacher.addAssistant(Object.fromEntries(Object.entries(body).filter(([, value]) => value)));
          // The existing POST /teacher/assistants is strict, so role & permissions are saved in a second call.
          const createdId = created.id || created._id;
          await api.teacher.updateAssistant(createdId, { role: fullAccess ? "Admin" : "Assistant", permissions }).catch(() => null);
          return created;
        },
      });
      if (saved) await reload("Assistant added.");
    }
    if (action === "edit") {
      const saved = await formDialog({
        title: `Edit ${fullName(assistant)}`,
        size: "lg",
        fields: [
          { name: "firstName", label: "First name", value: assistant.firstName },
          { name: "lastName", label: "Last name", value: assistant.lastName },
          { name: "phone", label: "Phone", type: "tel", value: assistant.phone },
          { name: "salaryType", label: "Salary type", type: "select", options: SALARY_TYPES, value: assistant.salary?.type || "fixed" },
          { name: "salaryAmount", label: "Salary amount", type: "number", min: 0, value: assistant.salary?.amount ?? 0 },
          { name: "fullAccess", label: "Full access (admin assistant)", type: "checkbox", full: true, checked: isAdmin(assistant) },
          permissionField(assistant.permissions || []),
        ],
        onSubmit: ({ fullAccess, salaryType, salaryAmount, ...body }) =>
          api.teacher.updateAssistant(assistant._id, { ...body, role: fullAccess ? "Admin" : "Assistant", salary: { type: salaryType, amount: salaryAmount || 0 } }),
      });
      if (saved) await reload("Assistant updated.");
    }
    if (action === "remove") {
      if (!(await confirmDialog(`${fullName(assistant)} will lose access immediately. Their past work stays in your records.`, { title: "Remove assistant?", danger: true, confirmLabel: "Remove" }))) return;
      if (!(await withBusy(button, () => api.teacher.removeAssistant(assistant._id)))) return;
      await reload("Assistant removed.");
    }
    if (action === "stats") {
      const stats = await withBusy(button, () => api.teacher.assistantStats(assistant._id));
      if (!stats) return;
      openDialog({
        title: fullName(assistant),
        eyebrow: "Work & pay",
        size: "lg",
        body: html`<section class="stats">
            ${statTile("Sessions worked", stats.sessionsWorked)}
            ${statTile("Hours", Math.round((stats.minutes / 60) * 10) / 10)}
            ${statTile("Check-ins recorded", stats.attendanceMarked)}
            ${statTile("Homework checked", stats.homeworkChecked)}
            ${statTile("Follow-up notes", stats.comments)}
            ${statTile("Salary estimate", money(stats.salaryEstimate), { tone: "accent", hint: SALARY_TYPES.find((type) => type.value === assistant.salary?.type)?.label })}
          </section>
          ${table(
            [
              { label: "Session", render: (row) => html`<a href="#/sessions/${row.session._id}">${row.session.label}</a>` },
              { label: "Check-in", render: (row) => dateTime(row.checkIn) },
              { label: "Check-out", render: (row) => (row.checkOut ? dateTime(row.checkOut) : "—") },
              { label: "Worked", className: "num", render: (row) => (row.minutes ? `${Math.floor(row.minutes / 60)}h ${row.minutes % 60}m` : "—") },
            ],
            stats.log,
            { empty: "No check-ins recorded yet. Check assistants in from a session report." },
          )}`,
        actions: html`<button class="btn btn-primary" data-close>Close</button>`,
      });
    }
  });

  await load();
  render();
}
