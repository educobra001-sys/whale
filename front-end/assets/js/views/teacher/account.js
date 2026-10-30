import { LANGUAGES, SUBJECTS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { logout } from "../../core/session.js";
import { avatar, badge, confirmDialog, fieldHtml, formDialog, fullName, html, mount, on, pageHeader, readForm, toast, withBusy } from "../../core/ui.js";

export function passwordDialog(api, role) {
  return formDialog({
    title: "Change password",
    size: "sm",
    fields: [
      { name: "currentPassword", label: "Current password", type: "password", required: true, full: true, autocomplete: "current-password" },
      { name: "newPassword", label: "New password", type: "password", required: true, full: true, autocomplete: "new-password", hint: "At least 8 characters" },
      { name: "confirm", label: "Repeat new password", type: "password", required: true, full: true, autocomplete: "new-password" },
    ],
    submitLabel: "Update password",
    onSubmit: ({ currentPassword, newPassword, confirm }) => {
      if (newPassword.length < 8) throw new Error("The new password must be at least 8 characters.");
      if (newPassword !== confirm) throw new Error("The new passwords don't match.");
      return api.changePassword(role, { currentPassword, newPassword });
    },
  });
}

export default async function account(ctx) {
  const { root, api, reloadMe } = ctx;
  const profile = await api.teacher.profile();

  const fields = [
    { name: "firstName", label: "First name", value: profile.firstName },
    { name: "lastName", label: "Last name", value: profile.lastName },
    { name: "companyName", label: "Brand / academy name", value: profile.companyName },
    { name: "gender", label: "Gender", type: "select", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }], value: profile.gender },
    { name: "subject", label: "Subjects", type: "checkboxes", options: SUBJECTS, value: (profile.subject || []).map((value) => (typeof value === "number" ? SUBJECTS[value] : value)) },
    { name: "teachingLanguage", label: "Teaching language", type: "select", options: LANGUAGES, value: typeof profile.teachingLanguage === "number" ? LANGUAGES[profile.teachingLanguage] : profile.teachingLanguage },
    { name: "bio", label: "About you (shown to students in the teacher directory)", type: "textarea", full: true, value: profile.bio },
  ];

  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: "Your account" })}
    <div class="grid grid-main">
      <section class="card card-accent">
        <div class="card-head"><h3>Profile</h3></div>
        <form id="profile-form" class="form-grid">${fields.map(fieldHtml)}
          <div class="field-full row"><button class="btn btn-primary" type="submit">Save profile</button></div></form>
      </section>
      <div class="stack">
        <section class="card">
          <div class="card-head"><h3>How students see you</h3></div>
          <div class="person mb">${avatar(profile, "lg")}<div><strong>${fullName(profile)}</strong><span>${profile.companyName || ""}</span></div></div>
          <div class="status-chips mb">${(profile.subject || []).map((subject) => badge(typeof subject === "number" ? SUBJECTS[subject] : subject, "accent"))}</div>
          <p class="muted small">Students find you by name or username <strong>@${profile.userName}</strong> and send a join request. Centers invite you with the same username.</p>
          <div class="row"><label class="btn btn-secondary btn-sm" for="photo-input">${icon("upload", 15)} Change photo</label><input id="photo-input" type="file" accept="image/*" hidden></div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Sign-in details</h3></div>
          <dl class="kv mb"><dt>Username</dt><dd>${profile.userName}</dd><dt>Email</dt><dd>${profile.email}</dd><dt>Phone</dt><dd>${profile.phone}</dd></dl>
          <button class="btn btn-secondary" data-action="password">Change password</button>
        </section>
        <section class="card">
          <div class="card-head"><h3>Delete account</h3></div>
          <p class="muted small">Deletes your teacher account. Students keep their own accounts but lose access to your lessons.</p>
          <button class="btn btn-danger" data-action="delete">Delete my account</button>
        </section>
      </div>
    </div>`,
  );

  on(root, "submit", "#profile-form", async (event, form) => {
    event.preventDefault();
    const values = readForm(form, fields);
    const body = Object.fromEntries(Object.entries(values).filter(([, value]) => (Array.isArray(value) ? true : value)));
    const saved = await withBusy(form.querySelector("button[type=submit]"), () => api.teacher.updateProfile(body), "Profile saved.");
    if (saved) await reloadMe();
  });
  on(root, "change", "#photo-input", async (event, input) => {
    const file = input.files[0];
    if (!file) return;
    try {
      const { url } = await api.upload(file);
      await api.teacher.updateProfile({ profilepic: url });
      toast("Photo updated.");
      await reloadMe();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  on(root, "click", "[data-action]", async (event, button) => {
    if (button.dataset.action === "password") {
      if (await passwordDialog(api, "teacher")) toast("Password updated.");
    }
    if (button.dataset.action === "delete") {
      if (!(await confirmDialog("This permanently deletes your teacher account. This can't be undone.", { title: "Delete your account?", danger: true, confirmLabel: "Delete forever" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteAccount()))) return;
      logout();
    }
  });
}
