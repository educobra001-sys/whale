import { html, mount, pageHeader, toast, on } from "../../core/ui.js";
import { passwordDialog } from "../teacher/account.js";

export default async function ownerAccount(ctx) {
  const { root, api, me } = ctx;
  const profile = me.person;
  mount(root, html`${pageHeader({ eyebrow: "Account", title: profile.name || profile.userName })}
    <section class="card"><dl class="kv mb"><dt>Username</dt><dd>${profile.userName}</dd><dt>Email</dt><dd>${profile.email}</dd></dl>
    <button class="btn btn-secondary" data-action="password">Change password</button></section>`);
  return on(root, "click", "[data-action=password]", async () => {
    if (await passwordDialog(api, "owner")) toast("Password updated.");
  });
}
