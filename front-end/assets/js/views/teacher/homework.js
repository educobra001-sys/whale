import { icon } from "../../core/icons.js";
import { badge, date, formDialog, gradeLabel, html, isoDate, mount, on, pageHeader, table, toast } from "../../core/ui.js";
import { gradeOptions } from "../shared/common.js";

export function homeworkFields(values = {}) {
  return [
    { name: "title", label: "Title", required: true, full: true, value: values.title },
    { name: "description", label: "Instructions", type: "textarea", full: true, value: values.description },
    { name: "startDate", label: "Opens", type: "date", required: true, value: isoDate(values.startDate || new Date()) },
    { name: "endDate", label: "Deadline", type: "date", required: true, value: isoDate(values.endDate || new Date(Date.now() + 6 * 86400000)) },
    { name: "submissionType", label: "How students submit", type: "select", required: true, options: [{ value: "upload", label: "Upload photos / PDF" }, { value: "link", label: "External link (form, quiz…)" }], value: values.submissionType || "upload" },
    { name: "externalLink", label: "External link", type: "url", value: values.externalLink, placeholder: "https://", hint: "Only for “External link” homework." },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade, emptyLabel: "All grades" },
  ];
}

export default async function homework(ctx) {
  const { root, api, navigate } = ctx;
  const list = (await api.teacher.homework()) || [];

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Teaching",
      title: "Online homework",
      text: "Post homework, let students upload their answers, and correct them online. Paper homework is checked at the door from Live scan.",
      actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New homework</button>`,
    })}
    <div class="card card-flush">${table(
      [
        { label: "Homework", render: (hw) => html`<a class="strong" href="#/homework/${hw._id}">#${hw.order} ${hw.title}</a><div class="muted small">${hw.submissionType === "link" ? "External link" : "Upload"}${hw.grade !== "" && hw.grade != null ? ` · ${gradeLabel(hw.grade)}` : ""}</div>` },
        { label: "Opens", render: (hw) => date(hw.startDate) },
        { label: "Deadline", render: (hw) => html`${date(hw.endDate)} ${hw.isOpen ? badge("Open", "success") : badge("Closed", "muted")}` },
        { label: "Submitted", className: "num", render: (hw) => hw.submissionsCount ?? 0 },
        { label: "To correct", className: "num", render: (hw) => (hw.pendingCount ? badge(hw.pendingCount, "warn") : "0") },
        { label: "", className: "actions", render: (hw) => html`<a class="btn btn-sm btn-secondary" href="#/homework/${hw._id}">Open</a>` },
      ],
      list,
      { empty: "No online homework yet." },
    )}</div>`,
  );

  on(root, "click", "[data-action=create]", async () => {
    const created = await formDialog({ title: "New homework", size: "lg", fields: homeworkFields(), submitLabel: "Publish", onSubmit: (body) => api.teacher.createHomework(body) });
    if (created?._id) {
      toast("Homework published to your students.");
      navigate(`#/homework/${created._id}`);
    }
  });
}
