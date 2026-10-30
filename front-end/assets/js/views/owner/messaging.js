import { fieldHtml, html, mount, on, pageHeader, readForm, withBusy } from "../../core/ui.js";

const LABELS = {
  disconnected: "Not linked",
  connecting: "Connecting…",
  qr: "Scan the code with WhatsApp",
  connected: "Linked",
};

export default async function ownerMessaging(ctx) {
  const { root, api } = ctx;
  const settings = await api.owner.messaging();
  const general = [
    { name: "delaySeconds", label: "Delay between WhatsApp messages (seconds)", type: "number", min: 0, value: settings.delaySeconds, hint: "Applies to WhatsApp links and the linked server number." },
    { name: "maxChars", label: "Maximum letters per message (WhatsApp API)", type: "number", min: 20, value: settings.maxChars },
  ];
  const whatsappApi = [
    { name: "enabled", label: "Use the WhatsApp API", type: "checkbox", checked: settings.whatsappApi.enabled },
    { name: "phoneNumberId", label: "Phone number ID", value: settings.whatsappApi.phoneNumberId },
    { name: "accessToken", label: "Access token", type: "password", value: settings.whatsappApi.accessToken, hint: "Leave as it is to keep the saved token." },
  ];
  let timer = null;

  function linkHtml(state) {
    return html`<p class="strong mb">${LABELS[state.status] || state.status}${state.phone ? ` · +${state.phone}` : ""}</p>
      ${state.error ? html`<p class="text-danger small">${state.error}</p>` : ""}
      ${state.status === "qr" && state.qr ? html`<img class="qr-img mb" src="${state.qr}" alt="WhatsApp link code"><p class="muted small">WhatsApp → Linked devices → Link a device.</p>` : ""}
      <div class="row">${state.status === "connected"
        ? html`<button class="btn btn-danger btn-sm" data-action="logout">Unlink</button>`
        : html`<button class="btn btn-primary btn-sm" data-action="connect">${state.status === "disconnected" ? "Link WhatsApp" : "Try again"}</button>`}</div>`;
  }

  async function refresh() {
    const host = root.querySelector("#wa-link");
    if (!host) return;
    const state = await api.owner.whatsapp().catch(() => null);
    if (state && root.querySelector("#wa-link")) mount(host, linkHtml(state));
  }

  mount(root, html`${pageHeader({ eyebrow: "EduCobra", title: "Messaging", text: "Control how Telegram and WhatsApp messages go out. Which channel each teacher can use is set on the teacher's page." })}
    <div class="grid grid-main">
      <div class="stack">
        <section class="card"><div class="card-head"><h3>Sending limits</h3></div>
          <form id="general-form" class="form-grid">${general.map(fieldHtml)}<div class="field-full row"><button class="btn btn-primary" type="submit">Save</button></div></form></section>
        <section class="card"><div class="card-head"><h3>WhatsApp API</h3></div>
          <form id="api-form" class="form-grid">${whatsappApi.map(fieldHtml)}<div class="field-full row"><button class="btn btn-primary" type="submit">Save</button></div></form>
          <p class="muted small mt">Without an active API account, messages are marked "simulated" so you can test the whole flow.</p></section>
      </div>
      <section class="card"><div class="card-head"><h3>WhatsApp on the server</h3></div><div id="wa-link"><p class="muted">Loading…</p></div></section>
    </div>`);

  const stops = [
    on(root, "submit", "#general-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.updateMessaging(readForm(form, general)), "Saved.");
    }),
    on(root, "submit", "#api-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.updateMessaging({ whatsappApi: readForm(form, whatsappApi) }), "Saved.");
    }),
    on(root, "click", "[data-action]", async (event, button) => {
      await withBusy(button, () => (button.dataset.action === "connect" ? api.owner.connectWhatsapp() : api.owner.logoutWhatsapp()));
      await refresh();
    }),
  ];
  await refresh();
  timer = window.setInterval(refresh, 2500);
  return () => {
    window.clearInterval(timer);
    stops.forEach((stop) => stop());
  };
}
