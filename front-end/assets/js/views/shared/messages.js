import { icon } from "../../core/icons.js";
import { $, badge, dateTime, emptyState, html, mount, on, openDialog, pageHeader, table, tabs, toast, withBusy } from "../../core/ui.js";

// The messages screen: write one message with {variables}, choose who gets it (who attended or missed a session,
// all students, a grade or a center), review every row, then send by WhatsApp or Telegram from the server.
// `client` is the set of API calls, so the same screen serves the teacher and the owner acting for a teacher.

const AUDIENCES = [
  { value: "attended", label: "Students who attended a session", type: "attendance" },
  { value: "absent", label: "Students who missed a session", type: "absence" },
  { value: "all", label: "All my students (announcement / marketing)", type: "marketing" },
];
const TEMPLATE_TYPES = [
  { value: "attendance", label: "Attendance" },
  { value: "absence", label: "Absence" },
  { value: "marketing", label: "Marketing / announcement" },
];
const RECIPIENTS = [
  { value: "parent", label: "Parents" },
  { value: "student", label: "Students" },
  { value: "both", label: "Parents and students" },
];
const STATUS_TONE = { sent: "success", delivered: "success", read: "success", simulated: "info", queued: "muted", failed: "danger", skipped: "muted" };

// Same rules as the server's checkPhone: Egyptian mobiles 010/011/012/015 + 8 digits, slips like a missing 0 fixed.
export function checkPhone(phone) {
  const digits = String(phone ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "")
    .replace(/^00/, "");
  if (!digits) return { ok: false, reason: "No phone number" };
  let local = "";
  if (/^1\d{9}$/.test(digits)) local = `0${digits}`;
  else if (/^0\d{10}$/.test(digits)) local = digits;
  else if (/^20\d{10}$/.test(digits)) local = `0${digits.slice(2)}`;
  else if (/^200\d{10}$/.test(digits)) local = digits.slice(2);
  if (local || digits.startsWith("0") || digits.startsWith("20")) {
    if (!local) return { ok: false, reason: `Wrong length: an Egyptian mobile has 11 digits (01xxxxxxxxx), this has ${digits.replace(/^20/, "0").length}` };
    if (!/^01[0125]\d{8}$/.test(local)) return { ok: false, reason: "Egyptian mobiles start with 010, 011, 012 or 015" };
    return { ok: true, reason: "" };
  }
  if (digits.length >= 10 && digits.length <= 15) return { ok: true, reason: "" };
  return { ok: false, reason: "Too short to be a phone number" };
}

export const renderTemplate = (template, values) =>
  String(template || "").replace(/\{(\w+)\}/g, (whole, key) => (values && key in values ? String(values[key] ?? "") : whole));

export async function messagesScreen(ctx, client, { title = "Messages", eyebrow = "Engagement", text = "Write a message once and send it to the students or parents you choose.", backLink = "" } = {}) {
  const { root, query, setQuery } = ctx;
  let tab = query.tab || "send";
  const [loaded, sessions] = await Promise.all([client.config(), client.sessions().catch(() => [])]);
  const config = { grades: [], centers: [], variables: [], templates: {}, whatsapp: {}, telegram: {}, ...loaded };
  let rows = [];
  let batches = [];
  let search = "";
  const form = {
    audience: query.audience || "attended",
    session: query.session || sessions[0]?._id || "",
    recipient: "parent",
    channel: config.channels.find((channel) => channel.key === "whatsapp_web")?.key || config.channels[0]?.key || "",
    grade: "",
    center: "",
  };
  const typeOf = (audience) => AUDIENCES.find((item) => item.value === audience)?.type || "marketing";
  let draft = config.templates[typeOf(form.audience)] || "";
  let templateType = "attendance";
  let progressTimer = null;
  const stops = [];

  const limit = () => (form.channel === "whatsapp_api" ? config.maxChars : null);
  const needsSession = () => form.audience === "attended" || form.audience === "absent";
  const selected = () => rows.filter((row) => row.include);

  function variableChips(target) {
    const groups = {};
    for (const variable of config.variables) (groups[variable.group || "Other"] ||= []).push(variable);
    return html`<div class="var-groups">${Object.entries(groups).map(([group, list]) => html`<div class="var-group">
      <span class="var-group-label">${group}</span>
      <div class="status-chips">${list.map((variable) => html`<button class="chip-btn" type="button" data-variable="${variable.key}" data-target="${target}" title="{${variable.key}}">${variable.label}</button>`)}</div>
    </div>`)}</div>`;
  }

  function channelNote() {
    if (form.channel === "whatsapp_web") {
      if (!config.whatsapp.linked) return html`<p class="small text-danger">No WhatsApp number is linked yet. The owner links one with a QR code on the Messaging page.</p>`;
      return html`<p class="small muted">Sent by the server from ${config.whatsapp.own ? "your own number" : "the platform number"}${config.whatsapp.phone ? ` +${config.whatsapp.phone}` : ""}, one every ${config.delaySeconds} seconds. You can close this page.</p>`;
    }
    if (form.channel === "telegram") {
      if (!config.telegram.ready) return html`<p class="small text-danger">The Telegram bot isn't set up yet.</p>`;
      return html`<p class="small muted">Only people who opened the bot and shared their number receive it. Rows without Telegram are marked.</p>`;
    }
    if (form.channel === "whatsapp_link") return html`<p class="small muted">Your browser opens one WhatsApp window per message, every ${config.delaySeconds} seconds.</p>`;
    return html`<p class="small muted">Sent straight away in the background.</p>`;
  }

  function composeHtml() {
    if (!config.channels.length) return emptyState("No channel is active yet", "EduCobra activates Telegram or WhatsApp for your account. Contact the team to turn it on.");
    const first = rows[0];
    const sample = first ? renderTemplate(draft, first.values) : "";
    return html`<div class="grid grid-main compose-grid">
      <section class="card">
        <div class="card-head"><h3>1 · Who gets it</h3></div>
        <div class="form-grid">
          <div class="field field-full"><label for="m-audience">Students</label><select id="m-audience">${AUDIENCES.map((item) => html`<option value="${item.value}" ${item.value === form.audience ? html`selected` : ""}>${item.label}</option>`)}</select></div>
          ${needsSession() ? html`<div class="field field-full"><label for="m-session">Session</label>${sessions.length
            ? html`<select id="m-session">${sessions.map((session) => html`<option value="${session._id}" ${session._id === form.session ? html`selected` : ""}>${session.label} · ${new Date(session.date).toLocaleDateString("en-GB")}</option>`)}</select>`
            : html`<p class="muted small">No sessions yet.</p>`}</div>` : ""}
          <div class="field"><label for="m-grade">Grade</label><select id="m-grade"><option value="">Every grade</option>${config.grades.map((grade) => html`<option value="${grade.value}" ${grade.value === form.grade ? html`selected` : ""}>${grade.label}</option>`)}</select></div>
          <div class="field"><label for="m-center">Center</label><select id="m-center"><option value="">Every center</option>${config.centers.map((center) => html`<option value="${center._id}" ${center._id === form.center ? html`selected` : ""}>${center.name}</option>`)}<option value="none" ${form.center === "none" ? html`selected` : ""}>Online / no center</option></select></div>
          <div class="field"><label for="m-recipient">Send to</label><select id="m-recipient">${RECIPIENTS.map((item) => html`<option value="${item.value}" ${item.value === form.recipient ? html`selected` : ""}>${item.label}</option>`)}</select></div>
          <div class="field"><label for="m-channel">Send by</label><select id="m-channel">${config.channels.map((channel) => html`<option value="${channel.key}" ${channel.key === form.channel ? html`selected` : ""}>${channel.label}</option>`)}</select></div>
          <div class="field-full" id="channel-note">${channelNote()}</div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>2 · The message</h3><span class="muted small" id="draft-count">${draft.length} letters</span></div>
        <div class="field"><label for="m-body" class="sr-only">Message</label><textarea id="m-body" rows="7" placeholder="Hello {student_name}…">${draft}</textarea></div>
        <span class="field-hint">Tap a field to insert it where the cursor is. It's filled in for each student.</span>
        ${variableChips("m-body")}
        <div class="row mt"><button class="btn btn-primary" type="button" data-action="load">${icon("users", 16)} Prepare the list</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="save-draft">Save as the ${typeOf(form.audience)} template</button></div>
        ${first ? html`<div class="message-preview mt" id="sample"><span class="eyebrow">Preview for ${first.name}</span><p>${sample}</p></div>` : ""}
      </section>
    </div>
    <div id="review"></div>`;
  }

  const usesPhone = () => form.channel !== "telegram";
  const wrongRows = () => (usesPhone() ? rows.filter((row) => row.phoneCheck && !row.phoneCheck.ok) : []);
  const telegramReady = (row) => Boolean(row.telegram?.any ?? (row.telegram?.parent || row.telegram?.student));

  function telegramMark(row) {
    if (form.channel !== "telegram") return "";
    if (row.telegram?.[row.recipient]) return badge("Telegram ✓", "success");
    // No chat of this kind: the message goes to the chat linked as the other one (often the same phone).
    if (telegramReady(row)) return badge(`Telegram ✓ (${row.recipient === "parent" ? "student's" : "parent's"} chat)`, "info");
    return badge("No Telegram", "warn");
  }

  function phoneMark(row) {
    if (!usesPhone() || !row.phoneCheck || row.phoneCheck.ok) return "";
    return html`<span class="small text-danger strong">${row.phoneCheck.reason}</span>`;
  }

  function rowHtml(row, index) {
    const max = limit();
    const over = max && row.body.length > max;
    const hidden = search && !`${row.name} ${row.userID} ${row.to}`.toLowerCase().includes(search);
    return html`<tr data-index="${index}" ${hidden ? html`hidden` : ""} class="${row.include ? "" : "row-off"}">
      <td class="cell-check"><input type="checkbox" data-include ${row.include ? html`checked` : ""} aria-label="Include ${row.name}"></td>
      <td data-label="Student"><strong>${row.name}</strong><br><span class="muted small">${row.userID || ""}</span>
        <div class="status-chips mt-xs">${badge(row.recipient === "student" ? "Student" : "Parent", row.recipient === "student" ? "info" : "accent")}${telegramMark(row)}</div></td>
      <td data-label="Send to">${usesPhone()
        ? html`<input class="input-sm ${row.phoneCheck && !row.phoneCheck.ok ? "input-error" : ""}" data-field="to" value="${row.to || ""}" placeholder="Phone" aria-label="Phone for ${row.name}"><div data-phone-slot>${phoneMark(row)}</div>`
        : html`<span class="muted small">Linked Telegram chat</span>`}</td>
      <td data-label="Message"><textarea rows="3" data-field="body" aria-label="Message for ${row.name}">${row.body}</textarea>
        <span class="small ${over ? "text-danger strong" : "muted"}" data-count>${row.edited ? "Edited · " : ""}${row.body.length}${max ? ` / ${max}` : ""}</span></td>
      <td class="num"><button class="icon-btn" type="button" data-action="remove-row" aria-label="Remove ${row.name}">${icon("close", 16)}</button></td>
    </tr>`;
  }

  function renderReview() {
    const host = $("#review", root);
    if (!host) return;
    if (!rows.length) {
      mount(host, emptyState("Nothing prepared yet", "Choose the students and write the message, then press Prepare the list. You review every row before anything is sent."));
      return;
    }
    const count = selected().length;
    const wrong = wrongRows();
    const canCheck = usesPhone() && rows.length;
    mount(host, html`${wrong.length ? html`<div class="notice notice-danger row-between mt">
        <span><strong>${wrong.length} wrong number${wrong.length === 1 ? "" : "s"}</strong>: unticked, they won't be sent. Fix them in the list, or take them out.</span>
        <button class="btn btn-sm btn-danger" type="button" data-action="remove-wrong">Remove wrong numbers</button></div>` : ""}
      <section class="card card-flush mb mt">
      <div class="card-head"><h3>${count} of ${rows.length} selected</h3>
        <div class="row">
          <input id="row-search" class="input-sm" type="search" placeholder="Find in the list" value="${search}" aria-label="Find in the list">
          ${canCheck ? html`<button class="btn btn-secondary btn-sm" type="button" data-action="check-numbers" title="Checks every number and asks WhatsApp which ones have an account">${icon("check", 15)} Check numbers</button>` : ""}
          <button class="btn btn-ghost btn-sm" type="button" data-action="all">All</button><button class="btn btn-ghost btn-sm" type="button" data-action="none">None</button>
          <input id="add-student" class="input-sm" placeholder="Student code or phone" aria-label="Add a student"><button class="btn btn-secondary btn-sm" type="button" data-action="add">${icon("plus", 15)} Add</button>
        </div></div>
      <div class="table-wrap"><table class="table table-messages"><thead><tr><th></th><th>Student</th><th>Send to</th><th>Message</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml)}</tbody></table></div>
      <div class="card-foot row-between"><span id="channel-foot">${channelNote()}</span>
        <button class="btn btn-primary" type="button" data-action="send" ${count ? "" : html`disabled`}>${icon("megaphone", 16)} Send ${count} message${count === 1 ? "" : "s"}</button></div>
    </section><div id="runner"></div>`);
  }

  function templatesTab() {
    return html`<section class="card">
      <div class="form-grid">
        <div class="field"><label for="t-type">Template</label><select id="t-type">${TEMPLATE_TYPES.map((type) => html`<option value="${type.value}" ${type.value === templateType ? html`selected` : ""}>${type.label}</option>`)}</select></div>
        <div class="field field-full"><label for="t-body">Message</label><textarea id="t-body" rows="7">${config.templates[templateType] || ""}</textarea></div>
        <div class="field field-full"><span class="field-hint">Tap a field to insert it at the cursor.</span>${variableChips("t-body")}</div>
        <div class="field-full row"><button class="btn btn-primary" type="button" data-action="save-template">Save template</button></div>
      </div>
    </section>`;
  }

  function historyTab() {
    return html`<div class="card card-flush">${table(
      [
        { label: "Sent", render: (row) => dateTime(row.createdAt) },
        { label: "Session", render: (row) => row.sessionLabel || "—" },
        { label: "Type", render: (row) => row.type },
        { label: "Channel", render: (row) => row.channelLabel },
        { label: "Total", className: "num", render: (row) => row.total },
        { label: "Result", render: (row) => html`<span class="status-chips">${Object.entries(row.counts).map(([status, count]) => badge(`${count} ${status}`, STATUS_TONE[status]))}</span>` },
        { label: "", render: (row) => html`<button class="btn btn-ghost btn-sm" type="button" data-batch="${row._id}">Details</button>` },
      ],
      batches,
      { empty: "Nothing sent yet." },
    )}</div>`;
  }

  async function render() {
    if (tab === "history") batches = await client.batches();
    mount(root, html`${pageHeader({ eyebrow, title, text, actions: backLink ? html`<a class="btn btn-secondary" href="${backLink}">Back</a>` : "" })}
      ${tabs([{ key: "send", label: "Write & send" }, { key: "templates", label: "Templates" }, { key: "history", label: "History" }], tab)}
      <div class="mt">${tab === "send" ? composeHtml() : tab === "templates" ? templatesTab() : historyTab()}</div>`);
    if (tab === "send") renderReview();
  }

  // Re-fills every row that wasn't edited by hand when the message changes.
  function applyDraft() {
    for (const row of rows) if (!row.edited) row.body = renderTemplate(draft, row.values);
    const count = $("#draft-count", root);
    if (count) count.textContent = `${draft.length} letters`;
    const sample = $("#sample p", root);
    if (sample && rows[0]) sample.textContent = renderTemplate(draft, rows[0].values);
    for (const area of root.querySelectorAll("#review textarea[data-field=body]")) {
      const row = rows[Number(area.closest("tr").dataset.index)];
      if (row && !row.edited && area.value !== row.body) {
        area.value = row.body;
        updateCount(area, row);
      }
    }
  }

  function updateCount(input, row) {
    const counter = input.parentElement.querySelector("[data-count]");
    if (!counter) return;
    const max = limit();
    counter.textContent = `${row.edited ? "Edited · " : ""}${row.body.length}${max ? ` / ${max}` : ""}`;
    counter.className = `small ${max && row.body.length > max ? "text-danger strong" : "muted"}`;
  }

  function refreshCounts() {
    const count = selected().length;
    const head = root.querySelector("#review .card-head h3");
    if (head) head.textContent = `${count} of ${rows.length} selected`;
    const button = root.querySelector("[data-action=send]");
    if (button) {
      button.disabled = !count;
      button.lastChild.textContent = ` Send ${count} message${count === 1 ? "" : "s"}`;
    }
  }

  const previewBody = () => ({
    audience: form.audience,
    type: typeOf(form.audience),
    session: needsSession() ? form.session : undefined,
    recipient: form.recipient,
    template: draft,
    grade: form.grade || undefined,
    center: form.center || undefined,
  });

  // wa.me links can only be opened by the browser, one at a time, at the owner's pace.
  async function runLinks(result) {
    const host = $("#runner", root);
    let index = 0;
    let timer = null;
    const finish = () => {
      window.clearInterval(timer);
      mount(host, html`<div class="notice notice-success">All ${result.links.length} messages were opened. Press send in each WhatsApp window.</div>`);
    };
    const open = async () => {
      const link = result.links[index];
      if (!link) return finish();
      const opened = window.open(link.url, "educobra_whatsapp");
      if (!opened) {
        mount(host, html`<div class="notice notice-danger row-between"><span>Your browser blocked the window. Allow pop-ups for this site, then continue.</span><button class="btn btn-sm btn-primary" type="button" data-action="next-link">Continue</button></div>`);
        window.clearInterval(timer);
        return undefined;
      }
      await client.report(link._id, "sent").catch(() => undefined);
      index += 1;
      if (index >= result.links.length) return finish();
      let left = result.delaySeconds;
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) {
          window.clearInterval(timer);
          open();
          return;
        }
        mount(host, html`<div class="notice row-between"><span>Opened ${index} of ${result.links.length}. Next: ${result.links[index].name} in ${left}s</span><button class="btn btn-sm btn-secondary" type="button" data-action="next-link">Open now</button></div>`);
      }, 1000);
      return undefined;
    };
    const stop = on(root, "click", "[data-action=next-link]", () => {
      window.clearInterval(timer);
      open();
    });
    stops.push(() => {
      stop();
      window.clearInterval(timer);
    });
    await open();
  }

  // Live progress of a batch the server is sending (linked WhatsApp number or Telegram).
  function watchBatch(batchId, total) {
    window.clearTimeout(progressTimer);
    const tick = async () => {
      const host = $("#runner", root);
      if (!host) return;
      const data = await client.batch(batchId).catch(() => null);
      if (!data) return;
      const counts = {};
      for (const item of data.items) counts[item.status] = (counts[item.status] || 0) + 1;
      const done = total - (counts.queued || 0);
      const failed = counts.failed || 0;
      mount(host, html`<section class="card mt">
        <div class="row-between"><strong>${done < total ? "Sending…" : "Finished"} ${done} of ${total}</strong>
          <span class="status-chips">${Object.entries(counts).map(([status, count]) => badge(`${count} ${status}`, STATUS_TONE[status]))}</span></div>
        <div class="progress mt"><span style="width:${Math.round((done / Math.max(1, total)) * 100)}%"></span></div>
        ${failed ? html`<p class="small text-danger mt">${failed} failed. Open History → Details to see why.</p>` : ""}
        ${done < total ? html`<p class="small muted mt">The server keeps sending if you leave this page.</p>` : ""}
      </section>`);
      if (done < total) progressTimer = window.setTimeout(tick, 5000);
    };
    tick();
  }

  stops.push(() => window.clearTimeout(progressTimer));
  stops.push(on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab });
    render();
  }));
  stops.push(on(root, "change", "#m-audience,#m-session,#m-recipient,#m-channel,#m-grade,#m-center", (event, select) => {
    const key = select.id.slice(2);
    const before = form.audience;
    form[key] = select.value;
    if (key === "audience") {
      // Switch to the saved message for that kind, unless the current one was written by hand.
      const previous = config.templates[typeOf(before)] || "";
      if (!draft.trim() || draft === previous) draft = config.templates[typeOf(form.audience)] || "";
      rows = [];
      render();
      return;
    }
    if (key === "channel") {
      const note = $("#channel-note", root);
      if (note) mount(note, channelNote());
      renderReview();
      return;
    }
    // Different students now: the prepared list no longer matches.
    rows = [];
    renderReview();
  }));
  stops.push(on(root, "input", "#m-body", (event, area) => {
    draft = area.value;
    applyDraft();
  }));
  stops.push(on(root, "change", "#t-type", (event, select) => {
    templateType = select.value;
    render();
  }));
  stops.push(on(root, "input", "#row-search", (event, input) => {
    search = input.value.trim().toLowerCase();
    for (const tr of root.querySelectorAll("#review tbody tr")) {
      const row = rows[Number(tr.dataset.index)];
      tr.hidden = Boolean(search) && !`${row.name} ${row.userID} ${row.to}`.toLowerCase().includes(search);
    }
  }));
  stops.push(on(root, "input", "#review [data-field]", (event, input) => {
    const row = rows[Number(input.closest("tr").dataset.index)];
    row[input.dataset.field] = input.value;
    if (input.dataset.field === "to") {
      const wasWrong = row.phoneCheck && !row.phoneCheck.ok;
      row.phoneCheck = checkPhone(input.value);
      input.classList.toggle("input-error", !row.phoneCheck.ok);
      const slot = input.parentElement.querySelector("[data-phone-slot]");
      if (slot) mount(slot, phoneMark(row));
      // A number that becomes right is ticked again.
      if (wasWrong && row.phoneCheck.ok) {
        row.include = true;
        const tr = input.closest("tr");
        tr.classList.remove("row-off");
        tr.querySelector("[data-include]").checked = true;
        refreshCounts();
      }
    }
    if (input.dataset.field === "body") {
      row.edited = input.value !== renderTemplate(draft, row.values);
      updateCount(input, row);
    }
  }));
  stops.push(on(root, "change", "[data-include]", (event, box) => {
    const tr = box.closest("tr");
    rows[Number(tr.dataset.index)].include = box.checked;
    tr.classList.toggle("row-off", !box.checked);
    refreshCounts();
  }));
  stops.push(on(root, "click", "[data-variable]", (event, button) => {
    const area = $(`#${button.dataset.target}`, root);
    if (!area) return;
    const token = `{${button.dataset.variable}}`;
    area.setRangeText(token, area.selectionStart ?? area.value.length, area.selectionEnd ?? area.value.length, "end");
    area.focus();
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }));
  stops.push(on(root, "click", "[data-batch]", async (event, button) => {
    const data = await client.batch(button.dataset.batch);
    openDialog({
      title: "Messages",
      size: "lg",
      body: table(
        [
          { label: "Student", render: (row) => html`${row.name}${row.recipient ? html`<br><span class="muted small">${row.recipient}</span>` : ""}` },
          { label: "To", render: (row) => row.to || "—" },
          { label: "Status", render: (row) => html`${badge(row.status, STATUS_TONE[row.status])}${row.error ? html`<br><span class="small text-danger">${row.error}</span>` : ""}` },
          { label: "Message", render: (row) => html`<span class="small" style="white-space:pre-line">${row.body}</span>` },
        ],
        data.items,
      ),
      actions: html`<button class="btn btn-primary" type="button" data-close>Close</button>`,
    });
  }));
  stops.push(on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "load") {
      if (needsSession() && !form.session) {
        toast("Choose a session first.", "danger");
        return;
      }
      const data = await withBusy(button, () => client.preview(previewBody()));
      if (data) {
        rows = data.items.map((row) => ({ ...row, include: form.channel === "telegram" ? telegramReady(row) : row.phoneCheck?.ok !== false }));
        search = "";
        render();
        if (!rows.length) toast("No student matches these choices.", "danger");
      }
    }
    if (action === "remove-wrong") {
      const before = rows.length;
      rows = rows.filter((row) => !(row.phoneCheck && !row.phoneCheck.ok));
      toast(`${before - rows.length} wrong number${before - rows.length === 1 ? "" : "s"} removed.`);
      renderReview();
    }
    if (action === "check-numbers") {
      const phones = [...new Set(rows.map((row) => String(row.to || "").trim()).filter(Boolean))];
      if (!phones.length) return;
      const result = await withBusy(button, () => client.checkNumbers(phones));
      if (!result) return;
      const byPhone = new Map(result.numbers.map((item) => [item.phone, item]));
      let bad = 0;
      for (const row of rows) {
        const found = byPhone.get(String(row.to || "").trim());
        row.phoneCheck = found ? { ok: found.ok, reason: found.reason } : checkPhone(row.to);
        if (!row.phoneCheck.ok) {
          row.include = false;
          bad += 1;
        }
      }
      renderReview();
      const note = {
        checked: "",
        busy: " WhatsApp wasn't asked because the number is busy sending; only the format was checked.",
        not_linked: " No WhatsApp number is linked, so only the format was checked.",
        unavailable: " WhatsApp didn't answer, so only the format was checked.",
      }[result.whatsapp] || "";
      toast(bad ? `${bad} number${bad === 1 ? "" : "s"} can't receive WhatsApp.${note}` : `All numbers look right.${note}`, bad ? "danger" : "success", 7000);
    }
    if (action === "all" || action === "none") {
      for (const row of rows) row.include = action === "all" && (!usesPhone() || row.phoneCheck?.ok !== false);
      renderReview();
    }
    if (action === "remove-row") {
      rows.splice(Number(button.closest("tr").dataset.index), 1);
      renderReview();
    }
    if (action === "add") {
      const input = $("#add-student", root);
      const identifier = input.value.trim();
      if (!identifier) return;
      const added = await withBusy(button, () => client.previewOne({ session: needsSession() ? form.session : undefined, type: typeOf(form.audience), recipient: form.recipient, template: draft, identifier }));
      if (added) {
        rows.push(...[].concat(added).map((row) => ({ ...row, include: true })));
        renderReview();
      }
    }
    if (action === "send") {
      const chosen = selected();
      if (form.channel !== "telegram" && chosen.some((row) => !String(row.to || "").trim())) {
        toast(`${chosen.filter((row) => !String(row.to || "").trim()).length} selected row(s) have no phone number. They'll be skipped.`, "danger");
      }
      const items = chosen.map(({ student, name, to, body, recipient }) => ({ student, name, to: to || "", body, recipient }));
      const result = await withBusy(button, () => client.send({ session: needsSession() ? form.session : undefined, type: typeOf(form.audience), channel: form.channel, items }));
      if (!result) return;
      if (result.links) {
        await runLinks(result);
        return;
      }
      const skipped = result.skipped ? ` ${result.skipped} with a wrong number were skipped.` : "";
      toast(result.simulated ? `${result.queued} messages recorded as simulated (no number linked).${skipped}` : `${result.queued} messages are on their way.${skipped}`);
      const total = result.queued;
      rows = [];
      renderReview();
      if (!result.simulated) watchBatch(result.batch, total);
    }
    if (action === "save-draft") {
      const type = typeOf(form.audience);
      if (await withBusy(button, () => client.saveTemplate(type, draft), "Template saved.")) config.templates[type] = draft;
    }
    if (action === "save-template") {
      const body = $("#t-body", root).value;
      if (await withBusy(button, () => client.saveTemplate(templateType, body), "Template saved.")) config.templates[templateType] = body;
    }
  }));

  await render();
  return () => stops.forEach((stop) => stop());
}
