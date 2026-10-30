import { icon } from "../../core/icons.js";
import { confirmDialog, dateTime, emptyState, html, money, mount, on, pageHeader, toast, withBusy } from "../../core/ui.js";
import { accessBadge, durationText } from "../shared/common.js";
import { requireTeacher } from "./common.js";

export function accessText(access) {
  switch (access.state) {
    case "free":
      return "Free lesson";
    case "granted":
      return `${access.viewsLeft} view${access.viewsLeft === 1 ? "" : "s"} left · ${access.startsOnOpen ? "time starts on first open" : `until ${dateTime(access.expiresAt)}`}`;
    case "available":
      return `Free because you attended · ${access.views} views for ${access.hours}h`;
    case "expired":
      return "Your access time ended";
    case "exhausted":
      return "You used all your views";
    default:
      return `Unlock for ${money(access.price)} · ${access.views} views for ${access.hours}h`;
  }
}

export async function unlock(api, lesson) {
  const paying = lesson.access.state !== "available";
  if (paying && !(await confirmDialog(`Pay ${money(lesson.access.price ?? lesson.price)} from your wallet to unlock “${lesson.title}”?`, { title: "Unlock lesson", confirmLabel: `Pay ${money(lesson.access.price ?? lesson.price)}` }))) return null;
  return api.student.unlockLesson(lesson._id);
}

export default async function studentLessons(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api, navigate } = ctx;
  let list = [];

  async function load() {
    list = (await api.student.lessons(ctx.teacherId)) || [];
  }

  function render() {
    const weeks = [...new Set(list.map((lesson) => lesson.week))].sort((a, b) => b - a);
    mount(
      root,
      html`${pageHeader({ eyebrow: "Learning", title: "Video lessons", text: "Lessons from sessions you attended open for free. Others can be unlocked with your wallet balance." })}
      ${list.length
        ? weeks.map(
            (week) => html`<section class="mb"><h2 class="eyebrow" style="font-size:12px">Week ${week}</h2><div class="tile-grid">${list
              .filter((lesson) => lesson.week === week)
              .map((lesson) => {
                const open = ["free", "granted"].includes(lesson.access.state);
                const progress = lesson.durationSeconds ? Math.min(100, (lesson.watchedSeconds / lesson.durationSeconds) * 100) : 0;
                return html`<article class="tile">
                  <div class="row-between"><h3>${lesson.title}</h3>${accessBadge(lesson.access)}</div>
                  ${lesson.description ? html`<p>${lesson.description}</p>` : ""}
                  <p class="small">${icon("play", 13)} ${lesson.partsCount} part${lesson.partsCount === 1 ? "" : "s"} · ${durationText(lesson.durationSeconds)}${lesson.questionsCount ? ` · ${lesson.questionsCount} questions` : ""}</p>
                  ${progress ? html`<div class="meter meter-success"><span style="width:${progress}%"></span></div>` : ""}
                  <p class="small muted">${accessText(lesson.access)}</p>
                  <div class="tile-foot"><span></span>${
                    open
                      ? html`<a class="btn btn-sm btn-primary" href="#/lessons/${lesson._id}">${icon("play", 14)} Watch</a>`
                      : lesson.access.state === "available"
                        ? html`<button class="btn btn-sm btn-primary" data-action="unlock" data-id="${lesson._id}">Open for free</button>`
                        : html`<button class="btn btn-sm btn-secondary" data-action="unlock" data-id="${lesson._id}">${lesson.access.state === "locked" ? "Unlock" : "Buy again"} · ${money(lesson.access.price ?? lesson.price)}</button>`
                  }</div>
                </article>`;
              })}</div></section>`,
          )
        : html`<div class="card">${emptyState("No lessons yet", "Your teacher hasn't published video lessons yet.")}</div>`}`,
    );
  }

  on(root, "click", "[data-action=unlock]", async (event, button) => {
    const lesson = list.find((item) => item._id === button.dataset.id);
    const result = await withBusy(button, () => unlock(api, lesson));
    if (!result || result === true) return;
    toast("Lesson unlocked.");
    navigate(`#/lessons/${lesson._id}`);
  });

  await load();
  render();
}
