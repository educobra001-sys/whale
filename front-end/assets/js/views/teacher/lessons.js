import { icon } from "../../core/icons.js";
import { badge, emptyState, formDialog, gradeLabel, html, money, mount, on, pageHeader, toast } from "../../core/ui.js";
import { durationText, gradeOptions } from "../shared/common.js";

export default async function lessons(ctx) {
  const { root, api, navigate } = ctx;
  const list = (await api.teacher.lessons()) || [];
  const weeks = [...new Set(list.map((lesson) => lesson.week))].sort((a, b) => a - b);

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Teaching",
      title: "Video lessons",
      text: "Upload or link lesson videos, split them into parts, add pop-up questions, and control who can watch and how many times.",
      actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New lesson</button>`,
    })}
    ${list.length
      ? weeks.map(
          (week) => html`<section class="mb"><h2 class="eyebrow" style="font-size:12px">Week ${week}</h2>
            <div class="tile-grid">${list
              .filter((lesson) => lesson.week === week)
              .map(
                (lesson) => html`<a class="tile" href="#/lessons/${lesson._id}">
                  <div class="row-between"><h3>${lesson.title}</h3>${lesson.published ? badge("Published", "success") : badge("Draft", "muted")}</div>
                  <p>${lesson.description || ""}</p>
                  <div class="status-chips">${lesson.isFree ? badge("Free", "success") : badge(money(lesson.price), "accent")}
                    ${lesson.grade !== "" && lesson.grade != null ? badge(gradeLabel(lesson.grade), "muted") : ""}
                    ${badge(`${lesson.parts.length} part${lesson.parts.length === 1 ? "" : "s"}`, "muted")}
                    ${lesson.questions.length ? badge(`${lesson.questions.length} question${lesson.questions.length === 1 ? "" : "s"}`, "info") : ""}</div>
                  <div class="tile-foot"><span class="muted small">${durationText(lesson.stats?.durationSeconds)} · ${lesson.stats?.viewers ?? 0} viewers</span>
                    ${lesson.stats?.pendingAnswers ? badge(`${lesson.stats.pendingAnswers} to grade`, "warn") : ""}</div>
                </a>`,
              )}</div></section>`,
        )
      : html`<div class="card">${emptyState("No lessons yet", "Create your first video lesson — paste a YouTube, Vimeo, Google Drive or direct video link.")}</div>`}`,
  );

  on(root, "click", "[data-action=create]", async () => {
    const lesson = await formDialog({
      title: "New video lesson",
      fields: [
        { name: "title", label: "Title", required: true, full: true },
        { name: "week", label: "Week", type: "number", min: 1, value: weeks.length ? weeks[weeks.length - 1] : 1, required: true },
        { name: "grade", label: "Grade", type: "select", options: gradeOptions, emptyLabel: "All grades" },
      ],
      submitLabel: "Create and add videos",
      onSubmit: (body) => api.teacher.createLesson(body),
    });
    if (lesson?._id) {
      toast("Lesson created as a draft.");
      navigate(`#/lessons/${lesson._id}`);
    }
  });
}
