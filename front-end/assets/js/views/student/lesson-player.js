import { icon } from "../../core/icons.js";
import { $, badge, dateTime, emptyState, fullName, html, mount, on, toast, withBusy } from "../../core/ui.js";
import { accessBadge, durationText, embedUrl, isDirectVideo } from "../shared/common.js";
import { accessText, unlock } from "./lessons.js";

const CATEGORY = { explanation: "Explanation", questions: "Questions", homework_solution: "Homework solution" };

export default async function lessonPlayer(ctx) {
  const { root, api, params } = ctx;
  let lesson;
  let partIndex = 0;
  let started = false;
  let shownQuestions = new Set();
  let currentQuestion = null;

  async function load() {
    lesson = await api.student.lesson(params.id);
    for (const question of lesson.questions) if (question.answer) shownQuestions.add(question._id);
  }

  const isOpen = () => ["free", "granted"].includes(lesson.access.state);
  const part = () => lesson.parts[partIndex];
  const questionsFor = (partId) => lesson.questions.filter((question) => question.part === partId);

  function lockedView() {
    return html`<section class="card card-accent">${emptyState(
      lesson.access.state === "available" ? "Free because you attended" : lesson.access.state === "locked" ? "This lesson is locked" : "Your access ended",
      accessText(lesson.access),
      html`<button class="btn btn-primary" data-action="unlock">${lesson.access.state === "available" ? "Open lesson" : `Unlock`}</button>`,
    )}</section>`;
  }

  function startView() {
    const limited = lesson.access.state === "granted";
    return html`<section class="card card-accent">${emptyState(
      "Ready to watch",
      limited ? `Starting uses 1 of your ${lesson.access.viewsLeft} remaining views${lesson.access.startsOnOpen ? ` and starts your ${lesson.accessHours}-hour access time` : ` · access until ${dateTime(lesson.access.expiresAt)}`}.` : "This lesson is free — watch as many times as you like.",
      html`<button class="btn btn-primary btn-lg" data-action="start">${icon("play", 16)} Start watching</button>`,
    )}</section>`;
  }

  function videoHtml(current) {
    if (!current.url) return emptyState("Video unavailable");
    if (isDirectVideo(current.url)) return html`<div class="video-frame"><video id="lesson-video" src="${current.url}" controls controlsList="nodownload" playsinline></video></div>`;
    return html`<div class="video-frame"><iframe src="${embedUrl(current.url)}" title="${current.title}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }

  function questionHtml(question) {
    const answer = question.answer;
    if (question.type === "essay") {
      return html`<div class="question-card">
        <p class="eyebrow">Question · ${question.bonusPoints} points</p><p class="strong">${question.text}</p>
        ${question.imageUrl ? html`<img src="${question.imageUrl}" alt="" style="max-width:100%;border-radius:10px">` : ""}
        ${answer
          ? html`<p>${answer.status === "pending" ? badge("Sent — waiting for your teacher to grade it", "warn") : answer.isCorrect ? badge(`Correct · +${answer.points} points`, "success") : badge("Not correct", "danger")}</p>`
          : html`<div class="field"><label for="essay-file">Upload a photo of your answer</label><input id="essay-file" type="file" accept="image/*"></div>
              <div class="row mt"><button class="btn btn-primary" data-action="essay" data-id="${question._id}">Send answer</button><button class="btn btn-ghost" data-action="close-question">Later</button></div>`}
      </div>`;
    }
    return html`<div class="question-card">
      <p class="eyebrow">Question · ${question.bonusPoints} points</p><p class="strong">${question.text}</p>
      ${question.imageUrl ? html`<img src="${question.imageUrl}" alt="" style="max-width:100%;border-radius:10px">` : ""}
      <div class="stack" style="gap:8px">${["a", "b", "c", "d"].filter((key) => question.choices?.[key]).map((key) => {
        const chosen = answer?.choice === key;
        const correct = answer && (answer.correct ?? question.correct) === key;
        return html`<button class="answer-option ${correct ? "is-correct" : chosen ? "is-wrong" : ""}" data-action="choose" data-id="${question._id}" data-choice="${key}" ${answer ? html`disabled` : ""}><strong>${key.toUpperCase()}</strong> ${question.choices[key]}</button>`;
      })}</div>
      ${answer ? html`<p class="mt">${answer.isCorrect ? badge(`Correct! +${answer.points} points`, "success") : badge("Not quite — the correct answer is highlighted", "danger")}</p><button class="btn btn-secondary btn-sm" data-action="close-question">Continue</button>` : ""}
    </div>`;
  }

  function render() {
    if (!isOpen()) {
      mount(root, html`${header()}${lockedView()}`);
      return;
    }
    if (!started) {
      mount(root, html`${header()}${startView()}`);
      return;
    }
    const current = part();
    const partQuestions = questionsFor(current._id);
    const unanswered = partQuestions.filter((question) => !question.answer);
    mount(
      root,
      html`${header()}
      <div class="grid grid-main">
        <div class="stack">
          ${videoHtml(current)}
          <div class="row-between"><div><p class="eyebrow">${CATEGORY[current.category] || ""} · part ${partIndex + 1} of ${lesson.parts.length}</p><h2 style="margin:0">${current.title}</h2></div>
            <div class="row">${partIndex > 0 ? html`<button class="btn btn-secondary" data-action="prev">← Previous</button>` : ""}
              <button class="btn btn-primary" data-action="finish">${unanswered.length ? `Answer ${unanswered.length} question${unanswered.length > 1 ? "s" : ""}` : partIndex < lesson.parts.length - 1 ? "Next part →" : "Finish lesson"}</button></div></div>
          <div id="question-box">${currentQuestion ? questionHtml(currentQuestion) : ""}</div>
        </div>
        <section class="card part-list"><div class="card-head"><h3>Parts</h3>${accessBadge(lesson.access)}</div>
          <div class="stack" style="gap:8px">${lesson.parts.map(
            (item, index) => html`<button class="answer-option ${index === partIndex ? "is-active" : ""}" data-action="part" data-index="${index}">
              <strong>${index + 1}</strong><span style="flex:1">${item.title}<br><span class="muted small">${CATEGORY[item.category] || ""} · ${durationText(item.durationSeconds)}</span></span>
              ${questionsFor(item._id).length ? badge(`${questionsFor(item._id).filter((question) => question.answer).length}/${questionsFor(item._id).length}`, "info") : ""}</button>`,
          )}</div>
          ${lesson.access.state === "granted" ? html`<p class="muted small mt">${accessText(lesson.access)}</p>` : ""}
        </section>
      </div>`,
    );
    bindVideo();
  }

  function header() {
    return html`<a class="back-link" href="#/lessons">${icon("arrowLeft", 15)} All lessons</a>
      <header class="page-header"><div><p class="eyebrow">Week ${lesson.week} · ${fullName(lesson.teacher)}</p><h1>${lesson.title}</h1>${lesson.description ? html`<p class="page-text">${lesson.description}</p>` : ""}</div></header>`;
  }

  // Direct video files: pop time-triggered questions at the right second and track progress.
  function bindVideo() {
    const video = $("#lesson-video", root);
    if (!video) return;
    let lastSaved = 0;
    video.addEventListener("timeupdate", () => {
      const seconds = Math.floor(video.currentTime);
      const due = questionsFor(part()._id).find((question) => question.trigger === "time" && !question.answer && !shownQuestions.has(question._id) && seconds >= question.triggerSeconds);
      if (due) {
        video.pause();
        showQuestion(due);
      }
      if (seconds - lastSaved >= 30) {
        lastSaved = seconds;
        api.student.lessonProgress(lesson._id, { part: part()._id, seconds }).catch(() => {});
      }
    });
    video.addEventListener("ended", () => finishPart());
  }

  function showQuestion(question) {
    shownQuestions.add(question._id);
    currentQuestion = question;
    mount($("#question-box", root), questionHtml(question));
    $("#question-box", root).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function finishPart() {
    const current = part();
    const pending = questionsFor(current._id).find((question) => !question.answer);
    if (pending) {
      showQuestion(pending);
      return;
    }
    api.student.lessonProgress(lesson._id, { part: current._id, seconds: current.durationSeconds || 0 }).catch(() => {});
    if (partIndex < lesson.parts.length - 1) {
      partIndex += 1;
      currentQuestion = null;
      render();
    } else {
      toast("Lesson finished — well done!");
    }
  }

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "unlock") {
      const result = await withBusy(button, () => unlock(api, lesson));
      if (!result || result === true) return;
      lesson.access = result.access;
      await load();
      render();
    }
    if (action === "start") {
      const result = await withBusy(button, () => api.student.lessonProgress(lesson._id, { start: true }));
      if (!result) return;
      if (result.access) lesson.access = { ...lesson.access, ...result.access };
      started = true;
      render();
    }
    if (action === "part" || action === "prev") {
      partIndex = action === "prev" ? partIndex - 1 : Number(button.dataset.index);
      currentQuestion = null;
      render();
    }
    if (action === "finish") finishPart();
    if (action === "close-question") {
      currentQuestion = null;
      render();
    }
    if (action === "choose") {
      const question = lesson.questions.find((item) => item._id === button.dataset.id);
      const answer = await withBusy(button, () => api.student.answerQuestion(question._id, { choice: button.dataset.choice }));
      if (!answer) return;
      question.answer = answer;
      currentQuestion = question;
      mount($("#question-box", root), questionHtml(question));
      if (answer.isCorrect) toast(`+${answer.points} points!`);
    }
    if (action === "essay") {
      const question = lesson.questions.find((item) => item._id === button.dataset.id);
      const file = $("#essay-file", root)?.files[0];
      if (!file) {
        toast("Choose a photo of your answer first.", "error");
        return;
      }
      const answer = await withBusy(button, async () => {
        const { url } = await api.upload(file);
        return api.student.answerQuestion(question._id, { imageUrl: url });
      }, "Answer sent to your teacher.");
      if (!answer) return;
      question.answer = answer;
      currentQuestion = null;
      render();
    }
  });

  await load();
  // Free lessons don't consume views, so start straight away.
  started = lesson.access.state === "free";
  render();
}
