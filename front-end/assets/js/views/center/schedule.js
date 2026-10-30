import { downloadCSV, fullName, html, mount, on, pageHeader } from "../../core/ui.js";
import { DAYS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { weekGrid } from "../teacher/schedule.js";

export default async function centerSchedule(ctx) {
  const { root, api } = ctx;
  const slots = ((await api.center.schedule()) || []).filter((slot) => slot.isActive);
  const teachers = [...new Map(slots.map((slot) => [slot.teacher?._id, slot.teacher])).values()].filter(Boolean);
  let teacherFilter = "";

  function render() {
    const visible = slots.filter((slot) => !teacherFilter || String(slot.teacher?._id) === teacherFilter);
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Center",
        title: "Weekly schedule",
        text: "All groups that linked teachers hold at your center. Teachers manage their own groups; this view updates automatically.",
        actions: html`<button class="btn btn-secondary" data-action="export">${icon("download")} Export</button>`,
      })}
      ${teachers.length > 1 ? html`<div class="toolbar"><select class="select-sm" id="teacher-filter" aria-label="Teacher"><option value="">All teachers</option>${teachers.map((teacher) => html`<option value="${teacher._id}" ${teacherFilter === String(teacher._id) ? html`selected` : ""}>${fullName(teacher)}</option>`)}</select></div>` : ""}
      ${weekGrid(visible, { showTeacher: true })}`,
    );
  }

  on(root, "change", "#teacher-filter", (event, select) => {
    teacherFilter = select.value;
    render();
  });
  on(root, "click", "[data-action=export]", () =>
    downloadCSV("center-schedule", [
      { label: "Day", value: (slot) => DAYS[slot.dayOfWeek] },
      { label: "Start", value: (slot) => slot.startTime },
      { label: "Minutes", value: (slot) => slot.durationMinutes },
      { label: "Teacher", value: (slot) => fullName(slot.teacher) },
      { label: "Subject", value: (slot) => (slot.teacher?.subject || []).join(" / ") },
      { label: "Group", value: (slot) => slot.title },
      { label: "Notes", value: (slot) => slot.notes },
    ], slots.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))),
  );
  render();
}
