import { DAYS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { badge, confirmDialog, formDialog, gradeLabel, html, mount, on, pageHeader, toast, withBusy } from "../../core/ui.js";
import { centerOptions, gradeOptions } from "../shared/common.js";

export function weekGrid(slots, { actions = () => "", showTeacher = false } = {}) {
  const today = new Date().getDay();
  return html`<div class="week-grid">${DAYS.map((day, index) => {
    const daySlots = slots.filter((slot) => Number(slot.dayOfWeek) === index).sort((a, b) => a.startTime.localeCompare(b.startTime));
    return html`<section class="day-col ${index === today ? "is-today" : ""}">
      <h3>${day}${index === today ? html` ${badge("Today", "accent")}` : ""}</h3>
      ${daySlots.length
        ? daySlots.map(
            (slot) => html`<div class="slot ${slot.isActive ? "" : "is-off"}">
              <strong>${slot.startTime} · ${slot.title}</strong>
              ${showTeacher && slot.teacher ? html`<span>${slot.teacher.firstName} ${slot.teacher.lastName} · ${(slot.teacher.subject || []).join(", ")}</span><br>` : ""}
              <span class="muted">${slot.centerName || "Online"} · ${slot.durationMinutes} min${slot.grade !== "" && slot.grade != null ? ` · ${gradeLabel(slot.grade)}` : ""}</span>
              ${slot.notes ? html`<div class="muted small">${slot.notes}</div>` : ""}
              ${actions(slot)}
            </div>`,
          )
        : html`<p class="muted small" style="margin:0">Free</p>`}
    </section>`;
  })}</div>`;
}

export default async function schedule(ctx) {
  const { root, api, can, navigate } = ctx;
  const centers = await centerOptions();
  let slots = [];

  const fields = (values = {}) => [
    { name: "title", label: "Group name", required: true, value: values.title, placeholder: "e.g. S3 · Group A" },
    { name: "dayOfWeek", label: "Day", type: "select", required: true, options: DAYS.map((label, index) => ({ value: String(index), label })), value: values.dayOfWeek !== undefined ? String(values.dayOfWeek) : "" },
    { name: "startTime", label: "Start time", type: "time", required: true, value: values.startTime || "16:00" },
    { name: "durationMinutes", label: "Duration (minutes)", type: "number", min: 15, step: 15, value: values.durationMinutes || 90 },
    { name: "center", label: "Center", type: "select", options: centers, value: values.center, emptyLabel: "Online / no center" },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade, emptyLabel: "All grades" },
    { name: "notes", label: "Notes", value: values.notes, full: true, placeholder: "Hall, room, reminders…" },
    { name: "isActive", label: "Active", type: "checkbox", checked: values.isActive !== false },
  ];

  async function load() {
    slots = (await api.teacher.schedule()) || [];
  }

  function render() {
    const manage = can("schedule");
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Classroom",
        title: "Weekly schedule",
        text: "Your recurring groups. Start a session from a group to get the right center and grade automatically. Linked centers see these groups in their own schedule.",
        actions: manage ? html`<button class="btn btn-primary" data-action="add">${icon("plus")} Add group</button>` : "",
      })}
      ${weekGrid(slots, {
        actions: (slot) =>
          html`<div class="slot-actions">
            ${slot.isActive && can("sessions_manage") ? html`<button class="btn btn-sm btn-primary" data-action="start" data-id="${slot._id}">Start</button>` : ""}
            ${manage ? html`<button class="btn btn-sm btn-ghost" data-action="edit" data-id="${slot._id}">Edit</button><button class="btn btn-sm btn-ghost" data-action="delete" data-id="${slot._id}">Delete</button>` : ""}
          </div>`,
      })}`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  on(root, "click", "[data-action]", async (event, button) => {
    const slot = slots.find((item) => item._id === button.dataset.id);
    const action = button.dataset.action;
    if (action === "add" || action === "edit") {
      const saved = await formDialog({
        title: action === "add" ? "Add a weekly group" : "Edit group",
        fields: fields(slot),
        onSubmit: (body) => (slot ? api.teacher.updateSlot(slot._id, body) : api.teacher.createSlot(body)),
      });
      if (saved) await reload(action === "add" ? "Group added." : "Group updated.");
    }
    if (action === "delete") {
      if (!(await confirmDialog(`Delete “${slot.title}” from your weekly schedule? Past sessions are not affected.`, { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteSlot(slot._id)))) return;
      await reload("Group deleted.");
    }
    if (action === "start") {
      const session = await formDialog({
        title: `Start ${slot.title}`,
        intro: "Creates today's session for this group and makes it live for scanning.",
        fields: [{ name: "sequence", label: "Topic", required: true, full: true, placeholder: "What are you teaching today?" }],
        submitLabel: "Start session",
        onSubmit: (body) => api.teacher.startSlot(slot._id, body),
      });
      if (session?._id) {
        toast("Session is live.");
        navigate("#/scan");
      }
    }
  });

  await load();
  render();
}
