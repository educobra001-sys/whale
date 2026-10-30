import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, dateTime, emptyState, fieldHtml, formDialog, fullName, html, mount, on, openDialog, readForm, statTile, table,
  tabs, toast, withBusy,
} from "../../core/ui.js";
import { accessBadge, durationText, embedUrl, gradeOptions, studentCell, studentOptions } from "../shared/common.js";

const CATEGORIES = [
  { value: "explanation", label: "Explanation" },
  { value: "questions", label: "Questions" },
  { value: "homework_solution", label: "Homework solution" },
];
const categoryLabel = (value) => CATEGORIES.find((item) => item.value === value)?.label || value;

export default async function lessonEditor(ctx) {
  const { root, api, params, query, setQuery, navigate } = ctx;
  let tab = query.tab || "parts";
  let lesson;
  let draft;
  let dirty = false;
  let sessions = [];
  let students = [];
  let answers = [];

  async function load() {
    [lesson, sessions, students, answers] = await Promise.all([
      api.teacher.lesson(params.id),
      api.teacher.sessions().catch(() => []),
      api.teacher.students().catch(() => []),
      api.teacher.lessonAnswers(params.id).catch(() => []),
    ]);
    draft = structuredClone(lesson);
    dirty = false;
  }

  const detailFields = () => [
    { name: "title", label: "Title", required: true, full: true, value: draft.title },
    { name: "description", label: "Description", type: "textarea", full: true, value: draft.description },
    { name: "week", label: "Week", type: "number", min: 1, value: draft.week },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: draft.grade, emptyLabel: "All grades" },
    { name: "isFree", label: "Free for every student", type: "checkbox", checked: draft.isFree },
    { name: "published", label: "Published (visible to students)", type: "checkbox", checked: draft.published },
    { name: "price", label: "Price to unlock", type: "number", min: 0, value: draft.price, hint: "Paid from the student's balance." },
    { name: "accessHours", label: "Access lasts (hours)", type: "number", min: 1, value: draft.accessHours, hint: "Counted from the first time the student opens it." },
    { name: "viewsIfAttended", label: "Views for students who attended", type: "number", min: 0, value: draft.viewsIfAttended },
    { name: "viewsIfPaid", label: "Views for students who paid", type: "number", min: 0, value: draft.viewsIfPaid },
    {
      name: "sessions",
      label: "Linked sessions — students who attended these get free access",
      type: "checkboxes",
      options: sessions.slice(0, 30).map((session) => ({ value: session._id, label: `Week ${session.week} · #${session.number} · ${session.sequence}` })),
      value: draft.sessions,
    },
  ];

  function partsTab() {
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">Students watch parts in this order. Paste a YouTube / Vimeo / Drive link or upload a video file.</p>
        <button class="btn btn-sm btn-primary" data-action="add-part">${icon("plus", 15)} Add part</button></div>
      ${draft.parts.length
        ? html`<ul class="list part-list">${draft.parts.map(
            (part, index) => html`<li class="list-item card" style="margin-bottom:10px;padding:12px 14px">
              <div class="grow"><p class="strong">${index + 1}. ${part.title}</p>
                <p class="muted small">${categoryLabel(part.category)} · ${durationText(part.durationSeconds)} · <a href="${embedUrl(part.url)}" target="_blank" rel="noopener">${String(part.url).slice(0, 60)}</a></p></div>
              <div class="row">
                <button class="btn btn-sm btn-ghost" data-action="part-up" data-index="${index}" ${index === 0 ? html`disabled` : ""} aria-label="Move up">↑</button>
                <button class="btn btn-sm btn-ghost" data-action="part-down" data-index="${index}" ${index === draft.parts.length - 1 ? html`disabled` : ""} aria-label="Move down">↓</button>
                <button class="btn btn-sm btn-secondary" data-action="edit-part" data-index="${index}">Edit</button>
                <button class="btn btn-sm btn-ghost" data-action="remove-part" data-index="${index}">Remove</button>
              </div></li>`,
          )}</ul>`
        : emptyState("No videos yet", "Add the first part of this lesson.")}`;
  }

  function questionsTab() {
    if (!draft.parts.length) return emptyState("Add a video part first", "Questions pop up while a part is playing or when it ends.");
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">Multiple-choice questions are graded automatically; essay answers are photos you grade in the Answers tab. Correct answers earn points.</p>
        <button class="btn btn-sm btn-primary" data-action="add-question">${icon("plus", 15)} Add question</button></div>
      <div class="card card-flush">${table(
        [
          { label: "Question", render: (q) => html`<strong>${q.text}</strong>` },
          { label: "Part", render: (q) => draft.parts.find((part) => part._id === q.part)?.title || html`<span class="text-danger">Removed part</span>` },
          { label: "Type", render: (q) => (q.type === "mcq" ? badge("Multiple choice", "info") : badge("Essay", "accent")) },
          { label: "Shows", render: (q) => (q.trigger === "time" ? `at ${Math.floor(q.triggerSeconds / 60)}:${String(q.triggerSeconds % 60).padStart(2, "0")}` : "at the end") },
          { label: "Points", className: "num", render: (q) => q.bonusPoints },
          { label: "", render: (q) => (q.isActive ? "" : badge("Hidden", "muted")) },
          { label: "", className: "actions", render: (q, index) => html`<button class="btn btn-sm btn-secondary" data-action="edit-question" data-id="${q._id || q.tempId}">Edit</button><button class="btn btn-sm btn-ghost" data-action="remove-question" data-id="${q._id || q.tempId}">Remove</button>` },
        ],
        draft.questions,
        { empty: "No questions yet." },
      )}</div>`;
  }

  function accessTab() {
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">Give a student free access (for example if they missed the session for a good reason).</p>
        <button class="btn btn-sm btn-primary" data-action="grant">${icon("plus", 15)} Give access</button></div>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (grant) => studentCell(grant.student) },
          { label: "How", render: (grant) => badge({ attended: "Attended", paid: "Paid", admin_free: "Given by you", admin_paid: "Paid at center" }[grant.method] || grant.method, "muted") },
          { label: "Views", className: "num", render: (grant) => `${grant.viewsUsed} / ${grant.maxViews}` },
          { label: "Expires", render: (grant) => (grant.expiresAt ? dateTime(grant.expiresAt) : html`<span class="muted">Starts on first open</span>`) },
          { label: "Status", render: (grant) => accessBadge({ state: grant.expiresAt && new Date(grant.expiresAt) < new Date() ? "expired" : grant.viewsUsed >= grant.maxViews ? "exhausted" : "granted" }) },
          { label: "", className: "actions", render: (grant) => html`<button class="btn btn-sm btn-ghost" data-action="revoke" data-id="${grant._id}">Revoke</button>` },
        ],
        lesson.grants || [],
        { empty: "No individual access yet. Students get access by attending a linked session or paying." },
      )}</div>`;
  }

  function answersTab() {
    const mcq = answers.filter((answer) => answer.question?.type === "mcq");
    const correct = mcq.filter((answer) => answer.isCorrect).length;
    return html`<section class="stats">
        ${statTile("Answers", answers.length)}
        ${statTile("Multiple choice correct", mcq.length ? `${Math.round((correct / mcq.length) * 100)}%` : "—")}
        ${statTile("Essays to grade", answers.filter((answer) => answer.status === "pending").length, { tone: "accent" })}
      </section>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (answer) => studentCell(answer.student) },
          { label: "Question", render: (answer) => answer.question?.text || "—" },
          { label: "Answer", render: (answer) => (answer.imageUrl ? html`<a href="${answer.imageUrl}" target="_blank" rel="noopener">View photo</a>` : answer.choice ? answer.choice.toUpperCase() : answer.text || "—") },
          { label: "Result", render: (answer) => (answer.status === "pending" ? badge("To grade", "warn") : answer.isCorrect ? badge(`Correct +${answer.points}`, "success") : badge("Wrong", "danger")) },
          { label: "When", render: (answer) => dateTime(answer.createdAt) },
          { label: "", className: "actions", render: (answer) => (answer.question?.type === "essay" ? html`<button class="btn btn-sm btn-secondary" data-action="grade-answer" data-id="${answer._id}">${answer.status === "pending" ? "Grade" : "Regrade"}</button>` : "") },
        ],
        answers,
        { empty: "No answers yet." },
      )}</div>`;
  }

  function render() {
    mount(
      root,
      html`<a class="back-link" href="#/lessons">${icon("arrowLeft", 15)} All lessons</a>
      <header class="page-header"><div><p class="eyebrow">Week ${draft.week} · ${draft.published ? "Published" : "Draft"}</p><h1>${draft.title}</h1>
        <p class="page-text">${draft.isFree ? "Free for everyone" : `Unlock price ${draft.price} · ${draft.accessHours}h access`} · ${durationText(draft.parts.reduce((total, part) => total + (Number(part.durationSeconds) || 0), 0))}</p></div>
        <div class="page-actions"><button class="btn btn-danger" data-action="delete">Delete</button>
          <button class="btn btn-secondary" data-action="toggle-publish">${draft.published ? "Unpublish" : "Publish"}</button>
          <button class="btn btn-primary" data-action="save" ${dirty ? "" : html`disabled`}>${dirty ? "Save changes" : "Saved"}</button></div></header>
      ${tabs(
        [
          { key: "parts", label: "Videos", count: draft.parts.length },
          { key: "questions", label: "Pop-up questions", count: draft.questions.length },
          { key: "details", label: "Settings & access rules" },
          { key: "access", label: "Student access", count: (lesson.grants || []).length },
          { key: "answers", label: "Answers", count: answers.filter((answer) => answer.status === "pending").length || undefined },
        ],
        tab,
      )}
      <div id="tab-body">${
        tab === "details"
          ? html`<section class="card"><form id="details-form" class="form-grid">${detailFields().map(fieldHtml)}</form></section>`
          : { parts: partsTab, questions: questionsTab, access: accessTab, answers: answersTab }[tab]()
      }</div>`,
    );
  }

  const markDirty = () => {
    dirty = true;
    const save = $("[data-action=save]", root);
    if (save) {
      save.disabled = false;
      save.textContent = "Save changes";
    }
  };

  async function save(button) {
    if (tab === "details") Object.assign(draft, readForm($("#details-form", root), detailFields()));
    const body = {
      ...Object.fromEntries(["title", "description", "week", "grade", "isFree", "price", "accessHours", "viewsIfAttended", "viewsIfPaid", "sessions", "published"].map((key) => [key, draft[key]])),
      parts: draft.parts,
      questions: draft.questions.map(({ tempId, ...question }) => question),
    };
    const saved = await withBusy(button, () => api.teacher.updateLesson(lesson._id, body), "Lesson saved.");
    if (!saved) return;
    lesson = saved;
    draft = structuredClone(saved);
    dirty = false;
    render();
  }

  async function partDialog(index) {
    const part = index !== undefined ? draft.parts[index] : {};
    const values = await formDialog({
      title: index !== undefined ? "Edit video part" : "Add video part",
      fields: [
        { name: "title", label: "Title", required: true, full: true, value: part.title },
        { name: "category", label: "Type", type: "select", required: true, options: CATEGORIES, value: part.category || "explanation" },
        { name: "durationMinutes", label: "Length (minutes)", type: "number", min: 0, step: 0.5, value: part.durationSeconds ? Math.round(part.durationSeconds / 6) / 10 : "" },
        { name: "url", label: "Video link", type: "url", full: true, value: part.url, placeholder: "https://youtu.be/…", hint: "YouTube, Vimeo, Google Drive or a direct .mp4 link." },
        { name: "file", label: "…or upload a video file", type: "file", accept: "video/*", full: true },
      ],
      onSubmit: async (body) => {
        let url = body.url;
        if (body.file && body.file.size) url = (await api.upload(body.file)).url;
        if (!url) throw new Error("Paste a video link or upload a file.");
        return { title: body.title, category: body.category, url, durationSeconds: Math.round((Number(body.durationMinutes) || 0) * 60) };
      },
    });
    if (!values) return;
    if (index !== undefined) draft.parts[index] = { ...part, ...values };
    else draft.parts.push(values);
    markDirty();
    render();
  }

  async function questionDialog(key) {
    const question = draft.questions.find((item) => (item._id || item.tempId) === key) || {};
    const values = await formDialog({
      title: key ? "Edit question" : "Add pop-up question",
      size: "lg",
      fields: [
        { name: "text", label: "Question", type: "textarea", required: true, full: true, value: question.text },
        { name: "imageUrl", label: "Image link", type: "url", full: true, value: question.imageUrl, placeholder: "Optional image shown with the question" },
        { name: "part", label: "Shows during", type: "select", required: true, options: draft.parts.filter((part) => part._id).map((part) => ({ value: part._id, label: part.title })), value: question.part, hint: "Save new parts before adding questions to them." },
        { name: "type", label: "Type", type: "select", required: true, options: [{ value: "mcq", label: "Multiple choice" }, { value: "essay", label: "Essay (student uploads a photo)" }], value: question.type || "mcq" },
        { name: "trigger", label: "When", type: "select", options: [{ value: "end", label: "When the part ends" }, { value: "time", label: "At a specific time" }], value: question.trigger || "end" },
        { name: "triggerAt", label: "Time (mm:ss)", placeholder: "05:30", value: question.triggerSeconds ? `${Math.floor(question.triggerSeconds / 60)}:${String(question.triggerSeconds % 60).padStart(2, "0")}` : "" },
        { name: "a", label: "Choice A", value: question.choices?.a },
        { name: "b", label: "Choice B", value: question.choices?.b },
        { name: "c", label: "Choice C", value: question.choices?.c },
        { name: "d", label: "Choice D", value: question.choices?.d },
        { name: "correct", label: "Correct choice", type: "select", options: ["a", "b", "c", "d"].map((value) => ({ value, label: value.toUpperCase() })), value: question.correct, emptyLabel: "— (essay)" },
        { name: "bonusPoints", label: "Points for a correct answer", type: "number", min: 0, value: question.bonusPoints ?? 5 },
        { name: "isActive", label: "Active", type: "checkbox", checked: question.isActive !== false },
      ],
      onSubmit: (body) => {
        if (body.type === "mcq" && (!body.a || !body.b || !body.correct)) throw new Error("Multiple-choice questions need at least choices A and B and a correct answer.");
        const [minutes, seconds] = String(body.triggerAt || "0").split(":").map(Number);
        return {
          text: body.text,
          imageUrl: body.imageUrl,
          part: body.part,
          type: body.type,
          trigger: body.trigger,
          triggerSeconds: body.trigger === "time" ? (Number.isNaN(seconds) ? minutes || 0 : (minutes || 0) * 60 + (seconds || 0)) : 0,
          choices: body.type === "mcq" ? { a: body.a, b: body.b, c: body.c, d: body.d } : {},
          correct: body.type === "mcq" ? body.correct : null,
          bonusPoints: body.bonusPoints ?? 0,
          isActive: body.isActive,
        };
      },
    });
    if (!values) return;
    if (key) Object.assign(question, values);
    else draft.questions.push({ ...values, tempId: `new-${Date.now()}` });
    markDirty();
    render();
  }

  on(root, "click", "[data-tab]", (event, button) => {
    if (tab === "details") Object.assign(draft, readForm($("#details-form", root), detailFields()));
    tab = button.dataset.tab;
    setQuery({ tab });
    render();
  });
  on(root, "change", "#details-form", markDirty);
  on(root, "input", "#details-form", markDirty);

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const index = button.dataset.index !== undefined ? Number(button.dataset.index) : undefined;
    if (action === "save") save(button);
    if (action === "toggle-publish") {
      if (tab === "details") Object.assign(draft, readForm($("#details-form", root), detailFields()));
      if (!draft.published && !draft.parts.length) {
        toast("Add at least one video before publishing.", "error");
        return;
      }
      draft.published = !draft.published;
      await save(button);
    }
    if (action === "delete") {
      if (!(await confirmDialog("Delete this lesson, its questions and all students' access?", { danger: true, confirmLabel: "Delete lesson" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteLesson(lesson._id)))) return;
      toast("Lesson deleted.");
      navigate("#/lessons");
    }
    if (action === "add-part") partDialog();
    if (action === "edit-part") partDialog(index);
    if (action === "remove-part") {
      draft.parts.splice(index, 1);
      markDirty();
      render();
    }
    if (action === "part-up" || action === "part-down") {
      const target = action === "part-up" ? index - 1 : index + 1;
      [draft.parts[index], draft.parts[target]] = [draft.parts[target], draft.parts[index]];
      markDirty();
      render();
    }
    if (action === "add-question") questionDialog();
    if (action === "edit-question") questionDialog(button.dataset.id);
    if (action === "remove-question") {
      draft.questions = draft.questions.filter((question) => (question._id || question.tempId) !== button.dataset.id);
      markDirty();
      render();
    }
    if (action === "grant") {
      const saved = await formDialog({
        title: "Give a student access",
        fields: [
          { name: "student", label: "Student", type: "select", required: true, full: true, options: studentOptions(students) },
          { name: "maxViews", label: "Number of views", type: "number", min: 1, value: draft.viewsIfPaid },
          { name: "hours", label: "Hours of access", type: "number", min: 1, value: draft.accessHours },
        ],
        submitLabel: "Give access",
        onSubmit: (body) => api.teacher.grantLesson(lesson._id, body),
      });
      if (saved) {
        lesson.grants = saved.grants;
        render();
        toast("Access given.");
      }
    }
    if (action === "revoke") {
      if (!(await confirmDialog("Revoke this student's access?", { confirmLabel: "Revoke", danger: true }))) return;
      const saved = await withBusy(button, () => api.teacher.revokeLesson(lesson._id, button.dataset.id), "Access revoked.");
      if (saved) {
        lesson.grants = saved.grants;
        render();
      }
    }
    if (action === "grade-answer") {
      const answer = answers.find((item) => item._id === button.dataset.id);
      const { dialog, close } = openDialog({
        title: `Grade · ${fullName(answer.student)}`,
        eyebrow: answer.question?.text,
        size: "lg",
        body: html`${answer.imageUrl ? html`<img src="${answer.imageUrl}" alt="Student answer" style="width:100%;border-radius:12px;border:1px solid var(--border)">` : html`<p>${answer.text || "No answer text."}</p>`}
          <div class="form-grid mt">
            <label class="check"><input type="radio" name="correct" value="1" ${answer.isCorrect ? html`checked` : ""}> Correct</label>
            <label class="check"><input type="radio" name="correct" value="0" ${answer.isCorrect === false ? html`checked` : ""}> Wrong</label>
            <div class="field"><label for="grade-points">Points</label><input id="grade-points" type="number" min="0" value="${answer.points || answer.question?.bonusPoints || 0}"></div>
          </div>`,
        actions: html`<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>`,
      });
      $("[data-save]", dialog).addEventListener("click", async (saveEvent) => {
        const correct = dialog.querySelector("input[name=correct]:checked")?.value === "1";
        const saved = await withBusy(saveEvent.currentTarget, () => api.teacher.gradeAnswer(answer._id, { isCorrect: correct, points: correct ? Number($("#grade-points", dialog).value) || 0 : 0 }), "Answer graded.");
        if (!saved) return;
        close();
        answers = await api.teacher.lessonAnswers(lesson._id);
        render();
      });
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
