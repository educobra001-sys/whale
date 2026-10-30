import { icon } from "../../core/icons.js";
import {
  $, $$, barChart, confirmDialog, date, downloadCSV, formDialog, fullName, gradeLabel, html, mount, on, statTile, toast, withBusy,
} from "../../core/ui.js";
import { matches, studentCell } from "../shared/common.js";
import { examFields } from "./exams.js";

export default async function examDetail(ctx) {
  const { root, api, params, navigate } = ctx;
  let exam;
  let students = [];
  let dirty = false;
  let filter = "";

  async function load() {
    [exam, students] = await Promise.all([api.teacher.exam(params.id), api.teacher.students()]);
  }

  // Roster: students of the exam's grade, plus anyone who already has a score.
  function roster() {
    const scored = new Map(exam.results.map((row) => [String(row.student._id), row.score]));
    const people = students.filter((student) => exam.grade === "" || exam.grade == null || String(student.grade) === String(exam.grade) || scored.has(String(student._id)));
    return people.map((student) => ({ student, score: scored.has(String(student._id)) ? scored.get(String(student._id)) : null })).sort((a, b) => fullName(a.student).localeCompare(fullName(b.student)));
  }

  function distribution() {
    const buckets = [0, 0, 0, 0, 0];
    for (const row of exam.results) {
      const ratio = row.score / exam.maxScore;
      buckets[Math.min(4, Math.floor(ratio * 5))] += 1;
    }
    return ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"].map((label, index) => ({ label, value: buckets[index], tone: index >= 3 ? "success" : index === 0 ? "danger" : "" }));
  }

  function render() {
    const rows = roster().filter((row) => matches(filter, fullName(row.student), row.student.userID));
    const stats = exam.stats || {};
    mount(
      root,
      html`<a class="back-link" href="#/exams">${icon("arrowLeft", 15)} All exams</a>
      <header class="page-header"><div><p class="eyebrow">${date(exam.date)}${exam.grade !== "" && exam.grade != null ? ` · ${gradeLabel(exam.grade)}` : ""}${exam.sessionLabel ? ` · ${exam.sessionLabel}` : ""}</p><h1>${exam.name}</h1>
        <p class="page-text">Full mark ${exam.maxScore}. Leave a box empty for students who were absent.</p></div>
        <div class="page-actions"><button class="btn btn-secondary" data-action="export">${icon("download")} Export</button>
          <button class="btn btn-secondary" data-action="edit">${icon("pencil")} Edit</button><button class="btn btn-danger" data-action="delete">Delete</button></div></header>
      <section class="stats">
        ${statTile("Scores entered", stats.count ?? 0)}
        ${statTile("Average", `${stats.avg ?? 0} / ${exam.maxScore}`)}
        ${statTile("Highest", stats.max ?? "—", { tone: "success" })}
        ${statTile("Lowest", stats.min ?? "—", { tone: "danger" })}
      </section>
      <div class="grid grid-main">
        <section class="card card-flush">
          <div class="card-head"><h3>Scores</h3>
            <div class="row"><label class="search" style="min-width:200px">${icon("search", 16)}<input type="search" id="exam-search" placeholder="Find a student…" value="${filter}" aria-label="Find a student"></label>
            <button class="btn btn-primary" data-action="save">Save scores</button></div></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th class="num">Score / ${exam.maxScore}</th><th class="num">%</th></tr></thead>
            <tbody>${rows.map(
              (row) => html`<tr><td data-label="Student">${studentCell(row.student)}</td>
                <td class="num" data-label="Score"><input class="score-input" type="number" min="0" max="${exam.maxScore}" step="0.5" data-student="${row.student._id}" value="${row.score ?? ""}" aria-label="Score for ${fullName(row.student)}"></td>
                <td class="num" data-label="%">${row.score != null ? `${Math.round((row.score / exam.maxScore) * 100)}%` : html`<span class="muted">—</span>`}</td></tr>`,
            )}</tbody></table></div>
          <p class="muted small" style="padding:0 18px 14px">Tip: press Enter to jump to the next student.</p>
        </section>
        <section class="card"><div class="card-head"><h3>Distribution</h3></div>${barChart(distribution(), { empty: "Enter scores to see the distribution." })}</section>
      </div>`,
    );
  }

  async function save(button) {
    const scores = $$("[data-student]", root).map((input) => ({ student: input.dataset.student, score: input.value === "" ? null : Number(input.value) }));
    const invalid = scores.find((row) => row.score !== null && (row.score < 0 || row.score > exam.maxScore));
    if (invalid) {
      toast(`Scores must be between 0 and ${exam.maxScore}.`, "error");
      return;
    }
    // Keep scores of students not shown in the current filter.
    const shown = new Set(scores.map((row) => row.student));
    const hidden = exam.results.filter((row) => !shown.has(String(row.student._id))).map((row) => ({ student: row.student._id, score: row.score }));
    const updated = await withBusy(button, () => api.teacher.saveScores(exam._id, [...scores, ...hidden]), "Scores saved.");
    if (!updated) return;
    exam = updated;
    dirty = false;
    render();
  }

  on(root, "input", "[data-student]", () => {
    dirty = true;
  });
  on(root, "keydown", "[data-student]", (event, input) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const inputs = $$("[data-student]", root);
    inputs[inputs.indexOf(input) + 1]?.focus();
  });
  on(root, "input", "#exam-search", async (event, input) => {
    if (dirty && !(await confirmDialog("You have unsaved scores. Searching will discard them.", { confirmLabel: "Discard" }))) {
      input.value = filter;
      return;
    }
    filter = input.value;
    dirty = false;
    render();
    const next = $("#exam-search", root);
    next.focus();
    next.setSelectionRange(filter.length, filter.length);
  });
  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "save") save(button);
    if (action === "export") {
      downloadCSV(exam.name.replace(/\W+/g, "-"), [
        { label: "Code", value: (row) => row.student.userID },
        { label: "Name", value: (row) => fullName(row.student) },
        { label: "Score", value: (row) => (row.score ?? "Absent") },
        { label: "Full mark", value: () => exam.maxScore },
      ], roster());
    }
    if (action === "edit") {
      const saved = await formDialog({ title: "Edit exam", fields: await examFields(api, exam), onSubmit: (body) => api.teacher.updateExam(exam._id, body) });
      if (saved) {
        await load();
        render();
        toast("Exam updated.");
      }
    }
    if (action === "delete") {
      if (!(await confirmDialog("Delete this exam and all its scores?", { danger: true, confirmLabel: "Delete exam" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteExam(exam._id)))) return;
      toast("Exam deleted.");
      navigate("#/exams");
    }
  });

  const warnUnsaved = (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", warnUnsaved);

  await load();
  render();
  return () => window.removeEventListener("beforeunload", warnUnsaved);
}
