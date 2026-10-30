import { PERMISSIONS } from "../../core/config.js";
import { avatar, badge, fieldHtml, fullName, html, mount, on, pageHeader, readForm, toast, whatsappLink, withBusy } from "../../core/ui.js";
import { passwordDialog } from "./account.js";

export default async function assistantAccount(ctx) {
  const { root, api, me, reloadMe } = ctx;
  const profile = me.person;
  const teacher = me.teacher || {};
  const fields = [
    { name: "firstName", label: "First name", value: profile.firstName },
    { name: "lastName", label: "Last name", value: profile.lastName },
    { name: "phone", label: "Phone", type: "tel", value: profile.phone },
  ];
  const full = me.permissions.size === PERMISSIONS.length;

  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: "My account" })}
    <div class="grid grid-2">
      <section class="card card-accent">
        <div class="card-head"><h3>Your teacher</h3></div>
        <div class="person mb">${avatar(teacher, "lg")}<div><strong>${fullName(teacher)}</strong><span>${(teacher.subject || []).join(", ")}</span></div></div>
        ${teacher.phone ? html`<a class="btn btn-secondary btn-sm" href="${whatsappLink(teacher.phone)}" target="_blank" rel="noopener">Message on WhatsApp</a>` : ""}
        <h3 class="mt" style="font-size:15px">What you can do</h3>
        <div class="status-chips">${full ? badge("Full access", "accent") : PERMISSIONS.filter((permission) => me.permissions.has(permission.key)).map((permission) => badge(permission.label, "muted"))}</div>
      </section>
      <section class="card">
        <div class="card-head"><h3>Your details</h3></div>
        <form id="assistant-form" class="form-grid">${fields.map(fieldHtml)}
          <div class="field-full row"><button class="btn btn-primary" type="submit">Save</button><button class="btn btn-secondary" type="button" data-action="password">Change password</button></div></form>
        <dl class="kv mt"><dt>Username</dt><dd>${profile.userName}</dd><dt>Email</dt><dd>${profile.email}</dd></dl>
      </section>
    </div>`,
  );

  on(root, "submit", "#assistant-form", async (event, form) => {
    event.preventDefault();
    const saved = await withBusy(form.querySelector("button[type=submit]"), () => api.assistant.updateProfile(readForm(form, fields)), "Saved.");
    if (saved) await reloadMe();
  });
  on(root, "click", "[data-action=password]", async () => {
    if (await passwordDialog(api, "assistant")) toast("Password updated.");
  });
}
