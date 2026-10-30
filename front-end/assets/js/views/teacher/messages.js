import { icon } from "../../core/icons.js";
import { $, badge, dateTime, emptyState, html, mount, on, openDialog, pageHeader, table, tabs, toast, withBusy } from "../../core/ui.js";

const TYPES = [{ value: "attendance", label: "Attendance" }, { value: "absence", label: "Absence" }];
const STATUS_TONE = { sent: "success", simulated: "info", queued: "muted", failed: "danger", skipped: "muted" };

export default async function messages(ctx) {
  const { root, api, query, setQuery } = ctx;
  let tab = query.tab || "send";
  const [config, sessions] = await Promise.all([api.teacher.messageConfig(), api.teacher.sessions()]);
  let rows = [];
  let batches = [];
  const form = { session: query.session || sessions[0]?._id || "", type: "attendance", channel: config.channels[0]?.key || "" };
  let templateType = "attendance";
  const stops = [];

  const limit = () => (form.channel === "whatsapp_api" ? config.maxChars : null);

  function rowHtml(row, index) {
    const max = limit();
    const over = max && row.body.length > max;
    return html`<tr data-index="${index}">
      <td data-label="Student"><strong>${row.name}</strong><br><span class="muted small">${row.userID || ""}</span></td>
      <td data-label="Send to"><input class="input-sm" data-field="to" value="${row.to || ""}" aria-label="Phone for ${row.name}"></td>
      <td data-label="Message"><textarea rows="3" data-field="body" aria-label="Message for ${row.name}">${row.body}</textarea>
        ${max ? html`<span class="small ${over ? "text-danger strong" : "muted"}" data-count>${row.body.length} / ${max}</span>` : ""}</td>
      <td class="num"><button class="icon-btn" type="button" data-action="remove-row" aria-label="Remove ${row.name}">${icon("close", 16)}</button></td>
    </tr>`;
  }

  function sendTab() {
    if (!config.channels.length) return emptyState("No channel is active yet", "EduCobra activates Telegram or WhatsApp for your account. Contact the team to turn it on.");
    if (!sessions.length) return emptyState("No sessions yet", "Messages are prepared from a session.");
    return html`<section class="card mb">
        <div class="form-grid">
          <div class="field"><label for="m-session">Session</label><select id="m-session">${sessions.map((session) => html`<option value="${session._id}" ${session._id === form.session ? html`selected` : ""}>Week ${session.week} · #${session.number} · ${session.sequence}</option>`)}</select></div>
          <div class="field"><label for="m-type">Message type</label><select id="m-type">${TYPES.map((type) => html`<option value="${type.value}" ${type.value === form.type ? html`selected` : ""}>${type.label}</option>`)}</select></div>
          <div class="field"><label for="m-channel">Send by</label><select id="m-channel">${config.channels.map((channel) => html`<option value="${channel.key}" ${channel.key === form.channel ? html`selected` : ""}>${channel.label}</option>`)}</select></div>
          <div class="field row"><button class="btn btn-primary" type="button" data-action="load">Prepare messages</button></div>
        </div>
      </section>
      <div id="review"></div>`;
  }

  function renderReview() {
    const host = $("#review", root);
    if (!host) return;
    if (!rows.length) {
      mount(host, emptyState("Nothing prepared", "Choose a session and press Prepare messages. You'll review every student here before anything is sent."));
      return;
    }
    const waiting = form.channel === "whatsapp_link" || form.channel === "whatsapp_web";
    mount(host, html`<section class="card card-flush mb">
      <div class="card-head"><h3>${rows.length} message${rows.length === 1 ? "" : "s"} to review</h3>
        <div class="row"><input id="add-student" class="input-sm" placeholder="Student code or phone" aria-label="Add a student"><button class="btn btn-secondary btn-sm" type="button" data-action="add">${icon("plus", 15)} Add</button></div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Send to</th><th>Message</th><th></th></tr></thead>
      <tbody>${rows.map(rowHtml)}</tbody></table></div>
      <div class="card-foot row-between"><span class="muted small">${waiting ? `One message every ${config.delaySeconds} seconds, set by EduCobra.` : "Sent straight away in the background."}</span>
        <button class="btn btn-primary" type="button" data-action="send">Send to all</button></div>
    </section><div id="runner"></div>`);
  }

  function templatesTab() {
    return html`<section class="card">
      <div class="form-grid">
        <div class="field"><label for="t-type">Template</label><select id="t-type">${TYPES.map((type) => html`<option value="${type.value}" ${type.value === templateType ? html`selected` : ""}>${type.label}</option>`)}</select></div>
        <div class="field field-full"><label for="t-body">Message</label><textarea id="t-body" rows="7">${config.templates[templateType]}</textarea></div>
        <div class="field field-full"><span class="field-hint">Press a button to add it at the cursor. It's replaced for each student.</span>
          <div class="status-chips mt">${config.variables.map((variable) => html`<button class="btn btn-secondary btn-sm" type="button" data-variable="${variable.key}">${variable.label}</button>`)}</div></div>
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
    if (tab === "history") batches = await api.teacher.messageBatches();
    mount(root, html`${pageHeader({ eyebrow: "Engagement", title: "Messages", text: "Send attendance and absence messages to students and parents." })}
      ${tabs([{ key: "send", label: "Send" }, { key: "templates", label: "Templates" }, { key: "history", label: "History" }], tab)}
      <div class="mt">${tab === "send" ? sendTab() : tab === "templates" ? templatesTab() : historyTab()}</div>`);
    if (tab === "send") renderReview();
  }

  const syncRow = (input) => {
    const index = Number(input.closest("tr").dataset.index);
    rows[index][input.dataset.field] = input.value;
    const counter = input.parentElement.querySelector("[data-count]");
    if (counter) {
      counter.textContent = `${input.value.length} / ${config.maxChars}`;
      counter.className = `small ${input.value.length > config.maxChars ? "text-danger strong" : "muted"}`;
    }
  };

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
      await api.teacher.reportMessage(link._id, "sent").catch(() => undefined);
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

  stops.push(on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab });
    render();
  }));
  stops.push(on(root, "change", "#m-session,#m-type,#m-channel", (event, select) => {
    form[select.id.slice(2)] = select.value;
    if (select.id === "m-channel") renderReview();
  }));
  stops.push(on(root, "change", "#t-type", (event, select) => {
    templateType = select.value;
    render();
  }));
  stops.push(on(root, "input", "[data-field]", (event, input) => syncRow(input)));
  stops.push(on(root, "click", "[data-variable]", (event, button) => {
    const area = $("#t-body", root);
    const token = `{${button.dataset.variable}}`;
    area.setRangeText(token, area.selectionStart, area.selectionEnd, "end");
    area.focus();
  }));
  stops.push(on(root, "click", "[data-batch]", async (event, button) => {
    const data = await api.teacher.messageBatch(button.dataset.batch);
    openDialog({
      title: "Messages",
      size: "lg",
      body: table(
        [
          { label: "Student", render: (row) => row.name },
          { label: "To", render: (row) => row.to },
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
      const data = await withBusy(button, () => api.teacher.previewMessages({ session: form.session, type: form.type }));
      if (data) {
        rows = data.items;
        renderReview();
      }
    }
    if (action === "remove-row") {
      rows.splice(Number(button.closest("tr").dataset.index), 1);
      renderReview();
    }
    if (action === "add") {
      const input = $("#add-student", root);
      const identifier = input.value.trim();
      if (!identifier) return;
      const row = await withBusy(button, () => api.teacher.previewMessage({ session: form.session, type: form.type, identifier }));
      if (row) {
        rows.push(row);
        renderReview();
      }
    }
    if (action === "send") {
      const items = rows.map(({ student, name, to, body }) => ({ student, name, to, body }));
      const result = await withBusy(button, () => api.teacher.sendMessages({ session: form.session, type: form.type, channel: form.channel, items }));
      if (!result) return;
      if (result.links) {
        await runLinks(result);
      } else {
        toast(`${result.queued} messages queued.`);
        rows = [];
        renderReview();
      }
    }
    if (action === "save-template") {
      const body = $("#t-body", root).value;
      const saved = await withBusy(button, () => api.teacher.saveMessageTemplate(templateType, body), "Template saved.");
      if (saved) config.templates[templateType] = body;
    }
  }));

  await render();
  return () => stops.forEach((stop) => stop());
}

