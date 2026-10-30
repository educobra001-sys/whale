import { icon } from "../../core/icons.js";
import { $, badge, confirmDialog, debounce, emptyState, html, mount, on, pageHeader, relative, toast, withBusy } from "../../core/ui.js";
import { teacherCenters } from "../shared/common.js";

function centerTile(center, footer) {
  return html`<article class="tile">
    <div class="person"><span class="avatar avatar-md">${icon("building", 18)}</span><div><strong>${center.name}</strong><span>${center.textlocation || "No address"}</span></div></div>
    <p>${center.phone ? html`📞 <a href="tel:${center.phone}">${center.phone}</a>` : ""}${center.localphone ? html` · ${center.localphone}` : ""}
      ${center.Maplocation ? html` · <a href="${center.Maplocation}" target="_blank" rel="noopener">Map ↗</a>` : ""}</p>
    <div class="tile-foot">${footer}</div>
  </article>`;
}

export default async function centers(ctx) {
  const { root, api } = ctx;
  let links = [];
  let results = [];

  async function load() {
    links = (await api.teacher.centers()) || [];
  }

  function searchResults() {
    if (!results.length) return html`<p class="muted small">Type to search for a center by name or area.</p>`;
    return html`<div class="tile-grid">${results.map((center) => {
      const link = links.find((item) => String(item.center._id) === String(center._id));
      const footer = link
        ? badge(link.status === "active" ? "Linked" : "Request pending", link.status === "active" ? "success" : "warn")
        : html`<button class="btn btn-sm btn-primary" data-action="request" data-id="${center._id}">Request to join</button>`;
      return centerTile(center, footer);
    })}</div>`;
  }

  function render() {
    const active = links.filter((link) => link.status === "active");
    const invitations = links.filter((link) => link.status === "pending" && link.requestedBy === "center");
    const sent = links.filter((link) => link.status === "pending" && link.requestedBy === "teacher");
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Team",
        title: "Learning centers",
        text: "Link the centers where you teach. Linked centers see your groups in their schedule and the closing of sessions held at their place — they never see your students' data.",
      })}
      ${invitations.length
        ? html`<section class="card card-accent mb"><div class="card-head"><div><p class="eyebrow">Invitations</p><h3>Centers that invited you</h3></div></div>
            <div class="tile-grid">${invitations.map((link) =>
              centerTile(link.center, html`<span class="muted small">${relative(link.createdAt)}</span><span class="row">
                <button class="btn btn-sm btn-secondary" data-action="decline" data-id="${link.center._id}">Decline</button>
                <button class="btn btn-sm btn-primary" data-action="accept" data-id="${link.center._id}">Accept</button></span>`),
            )}</div></section>`
        : ""}
      <section class="mb"><h2 class="eyebrow" style="font-size:12px">Your centers</h2>
        ${active.length
          ? html`<div class="tile-grid">${active.map((link) => centerTile(link.center, html`${badge("Linked", "success")}<button class="btn btn-sm btn-ghost" data-action="leave" data-id="${link.center._id}">Leave</button>`))}</div>`
          : html`<div class="card">${emptyState("No linked centers", "Search below and send a request, or ask the center to invite you by your username.")}</div>`}
      </section>
      ${sent.length
        ? html`<section class="mb"><h2 class="eyebrow" style="font-size:12px">Waiting for the center</h2>
            <div class="tile-grid">${sent.map((link) => centerTile(link.center, html`${badge("Pending", "warn")}<button class="btn btn-sm btn-ghost" data-action="leave" data-id="${link.center._id}">Cancel request</button>`))}</div></section>`
        : ""}
      <section class="card"><div class="card-head"><div><p class="eyebrow">Directory</p><h3>Find a center</h3></div></div>
        <label class="search mb">${icon("search", 16)}<input type="search" id="center-search" placeholder="Center name or area…" aria-label="Search centers"></label>
        <div id="center-results">${searchResults()}</div>
      </section>`,
    );
  }

  const reload = async (message) => {
    await load();
    await teacherCenters({ fresh: true });
    render();
    if (message) toast(message);
  };

  const search = debounce(async (value) => {
    results = value.trim() ? (await api.directory.centers({ q: value.trim() }).catch(() => [])) || [] : [];
    mount($("#center-results", root), searchResults());
  }, 300);
  on(root, "input", "#center-search", (event, input) => search(input.value));

  on(root, "click", "[data-action]", async (event, button) => {
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (action === "request") {
      if (!(await withBusy(button, () => api.teacher.requestCenter(id)))) return;
      await reload("Request sent to the center.");
      mount($("#center-results", root), searchResults());
    }
    if (action === "accept" || action === "decline") {
      if (!(await withBusy(button, () => api.teacher.answerCenter(id, action === "accept" ? "active" : "rejected")))) return;
      await reload(action === "accept" ? "You're now linked to this center." : "Invitation declined.");
    }
    if (action === "leave") {
      if (!(await confirmDialog("Unlink from this center? Your groups disappear from their schedule.", { danger: true, confirmLabel: "Unlink" }))) return;
      if (!(await withBusy(button, () => api.teacher.leaveCenter(id)))) return;
      await reload("Unlinked.");
    }
  });

  await load();
  render();
}
