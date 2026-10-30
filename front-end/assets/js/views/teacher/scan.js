import { API_BASE, HOMEWORK_STATUS, STORAGE_KEYS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  $, avatar, badge, date, emptyState, fullName, gradeLabel, homeworkBadge, html, loadScript, money, mount, on, toast,
} from "../../core/ui.js";
import { statusBadge } from "../shared/common.js";

const MODES = [
  { key: "attendance", label: "Attendance", perm: "scan_attendance", icon: "check" },
  { key: "homework", label: "Homework check", perm: "scan_homework", icon: "pencil" },
  { key: "door", label: "Door check", perm: "door_check", icon: "door" },
];

// ---------- offline queue for check-ins made while the connection is down ----------
const readQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.scanQueue) || "[]");
  } catch {
    return [];
  }
};
const writeQueue = (items) => localStorage.setItem(STORAGE_KEYS.scanQueue, JSON.stringify(items));

let audio;
function beep(ok = true) {
  try {
    audio = audio || new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + (ok ? 0.12 : 0.3));
  } catch {
    /* audio not available */
  }
}

export default async function scan(ctx) {
  const { root, api, can, query } = ctx;
  const modes = MODES.filter((mode) => can(mode.perm));
  let mode = modes.find((item) => item.key === query.mode)?.key || modes[0]?.key;
  let activeSession = null;
  let recentSessions = [];
  let lookup = null;
  let busy = false;
  let lastCode = "";
  let lastCodeAt = 0;
  let stream = null;
  let detector = null;
  let scanning = false;
  let paused = false;
  const canvas = document.createElement("canvas");
  const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
  const history = [];

  async function loadSessions() {
    const sessions = (await api.teacher.sessions()) || [];
    activeSession = sessions.find((session) => session.active) || null;
    recentSessions = sessions.filter((session) => session.status !== "cancelled").slice(0, 5);
  }

  function sessionBox() {
    if (activeSession) {
      return html`<div class="notice notice-success"><strong>Live session:</strong> Week ${activeSession.week} · #${activeSession.number} — ${activeSession.sequence}
        <div class="small">${activeSession.centerName || "Online"} · <span id="present-count">${activeSession.presentCount ?? activeSession.attendance?.length ?? 0}</span> present</div></div>`;
    }
    if (mode === "door") return html`<div class="notice notice-info">No live session. Door check still shows balance, warnings and block status.</div>`;
    return html`<div class="notice notice-danger">
      <p style="margin:0 0 8px"><strong>No live session.</strong> Start a session to record ${mode === "homework" ? "homework" : "attendance"}.</p>
      ${can("sessions_manage")
        ? html`<div class="row">${recentSessions.slice(0, 3).map((session) => html`<button class="btn btn-sm btn-secondary" data-action="activate" data-id="${session._id}">Start #${session.number} · ${session.sequence.slice(0, 22)}</button>`)}
            <a class="btn btn-sm btn-primary" href="#/sessions?new=1">${icon("plus", 14)} New session</a></div>`
        : html`<p class="small" style="margin:0">Ask your teacher to start the session.</p>`}
    </div>`;
  }

  function queueBox() {
    const queue = readQueue();
    if (!queue.length) return "";
    return html`<div class="notice mt row-between"><span>${queue.length} check-in${queue.length > 1 ? "s" : ""} saved offline — they'll be sent when the connection is back.</span><button class="btn btn-sm btn-secondary" data-action="flush">Send now</button></div>`;
  }

  function historyBox() {
    if (!history.length) return "";
    return html`<section class="card mt"><div class="card-head"><h3>This shift</h3><span class="muted small">${history.length} scanned</span></div>
      <ul class="list">${history.slice(0, 8).map((item) => html`<li class="list-item"><span>${item.name}</span>${badge(item.text, item.tone)}</li>`)}</ul></section>`;
  }

  function resultBox() {
    if (!lookup) {
      return html`<section class="card result-card">${emptyState(
        "Ready to scan",
        mode === "door" ? "Scan a student's QR code to see if they can enter." : "Scan a QR code, use a USB barcode scanner, or type the student code.",
      )}</section>`;
    }
    const { student } = lookup;
    const header = html`<div class="profile-hero mb">${avatar(student, "lg")}<div class="grow">
        <p class="eyebrow">${student.userID}</p><h2 style="margin:0">${fullName(student)}</h2>
        <div class="status-chips mt">${badge(gradeLabel(student.grade), "accent")}${student.centerName ? badge(student.centerName, "muted") : ""}
          ${student.isBlocked ? badge("Blocked", "danger") : ""}${lookup.warnings.length ? badge(`${lookup.warnings.length} warning${lookup.warnings.length > 1 ? "s" : ""}`, "warn") : ""}</div>
      </div><a class="btn btn-sm btn-ghost" href="#/students/${student._id}" target="_blank" rel="noopener">Profile ↗</a></div>
      ${student.adminNote ? html`<div class="notice mb"><strong>Note:</strong> ${student.adminNote}</div>` : ""}
      <dl class="kv mb"><dt>Balance</dt><dd class="${student.balance < lookup.price ? "text-danger strong" : "strong"}">${money(student.balance)}</dd>
        <dt>Session price</dt><dd>${money(lookup.price)}</dd>
        ${lookup.followUp ? "" : html`<dt>Follow-up</dt><dd>${student.followUpAssistantName || "—"}</dd>`}</dl>`;

    if (mode === "door") {
      return html`<section class="card result-card ${lookup.allowed ? "is-ok" : "is-bad"}">
        <div class="notice ${lookup.allowed ? "notice-success" : "notice-danger"} mb" style="font-size:18px"><strong>${lookup.allowed ? "✓ Allowed in" : "✕ Not allowed"}</strong>
          ${lookup.reasons.length ? html`<ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${lookup.reasons.map((reason) => html`<li>${reason}</li>`)}</ul>` : ""}</div>
        ${header}
        ${lookup.attended ? html`<p>${badge("Already checked in", "success")} at ${date(lookup.attendance.markedAt, { hour: "2-digit", minute: "2-digit" })}</p>` : ""}
        <h3 class="small muted">Last sessions</h3>
        <div class="status-chips">${lookup.lastSessions.map((row) => html`<span title="${row.session.sequence}">#${row.session.number} ${statusBadge(row.status)}</span>`)}</div>
        <div class="row mt"><button class="btn btn-primary" data-action="next">Next student</button></div>
      </section>`;
    }

    if (mode === "homework") {
      return html`<section class="card result-card">${header}
        ${!lookup.attended ? html`<div class="notice notice-danger mb">This student hasn't been checked in to the live session yet.</div>` : html`<p>Current status: ${homeworkBadge(lookup.attendance.homeworkStatus)}</p>`}
        <div class="choice-grid">${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(
          ([key, info]) => html`<button class="btn btn-lg ${info.tone === "success" ? "btn-success" : info.tone === "danger" ? "btn-danger" : "btn-secondary"}" data-action="homework" data-status="${key}" ${!lookup.attended ? html`disabled` : ""}>${info.label}</button>`,
        )}</div>
        <div class="row mt"><button class="btn btn-ghost" data-action="next">Skip</button></div>
      </section>`;
    }

    // attendance
    const blocked = student.isBlocked;
    return html`<section class="card result-card ${lookup.attended ? "is-ok" : blocked ? "is-bad" : ""}">${header}
      ${lookup.attended ? html`<div class="notice notice-success mb">Already checked in to this session.</div>` : ""}
      ${lookup.warnings.length ? html`<div class="notice notice-danger mb"><strong>Warnings:</strong> ${lookup.warnings.map((warning) => warning.reason).join(" · ")}</div>` : ""}
      ${lookup.booklets.length ? html`<div class="notice mb"><strong>Booklets to hand over:</strong>
          ${lookup.booklets.map((order) => html`<label class="check mt"><input type="checkbox" name="deliver" value="${order._id}"> ${order.booklet.name} ${order.price - order.paid > 0 ? badge(`${money(order.price - order.paid)} unpaid`, "warn") : badge("Paid", "success")}</label>`)}</div>` : ""}
      ${lookup.attended || !activeSession
        ? html`<div class="row"><button class="btn btn-primary" data-action="next">Next student</button></div>`
        : html`<form id="checkin-form" class="form-grid">
            <div class="field"><label for="payment">Cash paid now</label><input id="payment" name="payment" type="number" min="0" step="1" value="0" inputmode="numeric">
              <span class="field-hint" id="after-balance">Balance after: ${money(student.balance - lookup.price)}</span></div>
            <div class="field"><label for="hw">Homework</label><select id="hw" name="homeworkStatus"><option value="">Not checked</option>${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(([key, info]) => html`<option value="${key}">${info.label}</option>`)}</select></div>
            <div class="field field-full"><label for="comment">Comment <span class="optional">optional</span></label><input id="comment" name="comment" placeholder="e.g. came late"></div>
            <div class="field-full row">
              <button class="btn btn-primary btn-lg" type="submit">${icon("check")} Confirm check-in</button>
              <button class="btn btn-ghost" type="button" data-action="next">Cancel</button>
            </div>
            <div class="field-full" id="force-box"></div>
          </form>`}
    </section>`;
  }

  function render() {
    if (!modes.length) {
      mount(root, emptyState("No scanning access", "Ask your teacher to give your account scanning permissions."));
      return;
    }
    mount(
      root,
      html`<header class="page-header"><div><p class="eyebrow">Classroom</p><h1>Live scan</h1>
          <p class="page-text">Keep this page open at the door. Works with the camera, USB barcode scanners, or typing the code.</p></div>
          <div class="page-actions"><span class="badge ${navigator.onLine ? "badge-success" : "badge-danger"}" id="online-badge">${navigator.onLine ? "Online" : "Offline"}</span></div></header>
        <div class="scan-layout">
          <div class="stack">
            <section class="card card-accent">
              <div class="mode-switch" role="tablist">${modes.map((item) => html`<button class="btn btn-secondary ${item.key === mode ? "is-active" : ""}" data-mode="${item.key}" role="tab" aria-selected="${item.key === mode}">${icon(item.icon, 16)} ${item.label}</button>`)}</div>
              <div id="session-box" class="mb">${sessionBox()}</div>
              <form id="code-form" class="row">
                <label class="sr-only" for="code-input">Student code</label>
                <input id="code-input" class="input" style="flex:1;min-width:180px" placeholder="Student code, e.g. STU-000123" autocomplete="off" autofocus>
                <button class="btn btn-primary" type="submit">Find</button>
              </form>
              <div class="row mt">
                <button class="btn btn-secondary" type="button" data-action="camera" id="camera-btn">${icon("scan", 16)} ${stream ? "Close camera" : "Open camera"}</button>
                <span class="muted small" id="camera-status"></span>
              </div>
              <div class="camera mt" id="camera" ${stream ? "" : html`hidden`}><video id="camera-video" playsinline muted></video></div>
              <div id="queue-box">${queueBox()}</div>
            </section>
            <div id="history-box">${historyBox()}</div>
          </div>
          <div id="result-box">${resultBox()}</div>
        </div>`,
    );
    if (stream) {
      const video = $("#camera-video", root);
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }

  const renderResult = () => mount($("#result-box", root), resultBox());
  const renderSide = () => {
    mount($("#session-box", root), sessionBox());
    mount($("#queue-box", root), queueBox());
    mount($("#history-box", root), historyBox());
  };
  const focusInput = () => $("#code-input", root)?.focus();

  function record(name, text, tone) {
    history.unshift({ name, text, tone });
    renderSide();
  }

  async function find(code) {
    const value = String(code || "").trim();
    if (!value || busy) return;
    if (value === lastCode && Date.now() - lastCodeAt < 2500) return;
    lastCode = value;
    lastCodeAt = Date.now();
    busy = true;
    paused = true;
    $("#code-input", root).value = "";
    mount($("#result-box", root), html`<section class="card result-card">${emptyState("Looking up…", value)}</section>`);
    try {
      lookup = await api.teacher.scanLookup(value);
      beep(mode === "door" ? lookup.allowed : !lookup.student.isBlocked);
      renderResult();
      if (mode === "attendance") $("#payment", root)?.focus();
    } catch (error) {
      beep(false);
      lookup = null;
      mount($("#result-box", root), html`<section class="card result-card is-bad">${emptyState("Not found", error.message)}<div class="row" style="justify-content:center"><button class="btn btn-secondary" data-action="next">Try again</button></div></section>`);
    } finally {
      busy = false;
    }
  }

  function next() {
    lookup = null;
    paused = false;
    renderResult();
    focusInput();
  }

  async function submitCheckin(form, force = false) {
    const body = {
      identifier: lookup.student.userID || lookup.student._id,
      payment: Number(form.elements.payment.value) || 0,
      homeworkStatus: form.elements.homeworkStatus.value || undefined,
      comment: form.elements.comment.value.trim(),
      force,
    };
    const deliveries = [...root.querySelectorAll("input[name=deliver]:checked")].map((input) => input.value);
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const result = await api.teacher.markAttendance(activeSession._id, body);
      await Promise.all(deliveries.map((orderId) => api.teacher.updateBookletOrder(orderId, { delivered: true }).catch(() => null)));
      activeSession = result.session || activeSession;
      beep(true);
      toast(`${fullName(lookup.student)} checked in · balance ${money(result.balance ?? lookup.student.balance)}`);
      record(fullName(lookup.student), "Present", "success");
      next();
      renderSide();
    } catch (error) {
      submit.disabled = false;
      if (error.status === 0 || !navigator.onLine) {
        writeQueue([...readQueue(), { sessionId: activeSession._id, body, name: fullName(lookup.student), at: new Date().toISOString() }]);
        toast("No connection — check-in saved and will be sent automatically.", "warn");
        record(fullName(lookup.student), "Queued", "warn");
        next();
        return;
      }
      beep(false);
      const forceable = ["INSUFFICIENT_BALANCE", "BLOCKED"].includes(error.details?.code);
      mount(
        $("#force-box", root),
        html`<div class="notice notice-danger row-between"><span>${error.message}</span>${forceable ? html`<button class="btn btn-sm btn-danger" type="button" data-action="force">Check in anyway</button>` : ""}</div>`,
      );
    }
  }

  async function flushQueue() {
    const queue = readQueue();
    if (!queue.length || !navigator.onLine) return;
    const remaining = [];
    for (const item of queue) {
      try {
        await api.teacher.markAttendance(item.sessionId, { ...item.body, force: true });
        record(item.name, "Synced", "success");
      } catch (error) {
        if (error.status === 0) remaining.push(item);
        else record(item.name, error.message.slice(0, 40), "danger");
      }
    }
    writeQueue(remaining);
    if (queue.length !== remaining.length) toast(`${queue.length - remaining.length} offline check-in(s) sent.`);
    renderSide();
  }

  // ---------- camera ----------
  function loadDecoder() {
    if (window.jsQR) return Promise.resolve();
    return loadScript(`${API_BASE}/vendor/jsQR.js`).catch(() => loadScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"));
  }

  async function startCamera() {
    const status = $("#camera-status", root);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast("Camera needs HTTPS (or localhost). You can still type codes or use a USB scanner.", "error");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      detector = null;
      if ("BarcodeDetector" in window) {
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      if (!detector) {
        status.textContent = "Loading scanner…";
        await loadDecoder();
      }
      render();
      $("#camera-status", root).textContent = "Point the camera at the QR code.";
      scanning = true;
      requestAnimationFrame(tick);
    } catch (error) {
      const messages = { NotAllowedError: "Camera permission was denied.", NotFoundError: "No camera found on this device.", NotReadableError: "The camera is being used by another app." };
      toast(messages[error.name] || `Couldn't open the camera: ${error.message}`, "error");
      stopCamera();
    }
  }

  function stopCamera() {
    scanning = false;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  let lastTick = 0;
  async function tick() {
    if (!scanning) return;
    const video = $("#camera-video", root);
    if (!video || paused || Date.now() - lastTick < 220 || !video.videoWidth) {
      requestAnimationFrame(tick);
      return;
    }
    lastTick = Date.now();
    try {
      let value;
      if (detector) value = (await detector.detect(video))[0]?.rawValue;
      else if (window.jsQR) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvasContext.drawImage(video, 0, 0);
        const image = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
        value = window.jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data;
      }
      if (value) await find(value);
    } catch {
      /* keep scanning */
    }
    requestAnimationFrame(tick);
  }

  // ---------- events ----------
  on(root, "submit", "#code-form", (event) => {
    event.preventDefault();
    lastCode = "";
    find($("#code-input", root).value);
  });
  on(root, "submit", "#checkin-form", (event, form) => {
    event.preventDefault();
    submitCheckin(form);
  });
  on(root, "input", "#payment", (event, input) => {
    const after = lookup.student.balance + (Number(input.value) || 0) - lookup.price;
    const hint = $("#after-balance", root);
    hint.textContent = `Balance after: ${money(after)}`;
    hint.className = `field-hint ${after < 0 ? "text-danger" : ""}`;
  });
  on(root, "click", "[data-mode]", (event, button) => {
    mode = button.dataset.mode;
    ctx.setQuery({ mode });
    lookup = null;
    render();
    focusInput();
  });
  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "next") next();
    if (action === "camera") (stream ? (stopCamera(), render()) : startCamera());
    if (action === "flush") flushQueue();
    if (action === "force") submitCheckin($("#checkin-form", root), true);
    if (action === "activate") {
      button.disabled = true;
      try {
        await api.teacher.setSessionActive(button.dataset.id, true);
        await loadSessions();
        renderSide();
        toast("Session is live.");
      } catch (error) {
        toast(error.message, "error");
        button.disabled = false;
      }
    }
    if (action === "homework") {
      const status = button.dataset.status;
      button.disabled = true;
      try {
        await api.teacher.checkHomework(activeSession._id, { identifier: lookup.student.userID || lookup.student._id, status });
        beep(true);
        record(fullName(lookup.student), HOMEWORK_STATUS[status].label, HOMEWORK_STATUS[status].tone);
        toast(`Homework saved: ${HOMEWORK_STATUS[status].label}`);
        next();
      } catch (error) {
        beep(false);
        toast(error.message, "error");
        button.disabled = false;
      }
    }
  });

  const updateOnline = () => {
    const badgeEl = $("#online-badge", root);
    if (badgeEl) {
      badgeEl.textContent = navigator.onLine ? "Online" : "Offline";
      badgeEl.className = `badge ${navigator.onLine ? "badge-success" : "badge-danger"}`;
    }
    if (navigator.onLine) flushQueue();
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  const flushTimer = window.setInterval(flushQueue, 30_000);

  await loadSessions();
  render();
  focusInput();
  flushQueue();

  return () => {
    stopCamera();
    window.removeEventListener("online", updateOnline);
    window.removeEventListener("offline", updateOnline);
    window.clearInterval(flushTimer);
  };
}
