import { badge, confirmDialog, date, debounce, emptyState, fieldHtml, html, mount, on, pageHeader, readForm, table, withBusy } from "../../core/ui.js";
import { whatsappLinkCard } from "../shared/whatsapp-link.js";

export default async function ownerMessaging(ctx) {
  const { root, api } = ctx;
  const settings = await api.owner.messaging();
  const general = [
    { name: "delaySeconds", label: "Delay between WhatsApp messages (seconds)", type: "number", min: 0, value: settings.delaySeconds, hint: "Applies to linked numbers and WhatsApp links. 10–20 seconds keeps a number safe from WhatsApp's spam checks." },
    { name: "maxChars", label: "Maximum letters per message (WhatsApp API)", type: "number", min: 20, value: settings.maxChars },
  ];
  const whatsappApi = [
    { name: "enabled", label: "Use the WhatsApp API", type: "checkbox", checked: settings.whatsappApi.enabled },
    { name: "phoneNumberId", label: "Phone number ID", value: settings.whatsappApi.phoneNumberId },
    { name: "accessToken", label: "Access token", type: "password", value: settings.whatsappApi.accessToken, hint: "Leave as it is to keep the saved token." },
  ];
  const stops = [];
  let linkSearch = "";

  function telegramHtml(bot) {
    if (!bot.configured) {
      return html`<div class="card-head"><h3>Telegram bot</h3>${badge("Not set up", "muted")}</div>
        <ol class="small muted mb wa-steps">
          <li>In Telegram, open <strong>@BotFather</strong> and send <code>/newbot</code>.</li>
          <li>Choose a name and a username ending in "bot".</li>
          <li>Copy the token BotFather sends and paste it here.</li>
        </ol>
        <form id="telegram-form" class="stack">
          ${fieldHtml({ name: "token", label: "Bot token", type: "password", required: true, placeholder: "123456789:AA…", autocomplete: "off" })}
          <button class="btn btn-primary btn-sm" type="submit">Connect bot</button>
        </form>`;
    }
    return html`<div class="card-head"><h3>Telegram bot</h3>${badge(bot.mode === "webhook" ? "Active" : "Active (polling)", "success")}</div>
      <p class="strong">${bot.botName || "Bot"} · <a href="${bot.link}" target="_blank" rel="noopener">@${bot.username}</a></p>
      <p class="muted small mb">${bot.linkedChats} chat${bot.linkedChats === 1 ? "" : "s"} linked. Anyone who opens the bot is asked to share their phone number; it's matched with the student and parent numbers you have.</p>
      ${bot.mode === "polling" ? html`<p class="small notice mb">This server has no https address, so the background worker checks Telegram for new chats. On Vercel this switches to a webhook by itself.</p>` : ""}
      ${bot.fromEnvironment ? html`<p class="small notice mb">This token comes from TELEGRAM_BOT_TOKEN. Paste it below once to manage it from here and turn on the share-number button.</p>` : ""}
      ${bot.error ? html`<p class="text-danger small mb">${bot.error}</p>` : ""}
      <form id="telegram-form" class="stack">
        ${fieldHtml({ name: "token", label: bot.fromEnvironment ? "Bot token" : "Replace the token", type: "password", required: true, placeholder: "123456789:AA…", autocomplete: "off" })}
        <div class="row"><button class="btn btn-secondary btn-sm" type="submit">${bot.fromEnvironment ? "Connect bot" : "Save and reconnect"}</button>
          ${bot.fromEnvironment ? "" : html`<button class="btn btn-ghost btn-sm" type="button" data-action="remove-telegram">Remove bot</button>`}</div>
      </form>
      <p class="muted small mt">Share this link with parents and students: <a href="${bot.link}" target="_blank" rel="noopener">${bot.link}</a></p>`;
  }

  async function renderTelegram() {
    const host = root.querySelector("#telegram-card");
    if (!host) return;
    const bot = await api.owner.telegram().catch(() => ({ configured: false }));
    mount(host, telegramHtml(bot));
  }

  async function renderLinks() {
    const host = root.querySelector("#telegram-links");
    if (!host) return;
    const rows = await api.owner.telegramLinks({ search: linkSearch }).catch(() => []);
    mount(host, rows.length || linkSearch
      ? table(
          [
            { label: "Student", render: (row) => (row.student ? html`<strong>${row.student.name}</strong><br><span class="muted small">${row.student.userID}</span>` : html`<span class="muted">Removed student</span>`) },
            { label: "As", render: (row) => badge(row.kind === "student" ? "Student" : "Parent", row.kind === "student" ? "info" : "accent") },
            { label: "Phone", render: (row) => row.phone || "—" },
            { label: "Telegram", render: (row) => html`${row.telegramName || "—"}${row.telegramUsername ? html`<br><span class="muted small">@${row.telegramUsername}</span>` : ""}` },
            { label: "Since", render: (row) => date(row.createdAt) },
            { label: "", render: (row) => html`<button class="btn btn-ghost btn-sm" type="button" data-unlink="${row._id}">Remove</button>` },
          ],
          rows,
          { empty: "No chat matches." },
        )
      : emptyState("Nobody linked yet", "When a parent or student opens the bot and shares their number, they appear here."));
  }

  mount(root, html`${pageHeader({ eyebrow: "EduCobra", title: "Messaging", text: "Link the WhatsApp number and the Telegram bot the platform sends from. Which channels each teacher can use, and a teacher's own number, are set on the teacher's page." })}
    <div class="grid grid-main">
      <div class="stack">
        <section class="card" id="wa-link"></section>
        <section class="card" id="telegram-card"><p class="muted">Loading…</p></section>
        <section class="card card-flush">
          <div class="card-head"><h3>Telegram chats</h3><input id="link-search" class="input-sm" type="search" placeholder="Search name, code or phone" aria-label="Search linked chats" style="max-width:240px"></div>
          <div id="telegram-links"><p class="muted" style="padding:16px">Loading…</p></div>
        </section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h3>Sending limits</h3></div>
          <form id="general-form" class="form-grid">${general.map(fieldHtml)}<div class="field-full row"><button class="btn btn-primary" type="submit">Save</button></div></form></section>
        <section class="card"><div class="card-head"><h3>WhatsApp API (Meta)</h3></div>
          <form id="api-form" class="form-grid">${whatsappApi.map(fieldHtml)}<div class="field-full row"><button class="btn btn-primary" type="submit">Save</button></div></form>
          <p class="muted small mt">Optional, and separate from the linked number. Without an active API account, its messages are marked "simulated".</p></section>
      </div>
    </div>`);

  stops.push(whatsappLinkCard(root.querySelector("#wa-link"), api.owner, "platform", {
    title: "Platform WhatsApp number",
    intro: "Every teacher without their own number sends from this one. The server sends the messages itself; nobody needs to keep a page open.",
  }));

  stops.push(
    on(root, "submit", "#general-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.updateMessaging(readForm(form, general)), "Saved.");
    }),
    on(root, "submit", "#api-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.updateMessaging({ whatsappApi: readForm(form, whatsappApi) }), "Saved.");
    }),
    on(root, "submit", "#telegram-form", async (event, form) => {
      event.preventDefault();
      const token = new FormData(form).get("token");
      if (await withBusy(form.querySelector("button[type=submit]"), () => api.owner.setTelegram(String(token || "").trim()), "Telegram bot connected.")) renderTelegram();
    }),
    on(root, "click", "[data-action=remove-telegram]", async (event, button) => {
      if (!(await confirmDialog("Remove the Telegram bot? Linked chats are kept, but nothing is sent by Telegram until a bot is connected again.", { danger: true, confirmLabel: "Remove" }))) return;
      if (await withBusy(button, () => api.owner.removeTelegram(), "Bot removed.")) renderTelegram();
    }),
    on(root, "click", "[data-unlink]", async (event, button) => {
      if (!(await confirmDialog("Stop sending this student's messages to this Telegram chat?", { confirmLabel: "Remove" }))) return;
      if (await withBusy(button, () => api.owner.removeTelegramLink(button.dataset.unlink), "Removed.")) renderLinks();
    }),
    on(root, "input", "#link-search", debounce((event, input) => {
      linkSearch = (input || event.target).value.trim();
      renderLinks();
    }, 300)),
  );

  await Promise.all([renderTelegram(), renderLinks()]);
  return () => stops.forEach((stop) => stop());
}
