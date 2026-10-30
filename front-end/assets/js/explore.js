import { API_BASE, SUBJECTS } from "./core/config.js";
import { $, debounce, emptyState, fullName, html, mount, on } from "./core/ui.js";

const results = $("#results");
const state = { q: "", subject: "" };

mount($("#subject"), html`<option value="">All subjects</option>${SUBJECTS.map((subject) => html`<option value="${subject}">${subject}</option>`)}`);

async function load() {
  const params = new URLSearchParams(Object.entries(state).filter(([, value]) => value));
  const response = await fetch(`${API_BASE}/teachers/search?${params}`);
  const { data = [] } = await response.json();
  mount(results, data.length
    ? html`${data.map((teacher) => html`<article class="explore-card">
        <h3>${teacher.companyName || fullName(teacher)}</h3>
        <p class="muted">${fullName(teacher)} · ${(teacher.subject || []).join(", ")}</p>
        ${teacher.bio ? html`<p>${teacher.bio}</p>` : ""}
        <p class="muted small">${teacher.studentsCount} students${teacher.centers.length ? ` · ${teacher.centers.join(", ")}` : ""}</p>
        <a class="secondary-button" href="login.html?role=student">Join as a student</a>
      </article>`)}`
    : emptyState("No teachers found", "Try another name or subject."));
}

on(document, "input", "#search", debounce((event) => {
  state.q = event.target.value.trim();
  load();
}, 300));
on(document, "change", "#subject", (event, select) => {
  state.subject = select.value;
  load();
});
load();
