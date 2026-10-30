import { icon } from "../../core/icons.js";
import { $, badge, date, dateTime, emptyState, homeworkBadge, html, mount, on, openDialog, pageHeader, toast } from "../../core/ui.js";
import { requireTeacher } from "./common.js";

const MAX_FILES = 10;
const MAX_SIZE = 10 * 1024 * 1024;

export default async function studentHomework(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  let list = [];

  async function load() {
    list = (await api.student.homework(ctx.teacherId)) || [];
  }

  function card(hw) {
    const sub = hw.submission;
    const canSubmit = hw.isOpen && (!sub || sub.status === "submitted");
    return html`<article class="tile">
      <div class="row-between"><h3>#${hw.order} ${hw.title}</h3>${sub ? homeworkBadge(sub.status) : hw.isOpen ? badge("To do", "warn") : badge("Missed", "danger")}</div>
      ${hw.description ? html`<p style="white-space:pre-line">${hw.description}</p>` : ""}
      <p class="small">📅 ${date(hw.startDate)} → <strong>${date(hw.endDate)}</strong> ${hw.isOpen ? "" : badge("Closed", "muted")}</p>
      ${sub ? html`<p class="small muted">Submitted ${dateTime(sub.submittedAt)} · ${(sub.files || []).length} file(s)</p>` : ""}
      ${sub?.feedback ? html`<div class="notice"><strong>Teacher's feedback:</strong> ${sub.feedback}</div>` : ""}
      <div class="tile-foot">
        ${hw.externalLink ? html`<a class="btn btn-sm btn-secondary" href="${hw.externalLink}" target="_blank" rel="noopener">${icon("link", 14)} Open homework link</a>` : html`<span></span>`}
        ${canSubmit ? html`<button class="btn btn-sm btn-primary" data-action="submit" data-id="${hw._id}">${sub ? "Replace submission" : "Submit"}</button>` : ""}
      </div>
    </article>`;
  }

  function render() {
    const open = list.filter((hw) => hw.isOpen);
    const closed = list.filter((hw) => !hw.isOpen);
    mount(
      root,
      html`${pageHeader({ eyebrow: "Learning", title: "Homework", text: "Upload clear photos or a PDF of your work before the deadline. Paper homework is checked at the door." })}
      ${open.length ? html`<h2 class="eyebrow" style="font-size:12px">Open</h2><div class="tile-grid mb">${open.map(card)}</div>` : html`<div class="card mb">${emptyState("No open homework", "You're all caught up.")}</div>`}
      ${closed.length ? html`<h2 class="eyebrow" style="font-size:12px">Past homework</h2><div class="tile-grid">${closed.map(card)}</div>` : ""}`,
    );
  }

  function submitDialog(hw) {
    const isLink = hw.submissionType === "link";
    const { dialog, close } = openDialog({
      title: hw.title,
      eyebrow: `Due ${date(hw.endDate)}`,
      body: html`${isLink ? html`<div class="notice mb">Solve it on the homework link, then confirm here (you can paste your result link).</div>` : ""}
        <form class="form-grid single">
          ${isLink ? "" : html`<div class="field"><label for="hw-files">Photos or PDF (up to ${MAX_FILES})</label><input id="hw-files" type="file" accept="image/*,application/pdf" multiple></div>`}
          ${isLink ? html`<div class="field"><label for="hw-link">Your result link <span class="optional">optional</span></label><input id="hw-link" type="url" placeholder="https://"></div>` : ""}
          <div class="field"><label for="hw-comment">Note for your teacher <span class="optional">optional</span></label><textarea id="hw-comment" rows="2"></textarea></div>
          <p class="form-error" hidden></p>
        </form>`,
      actions: html`<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-send>Submit homework</button>`,
    });
    $("[data-send]", dialog).addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const error = $(".form-error", dialog);
      const files = [...($("#hw-files", dialog)?.files || [])];
      error.hidden = true;
      try {
        if (!isLink && !files.length) throw new Error("Add at least one photo or PDF.");
        if (files.length > MAX_FILES) throw new Error(`You can upload up to ${MAX_FILES} files.`);
        if (files.some((file) => file.size > MAX_SIZE)) throw new Error("Each file must be 10 MB or less.");
        button.disabled = true;
        button.textContent = files.length ? "Uploading…" : "Sending…";
        const urls = [];
        for (const file of files) urls.push((await api.upload(file)).url);
        await api.student.submitHomework(hw._id, { files: urls, comment: $("#hw-comment", dialog).value.trim(), link: $("#hw-link", dialog)?.value.trim() || "" });
        close();
        toast("Homework submitted.");
        await load();
        render();
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        button.disabled = false;
        button.textContent = "Submit homework";
      }
    });
  }

  on(root, "click", "[data-action=submit]", (event, button) => submitDialog(list.find((hw) => hw._id === button.dataset.id)));

  await load();
  render();
}
