import { badge, confirmDialog, dateTime, html, mount, on, withBusy } from "../../core/ui.js";

const LABELS = {
  disconnected: ["Not linked", "muted"],
  connecting: ["Starting…", "info"],
  qr: ["Waiting for the scan", "warn"],
  connected: ["Linked", "success"],
};

// Links a WhatsApp number to the server by QR code. The server holds the login and sends by itself;
// this card only shows the code and the status. `account` is "platform" (the owner's number) or a teacher id.
export function whatsappLinkCard(host, api, account, { title = "WhatsApp number", intro = "" } = {}) {
  let timer = null;
  let stopped = false;
  let last = null;

  const view = (state) => {
    const [label, tone] = LABELS[state.status] || [state.status, "muted"];
    const waiting = state.status === "qr" || state.status === "connecting";
    return html`<div class="card-head"><h3>${title}</h3>${badge(label, tone)}</div>
      ${intro ? html`<p class="muted small mb">${intro}</p>` : ""}
      ${state.status === "connected" ? html`<p class="strong">+${state.phone || ""}</p>
        <p class="muted small mb">${state.lastSentAt ? `Last message sent ${dateTime(state.lastSentAt)}` : "No message sent yet."}${state.queued ? ` · ${state.queued} waiting to be sent${state.busy ? " (sending now)" : ""}` : ""}</p>` : ""}
      ${state.error ? html`<p class="text-danger small mb">${state.error}</p>` : ""}
      ${state.status === "qr" && state.qr ? html`<div class="wa-qr">
          <img class="qr-wa" src="${state.qr}" alt="WhatsApp link code">
          <ol class="small muted wa-steps">
            <li>Open WhatsApp on the phone that has this number.</li>
            <li>Tap <strong>⋮</strong> or <strong>Settings</strong> → <strong>Linked devices</strong> → <strong>Link a device</strong>.</li>
            <li>Point the phone at this code. It changes every 20 seconds.</li>
          </ol>
        </div>` : ""}
      ${state.status === "connecting" ? html`<p class="muted small mb">Preparing the code… this takes a few seconds.</p>` : ""}
      <div class="row">${state.status === "connected"
        ? html`<button class="btn btn-secondary btn-sm" type="button" data-wa="connect">Check connection</button>
               <button class="btn btn-danger btn-sm" type="button" data-wa="logout">Unlink</button>`
        : waiting
          ? html`<button class="btn btn-ghost btn-sm" type="button" data-wa="connect">New code</button>`
          : html`<button class="btn btn-primary btn-sm" type="button" data-wa="connect">Link WhatsApp</button>`}</div>`;
  };

  async function refresh() {
    if (stopped) return;
    window.clearTimeout(timer);
    const state = await api.whatsappAccount(account).catch(() => null);
    if (stopped) return;
    if (state) {
      // Skip re-rendering when nothing changed, so the code doesn't flicker.
      const key = JSON.stringify([state.status, state.qr, state.error, state.phone, state.queued, state.busy, state.lastSentAt]);
      if (key !== last) {
        last = key;
        mount(host, view(state));
      }
    }
    const fast = state && (state.status === "qr" || state.status === "connecting" || state.busy);
    timer = window.setTimeout(refresh, fast ? 2500 : 15000);
  }

  const stopClicks = on(host, "click", "[data-wa]", async (event, button) => {
    if (button.dataset.wa === "logout") {
      if (!(await confirmDialog("Unlink this WhatsApp number? Messages waiting to be sent from it will be cancelled.", { danger: true, confirmLabel: "Unlink" }))) return;
      await withBusy(button, () => api.logoutWhatsappAccount(account), "WhatsApp unlinked.");
    } else {
      await withBusy(button, () => api.connectWhatsappAccount(account));
    }
    last = null;
    refresh();
  });

  mount(host, html`<div class="card-head"><h3>${title}</h3></div><p class="muted">Loading…</p>`);
  refresh();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    stopClicks();
  };
}
