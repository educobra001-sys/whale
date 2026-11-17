import { fieldHtml, html, mount, on, pageHeader, readForm, toast, withBusy } from "../../core/ui.js";
import { passwordDialog } from "../teacher/account.js";

export default async function centerAccount(ctx) {
  const isSchool = ctx.me?.role === "school";
  const word = isSchool ? "school" : "center";
  const Word = isSchool ? "School" : "Center";
  const { root, api, reloadMe } = ctx;
  const profile = await api.center.profile();
  const fields = [
    { name: "name", label: `${Word} name`, required: true, value: profile.name },
    { name: "phone", label: "Phone", type: "tel", required: true, value: profile.phone },
    { name: "localphone", label: "Landline", type: "tel", value: profile.localphone },
    { name: "textlocation", label: "Address", full: true, value: profile.textlocation },
    { name: "Maplocation", label: "Map link", type: "url", full: true, value: profile.Maplocation },
  ];

  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: `${Word} details`, text: `Teachers and students see this information when they look up your ${word}.` })}
    <div class="grid grid-main">
      <section class="card card-accent"><form id="center-form" class="form-grid">${fields.map(fieldHtml)}
        <div class="field-full row"><button class="btn btn-primary" type="submit">Save</button></div></form></section>
      <section class="card"><div class="card-head"><h3>Security</h3></div>
        <p class="muted small">You sign in with your ${word} name or phone number.</p>
        <button class="btn btn-secondary" data-action="password">Change password</button></section>
    </div>`,
  );

  on(root, "submit", "#center-form", async (event, form) => {
    event.preventDefault();
    const saved = await withBusy(form.querySelector("button[type=submit]"), () => api.center.updateProfile(readForm(form, fields)), `${Word} details saved.`);
    if (saved) await reloadMe();
  });
  on(root, "click", "[data-action=password]", async () => {
    if (await passwordDialog(api, word)) toast("Password updated.");
  });
}
