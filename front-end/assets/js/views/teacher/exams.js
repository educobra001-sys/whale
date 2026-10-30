import { icon } from "../../core/icons.js";
import { date, formDialog, gradeLabel, html, isoDate, mount, on, pageHeader, table, toast } from "../../core/ui.js";
import { gradeOptions } from "../shared/common.js";

export async function examFields(api, values = {}) {
  const sessions = (await api.teacher.sessions().catch(() => [])) || [];
  return [
    { name: "name", label: "Exam name", required: true, full: true, value: values.name, placeholder: "e.g. Monthly exam — derivatives" },
    { name: "maxScore", label: "Full mark", type: "number", min: 1, required: true, value: values.maxScore ?? 20 },
    { name: "date", label: "Date", type: "date", value: isoDate(values.date || new Date()) },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade, emptyLabel: "All grades" },
    {
      name: "session",
      label: "Linked session",
      type: "select",
      options: sessions.map((session) => ({ value: session._id, label: `Week ${session.week} · #${session.number} · ${session.sequence}` })),
      value: values.session,
      emptyLabel: "Standalone exam",
      hint: "Linking shows the score in that session's follow-up.",
    },
  ];
}

export default async function exams(ctx) {
  const { root, api, navigate } = ctx;
  const list = (await api.teacher.exams()) || [];

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Teaching",
      title: "Exams",
      text: "Record exam and quiz scores. Students and parents see their results and rank instantly.",
      actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New exam</button>`,
    })}
    <div class="card card-flush">${table(
      [
        { label: "Exam", render: (exam) => html`<a class="strong" href="#/exams/${exam._id}">${exam.name}</a>${exam.sessionLabel ? html`<div class="muted small">${exam.sessionLabel}</div>` : ""}` },
        { label: "Date", render: (exam) => date(exam.date) },
        { label: "Grade", render: (exam) => (exam.grade !== "" && exam.grade != null ? gradeLabel(exam.grade) : "All") },
        { label: "Scores entered", className: "num", render: (exam) => exam.stats?.count ?? exam.results?.length ?? 0 },
        { label: "Average", className: "num", render: (exam) => html`${exam.stats?.avg ?? 0} / ${exam.maxScore}` },
        { label: "Highest", className: "num", render: (exam) => exam.stats?.max ?? "—" },
        { label: "", className: "actions", render: (exam) => html`<a class="btn btn-sm btn-secondary" href="#/exams/${exam._id}">Enter scores</a>` },
      ],
      list,
      { empty: "No exams yet. Create one, then type in the scores." },
    )}</div>`,
  );

  on(root, "click", "[data-action=create]", async () => {
    const exam = await formDialog({ title: "New exam", fields: await examFields(api), submitLabel: "Create and enter scores", onSubmit: (body) => api.teacher.createExam(body) });
    if (exam?._id) {
      toast("Exam created.");
      navigate(`#/exams/${exam._id}`);
    }
  });
}
