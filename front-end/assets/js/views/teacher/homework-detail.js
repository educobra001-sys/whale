import { HOMEWORK_STATUS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  $, confirmDialog, date, dateTime, downloadCSV, emptyState, formDialog, fullName, homeworkBadge, html, mount, on, openDialog,
  statTile, table, tabs, toast, withBusy,
} from "../../core/ui.js";
import { studentCell } from "../shared/common.js";
import { homeworkFields } from "./homework.js";

export default async function homeworkDetail(ctx) {
  const { root, api, params, navigate } = ctx;
  let data;
  let students = [];
  let tab = "submitted";

  async function load() {
    [data, students] = await Promise.all([api.teacher.submissions(params.id), api.teacher.students()]);
  }

  function missing() {
    const submitted = new Set(data.submissions.map((sub) => String(sub.student._id)));
    const hw = data.homework;
    return students.filter((student) => !submitted.has(String(student._id)) && (hw.grade === "" || hw.grade == null || String(student.grade) === String(hw.grade)));
  }

  function render() {
    const hw = data.homework;
    const pending = data.submissions.filter((sub) => sub.status === "submitted");
    const graded = data.submissions.filter((sub) => sub.status !== "submitted");
    const absentList = missing();
    const rows = tab === "submitted" ? pending : tab === "graded" ? graded : null;
    mount(
      root,
      html`<a class="back-link" href="#/homework">${icon("arrowLeft", 15)} All homework</a>
      <header class="page-header"><div><p class="eyebrow">Homework #${hw.order} · due ${date(hw.endDate)}</p><h1>${hw.title}</h1>
        ${hw.description ? html`<p class="page-text">${hw.description}</p>` : ""}
        ${hw.externalLink ? html`<p><a href="${hw.externalLink}" target="_blank" rel="noopener">${hw.externalLink}</a></p>` : ""}</div>
        <div class="page-actions"><button class="btn btn-secondary" data-action="export">${icon("download")} Export</button>
          <button class="btn btn-secondary" data-action="edit">${icon("pencil")} Edit</button><button class="btn btn-danger" data-action="delete">Delete</button></div></header>
      <section class="stats">
        ${statTile("To correct", pending.length, { tone: pending.length ? "accent" : "" })}
        ${statTile("Corrected", graded.length)}
        ${statTile("Complete", graded.filter((sub) => sub.status === "complete").length, { tone: "success" })}
        ${statTile("Didn't submit", absentList.length, { tone: absentList.length ? "danger" : "" })}
      </section>
      ${tabs([{ key: "submitted", label: "To correct", count: pending.length }, { key: "graded", label: "Corrected", count: graded.length }, { key: "missing", label: "Didn't submit", count: absentList.length }], tab)}
      <div class="card card-flush">${rows
        ? table(
            [
              { label: "Student", render: (sub) => studentCell(sub.student) },
              { label: "Submitted", render: (sub) => dateTime(sub.submittedAt) },
              { label: "Files", render: (sub) => html`${(sub.files || []).length} file${(sub.files || []).length === 1 ? "" : "s"}${sub.link ? " + link" : ""}` },
              { label: "Student note", render: (sub) => sub.comment || "—" },
              { label: "Status", render: (sub) => homeworkBadge(sub.status) },
              { label: "", className: "actions", render: (sub) => html`<button class="btn btn-sm ${sub.status === "submitted" ? "btn-primary" : "btn-secondary"}" data-action="grade" data-id="${sub._id}">${sub.status === "submitted" ? "Correct" : "Review"}</button>` },
            ],
            rows,
            { empty: tab === "submitted" ? "Nothing waiting to be corrected." : "Nothing corrected yet." },
          )
        : table(
            [
              { label: "Student", render: (student) => studentCell(student) },
              { label: "Phone", render: (student) => student.phone || "—" },
              { label: "Parent", render: (student) => student.parentPhone || "—" },
            ],
            absentList,
            { empty: "Everyone submitted." },
          )}</div>`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  function gradeDialog(sub) {
    const isImage = (url) => /^data:image|\.(png|jpe?g|gif|webp)(\?|$)|images\.unsplash/i.test(url);
    const { dialog, close } = openDialog({
      title: fullName(sub.student),
      eyebrow: `Submitted ${dateTime(sub.submittedAt)}`,
      size: "lg",
      body: html`${sub.comment ? html`<div class="notice mb"><strong>Student note:</strong> ${sub.comment}</div>` : ""}
        ${sub.link ? html`<p><a href="${sub.link}" target="_blank" rel="noopener">${sub.link}</a></p>` : ""}
        <div class="tile-grid mb">${(sub.files || []).map((url, index) =>
          isImage(url)
            ? html`<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Page ${index + 1}" style="width:100%;border-radius:10px;border:1px solid var(--border)"></a>`
            : html`<a class="tile" href="${url}" target="_blank" rel="noopener">${icon("file")} File ${index + 1}</a>`,
        )}</div>
        ${(sub.files || []).length ? "" : emptyState("No files attached")}
        <p class="strong">Result</p>
        <div class="choice-grid mb">${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(([key, info]) => html`<label class="check answer-option"><input type="radio" name="status" value="${key}" ${sub.status === key ? html`checked` : ""}> ${info.label}</label>`)}</div>
        <div class="field"><label for="feedback">Feedback for the student <span class="optional">optional</span></label><textarea id="feedback" rows="3">${sub.feedback || ""}</textarea></div>`,
      actions: html`<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-save>Save result</button>`,
    });
    $("[data-save]", dialog).addEventListener("click", async (event) => {
      const status = dialog.querySelector("input[name=status]:checked")?.value;
      if (!status) {
        toast("Choose a result first.", "error");
        return;
      }
      const saved = await withBusy(event.currentTarget, () => api.teacher.gradeSubmission(sub._id, { status, feedback: $("#feedback", dialog).value.trim() }));
      if (!saved) return;
      close();
      await reload("Result saved.");
    });
  }

  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    render();
  });
  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "grade") gradeDialog(data.submissions.find((sub) => sub._id === button.dataset.id));
    if (action === "edit") {
      const saved = await formDialog({ title: "Edit homework", size: "lg", fields: homeworkFields(data.homework), onSubmit: (body) => api.teacher.updateHomework(data.homework._id, body) });
      if (saved) await reload("Homework updated.");
    }
    if (action === "delete") {
      if (!(await confirmDialog("Delete this homework and all submissions?", { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteHomework(data.homework._id)))) return;
      toast("Homework deleted.");
      navigate("#/homework");
    }
    if (action === "export") {
      downloadCSV(`homework-${data.homework.order}`, [
        { label: "Code", value: (row) => row.student.userID },
        { label: "Name", value: (row) => fullName(row.student) },
        { label: "Status", value: (row) => (row.status ? HOMEWORK_STATUS[row.status]?.label || row.status : "Not submitted") },
        { label: "Submitted", value: (row) => (row.submittedAt ? dateTime(row.submittedAt) : "") },
        { label: "Feedback", value: (row) => row.feedback || "" },
      ], [...data.submissions, ...missing().map((student) => ({ student, status: null }))]);
    }
  });

  await load();
  render();
}
