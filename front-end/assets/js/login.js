// Unified sign-in / registration page for every account type: login.html?role=teacher|student|center|assistant|parent
import { api } from "./core/api.js";
import { GRADES, LANGUAGES, ROLES, SUBJECTS } from "./core/config.js";
import { clearSession, getAccessToken, getRole, isDemo, saveSession } from "./core/session.js";
import { $, $$, html, mount, qrDataUrl } from "./core/ui.js";

const params = new URLSearchParams(window.location.search);
const role = ROLES[params.get("role")] ? params.get("role") : "teacher";

if (getAccessToken() && getRole() === role && !params.has("switch")) {
  window.location.replace("app.html");
} else if (isDemo()) {
  clearSession(); // never send real sign-in/registration requests to the demo backend
}

const option = (value, label) => html`<option value="${value}">${label}</option>`;
const field = (name, label, attrs = "") =>
  html`<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" ${html([attrs])}>`;

const CONFIG = {
  teacher: {
    eyebrow: "TEACHER PORTAL",
    title: "Good teaching<br>starts here.",
    text: "Create your teaching space, invite assistants, link your learning centers and manage every student in one place.",
    identifier: "Email, phone, or username",
    panels: ["register", "verify", "login"],
    register: html`<form id="register-form">
        <div class="field-row">
          <div>${field("firstName", "First name", 'autocomplete="given-name"')}</div>
          <div>${field("lastName", "Last name", 'autocomplete="family-name"')}</div>
        </div>
        ${field("userName", "Username", 'autocomplete="username" required minlength="3"')}
        ${field("email", "Email", 'type="email" autocomplete="email" required')}
        ${field("phone", "Phone number", 'type="tel" autocomplete="tel" required')}
        ${field("companyName", "Brand or academy name (optional)", 'autocomplete="organization"')}
        <label for="f-subject">Subjects you teach</label>
        <select id="f-subject" name="subject" multiple required>${SUBJECTS.map((subject) => option(subject, subject))}</select>
        <label for="f-teachingLanguage">Teaching language</label>
        <select id="f-teachingLanguage" name="teachingLanguage" required><option value="" disabled selected>Select a language</option>${LANGUAGES.map((language) => option(language, language))}</select>
        ${field("password", "Password", 'type="password" autocomplete="new-password" minlength="8" required')}
        ${field("confirmPassword", "Confirm password", 'type="password" autocomplete="new-password" minlength="8" required')}
        <button class="submit-button" type="submit">Create account <span aria-hidden="true">&#8594;</span></button>
      </form>`,
  },
  student: {
    eyebrow: "STUDENT PORTAL",
    title: "Your next step<br>starts here.",
    text: "One account for all your teachers. Follow your sessions, lessons, homework, exams and wallet.",
    identifier: "Student code or phone number",
    panels: ["register", "login"],
    register: html`<form id="register-form">
        <div class="field-row">
          <div>${field("firstName", "First name", 'autocomplete="given-name" required')}</div>
          <div>${field("lastName", "Last name", 'autocomplete="family-name" required')}</div>
        </div>
        ${field("phone", "Phone number", 'type="tel" autocomplete="tel" required')}
        ${field("parentPhone", "Parent or guardian phone", 'type="tel" required')}
        <label for="f-grade">Grade</label>
        <select id="f-grade" name="grade" required><option value="" disabled selected>Select your grade</option>${GRADES.map((grade, index) => option(index, grade))}</select>
        ${field("schoolName", "School name", 'autocomplete="organization" required')}
        <label for="f-learningLanguage">Learning language</label>
        <select id="f-learningLanguage" name="learningLanguage" required><option value="" disabled selected>Select a language</option>${LANGUAGES.map((language, index) => option(index, language))}</select>
        <label for="f-gender">Gender</label>
        <select id="f-gender" name="gender"><option value="male">Male</option><option value="female">Female</option></select>
        ${field("password", "Password", 'type="password" autocomplete="new-password" minlength="8" required')}
        ${field("confirmPassword", "Confirm password", 'type="password" autocomplete="new-password" minlength="8" required')}
        <button class="submit-button" type="submit">Create account <span aria-hidden="true">&#8594;</span></button>
      </form>
      <section id="student-credentials" class="student-credentials" aria-live="polite" hidden>
        <h3>Your student code</h3>
        <p id="student-id-value" class="student-id-value"></p>
        <p>Use this code to sign in and show the QR code at the door for attendance.</p>
        <img id="student-id-qr" class="student-id-qr" alt="QR code for your student code">
        <button class="secondary-button" type="button" data-panel="login-panel">Continue to sign in</button>
      </section>`,
  },
  center: {
    eyebrow: "LEARNING CENTER PORTAL",
    title: "Bring your<br>community together.",
    text: "Register your center, accept teachers who teach at your place and follow every session and closing.",
    identifier: "Center name or phone number",
    panels: ["register", "login"],
    register: html`<form id="register-form">
        ${field("name", "Center name", 'autocomplete="organization" required')}
        ${field("phone", "Phone number", 'type="tel" autocomplete="tel" required')}
        ${field("localphone", "Landline (optional)", 'type="tel"')}
        ${field("textlocation", "Address (optional)", 'autocomplete="street-address"')}
        ${field("Maplocation", "Map link (optional)", 'type="url" placeholder="https://maps.google.com/..."')}
        ${field("password", "Password", 'type="password" autocomplete="new-password" minlength="8" required')}
        ${field("confirmPassword", "Confirm password", 'type="password" autocomplete="new-password" minlength="8" required')}
        <button class="submit-button" type="submit">Create account <span aria-hidden="true">&#8594;</span></button>
      </form>`,
  },
  assistant: {
    eyebrow: "ASSISTANT PORTAL",
    title: "Help your teacher<br>run the class.",
    text: "Assistant accounts are created by the teacher. Sign in with the details your teacher gave you.",
    identifier: "Email, phone, or username",
    panels: ["login"],
  },
  parent: {
    eyebrow: "PARENT PORTAL",
    title: "Stay close to<br>your child's progress.",
    text: "Follow attendance, homework, exams and payments for each of your children, with every teacher.",
    identifier: "Phone number",
    panels: ["register", "login"],
    register: html`<form id="register-form">
        ${field("name", "Your name", 'autocomplete="name" required')}
        ${field("phone", "Phone number (the one your child registered as parent phone)", 'type="tel" autocomplete="tel" required')}
        ${field("childCode", "Your child's student code", 'placeholder="STU-000123" required')}
        ${field("password", "Password", 'type="password" autocomplete="new-password" minlength="8" required')}
        ${field("confirmPassword", "Confirm password", 'type="password" autocomplete="new-password" minlength="8" required')}
        <button class="submit-button" type="submit">Create account <span aria-hidden="true">&#8594;</span></button>
      </form>`,
  },
};

const config = CONFIG[role];
const message = $("#form-message");
const PANEL_LABELS = { register: "Register", verify: "Verify email", login: "Sign in", forgot: "Reset password" };

function showMessage(text, state = "success") {
  message.textContent = text;
  message.dataset.state = state;
  message.hidden = false;
}

function showPanel(panelId) {
  for (const panel of $$(".form-panel")) panel.hidden = panel.id !== panelId;
  for (const tab of $$("#auth-tabs [data-panel]")) {
    const selected = tab.dataset.panel === panelId;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
}

function render() {
  document.title = `${ROLES[role].label} access | Learning Center`;
  $("#auth-eyebrow").textContent = config.eyebrow;
  mount($("#auth-title"), html([config.title]));
  $("#auth-text").textContent = config.text;
  mount(
    $("#role-switch"),
    html`${Object.entries(ROLES).map(
      ([key, info]) => html`<a href="login.html?role=${key}" ${key === role ? html`aria-current="page"` : ""}>${info.label}</a>`,
    )}`,
  );
  const tabs = config.panels;
  mount(
    $("#auth-tabs"),
    html`${tabs.map(
      (panel) => html`<button class="tab-button" type="button" role="tab" data-panel="${panel}-panel">${PANEL_LABELS[panel]}</button>`,
    )}`,
  );
  $("#auth-tabs").hidden = tabs.length < 2;

  mount(
    $("#auth-panels"),
    html`
      ${tabs.includes("register") ? html`<section id="register-panel" class="form-panel" role="tabpanel"><h2>Create ${ROLES[role].label.toLowerCase()} account</h2>${config.register}</section>` : ""}
      ${tabs.includes("verify") ? html`<section id="verify-panel" class="form-panel" role="tabpanel" hidden>
          <h2>Verify your email</h2>
          <p class="panel-copy">Enter the six-digit code we emailed you after registration.</p>
          <form id="verify-form">
            ${field("identifier", "Email, phone, or username", 'autocomplete="username" required')}
            ${field("otp", "Verification code", 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required')}
            <button class="submit-button" type="submit">Verify account <span aria-hidden="true">&#8594;</span></button>
          </form>
          <p class="panel-copy" style="margin-top:14px">Code expired? <button class="link-button" type="button" id="resend-otp">Send a new code</button></p>
        </section>` : ""}
      <section id="login-panel" class="form-panel" role="tabpanel" hidden>
        <h2>Welcome back</h2>
        ${role === "assistant" ? html`<p class="panel-note">Don't have an account? Ask your teacher to add you from <strong>Team → Assistants</strong>.</p>` : ""}
        <form id="login-form">
          ${field("identifier", config.identifier, 'autocomplete="username" required')}
          ${field("password", "Password", 'type="password" autocomplete="current-password" required')}
          <div class="remember-row">
            <label><input type="checkbox" name="remember"> Keep me signed in</label>
            <button class="link-button" type="button" data-panel="forgot-panel">Forgot password?</button>
          </div>
          <button class="submit-button" type="submit">Sign in <span aria-hidden="true">&#8594;</span></button>
        </form>
      </section>
      <section id="forgot-panel" class="form-panel" role="tabpanel" hidden>
        <h2>Reset your password</h2>
        <p class="panel-copy">We'll send a reset code to the email or phone on your account.</p>
        <form id="forgot-form">
          ${field("identifier", config.identifier, 'autocomplete="username" required')}
          <button class="submit-button" type="submit">Send reset code <span aria-hidden="true">&#8594;</span></button>
        </form>
        <form id="reset-form" hidden>
          ${field("otp", "Reset code", 'inputmode="numeric" maxlength="6" required')}
          ${field("password", "New password", 'type="password" autocomplete="new-password" minlength="8" required')}
          <button class="submit-button" type="submit">Save new password <span aria-hidden="true">&#8594;</span></button>
        </form>
        <p class="panel-copy" style="margin-top:14px"><button class="link-button" type="button" data-panel="login-panel">Back to sign in</button></p>
      </section>`,
  );
  showPanel(tabs.includes("register") && params.get("panel") !== "login" ? "register-panel" : "login-panel");
}

async function submitting(form, action) {
  const button = form.querySelector("button[type='submit']");
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = "Please wait...";
  try {
    await action(new FormData(form));
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

function bind() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-panel]");
    if (!target) return;
    message.hidden = true;
    showPanel(target.dataset.panel);
  });

  $("#register-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    submitting(form, async (fields) => {
      if (fields.get("password") !== fields.get("confirmPassword")) throw new Error("The passwords do not match.");
      const body = {};
      for (const [key, value] of fields.entries()) {
        if (key === "confirmPassword" || key === "subject") continue;
        const text = String(value).trim();
        if (text) body[key] = key === "password" ? value : text;
      }
      if (role === "teacher") body.subject = fields.getAll("subject");
      const result = await api.auth.signup(role, body);

      if (role === "teacher") {
        $("#verify-form [name=identifier]").value = body.email;
        showPanel("verify-panel");
        showMessage(`Account created. Enter the verification code sent to ${body.email}.`);
        return;
      }
      if (role === "student" && result?.userID) {
        form.hidden = true;
        $("#student-credentials").hidden = false;
        $("#student-id-value").textContent = result.userID;
        $("#student-id-qr").src = result.qrCode || (await qrDataUrl(result.userID));
        $("#login-form [name=identifier]").value = result.userID;
        showMessage("Account created. Save your student code — you'll use it to sign in.");
        return;
      }
      $("#login-form [name=identifier]").value = body.phone || body.name || "";
      showPanel("login-panel");
      showMessage("Account created. You can now sign in.");
    });
  });

  $("#verify-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitting(event.currentTarget, async (fields) => {
      await api.auth.verify({ identifier: String(fields.get("identifier")).trim(), otp: String(fields.get("otp")).trim() });
      $("#login-form [name=identifier]").value = String(fields.get("identifier")).trim();
      showPanel("login-panel");
      showMessage("Email verified. You can now sign in.");
    });
  });

  $("#resend-otp")?.addEventListener("click", async () => {
    const identifier = $("#verify-form [name=identifier]").value.trim();
    if (!identifier) {
      showMessage("Enter your email, phone or username first.", "error");
      return;
    }
    try {
      await api.auth.resendOtp({ identifier });
      showMessage("A new code is on its way.");
    } catch (error) {
      showMessage(error.message, "error");
    }
  });

  $("#login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitting(event.currentTarget, async (fields) => {
      const result = await api.auth.login(role, {
        identifier: String(fields.get("identifier")).trim(),
        password: fields.get("password"),
      });
      if (!result?.accessToken) throw new Error("The server did not return an access token.");
      saveSession({ ...result, role, remember: fields.get("remember") === "on" });
      window.location.assign("app.html");
    });
  });

  let resetIdentifier = "";
  $("#forgot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitting(event.currentTarget, async (fields) => {
      resetIdentifier = String(fields.get("identifier")).trim();
      await api.auth.forgotPassword(role, { identifier: resetIdentifier });
      $("#forgot-form").hidden = true;
      $("#reset-form").hidden = false;
      showMessage("If the account exists, a reset code has been sent.");
    });
  });
  $("#reset-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitting(event.currentTarget, async (fields) => {
      await api.auth.resetPassword(role, {
        identifier: resetIdentifier,
        otp: String(fields.get("otp")).trim(),
        password: fields.get("password"),
      });
      $("#reset-form").hidden = true;
      $("#forgot-form").hidden = false;
      $("#login-form [name=identifier]").value = resetIdentifier;
      showPanel("login-panel");
      showMessage("Password updated. Sign in with your new password.");
    });
  });

  $("#demo-login").addEventListener("click", async () => {
    const mock = await import("./mock/server.js");
    const session = mock.demoLogin(role);
    saveSession({ ...session, role, demo: true });
    window.location.assign("app.html");
  });
}

render();
bind();
