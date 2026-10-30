import { icon } from "../../core/icons.js";
import { avatar, fieldHtml, gradeLabel, html, languageLabel, mount, on, pageHeader, qrDataUrl, readForm, toast, withBusy } from "../../core/ui.js";
import { passwordDialog } from "../teacher/account.js";

export default async function studentAccount(ctx) {
  const { root, api, me, reloadMe } = ctx;
  const student = await api.student.profile();
  const qr = await qrDataUrl(student.userID).catch(() => "");
  const fields = [
    { name: "firstName", label: "First name", required: true, value: student.firstName },
    { name: "lastName", label: "Last name", value: student.lastName },
    { name: "parentPhone", label: "Parent phone", type: "tel", value: student.parentPhone, hint: "Your parent signs up with this number to follow you." },
    { name: "schoolName", label: "School", value: student.schoolName },
  ];

  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: "Profile" })}
    <div class="grid grid-main">
      <section class="card card-accent">
        <div class="card-head"><h3>Your details</h3></div>
        <form id="student-form" class="form-grid">${fields.map(fieldHtml)}
          <div class="field-full row"><button class="btn btn-primary" type="submit">Save</button><button class="btn btn-secondary" type="button" data-action="password">Change password</button></div></form>
        <dl class="kv mt"><dt>Phone</dt><dd>${student.phone}</dd><dt>Grade</dt><dd>${gradeLabel(student.grade)}</dd><dt>Learning language</dt><dd>${languageLabel(student.learningLanguage)}</dd></dl>
        <p class="muted small">To change your phone or grade, ask your teacher.</p>
      </section>
      <div class="stack">
        <section class="card">
          <div class="person mb">${avatar(student, "xl")}<div><strong>${student.firstName} ${student.lastName || ""}</strong><span>${student.userID}</span></div></div>
          <label class="btn btn-secondary btn-sm" for="photo-input">${icon("upload", 15)} Change photo</label><input id="photo-input" type="file" accept="image/*" hidden>
        </section>
        <section class="id-card"><div><p class="eyebrow">Student code</p><p class="code">${student.userID}</p><p class="muted small" style="margin:0">Give this code to your parent so they can follow your progress.</p></div>${qr ? html`<img class="qr-img" src="${qr}" alt="Your QR code">` : ""}</section>
        <section class="card"><div class="card-head"><h3>Your teachers</h3></div>
          <p class="muted small">${(me.teachers || []).filter((entry) => entry.status === "active").length} subscribed · ${(me.teachers || []).filter((entry) => entry.status === "pending").length} waiting</p>
          <a class="btn btn-secondary btn-sm" href="#/teachers">Manage teachers</a></section>
      </div>
    </div>`,
  );

  on(root, "submit", "#student-form", async (event, form) => {
    event.preventDefault();
    const saved = await withBusy(form.querySelector("button[type=submit]"), () => api.student.updateProfile(readForm(form, fields)), "Profile saved.");
    if (saved) await reloadMe();
  });
  on(root, "change", "#photo-input", async (event, input) => {
    const file = input.files[0];
    if (!file) return;
    try {
      const { url } = await api.upload(file);
      await api.student.updateProfile({ profilepic: url });
      toast("Photo updated.");
      await reloadMe();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  on(root, "click", "[data-action=password]", async () => {
    if (await passwordDialog(api, "student")) toast("Password updated.");
  });
}
