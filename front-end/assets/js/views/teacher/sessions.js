import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, date, formDialog, gradeLabel, html, isoDate, money, mount, on, pageHeader, plural, table, toast, withBusy,
} from "../../core/ui.js";
import { centerOptions, gradeOptions, matches } from "../shared/common.js";

export function sessionFields(centers, values = {}) {
  return [
    { name: "sequence", label: "Topic", required: true, full: true, value: values.sequence, placeholder: "e.g. Derivatives: chain rule", maxlength: 160 },
    { name: "week", label: "Week number", type: "number", min: 1, max: 60, required: true, value: values.week },
    { name: "number", label: "Session number", type: "number", min: 1, max: 999, required: true, value: values.number },
    { name: "date", label: "Date", type: "date", value: values.date ? isoDate(values.date) : isoDate() },
    { name: "center", label: "Center", type: "select", options: centers, value: values.center, emptyLabel: "Online / no center" },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade, emptyLabel: "All grades" },
    { name: "price", label: "Session price", type: "number", min: 0, value: values.price, hint: "Leave empty to charge each student their own price." },
  ];
}

export default async function sessions(ctx) {
  const { root, api, query, can, navigate } = ctx;
  const centers = await centerOptions();
  let list = [];
  const filters = { q: "", status: "", center: "" };

  async function load() {
    list = (await api.teacher.sessions()) || [];
  }

  function suggestion() {
    const latest = list.reduce((best, session) => (session.week > best.week || (session.week === best.week && session.number > best.number) ? session : best), { week: 0, number: 0 });
    return { week: latest.week || 1, number: (latest.number || 0) + 1 };
  }

  const filtered = () =>
    list.filter(
      (session) =>
        matches(filters.q, session.sequence, `week ${session.week}`, `#${session.number}`, session.centerName) &&
        (!filters.status || (filters.status === "active" ? session.active : session.status === filters.status)) &&
        (!filters.center || String(session.center) === filters.center),
    );

  function results() {
    const rows = filtered();
    const manage = can("sessions_manage");
    return html`<p class="muted small mb">${plural(rows.length, "session")}</p>
      <div class="card card-flush">${table(
        [
          {
            label: "Session",
            render: (session) => html`<a class="strong" href="#/sessions/${session._id}">Week ${session.week} · #${session.number}</a><div class="muted small">${session.sequence}</div>`,
          },
          { label: "Date", render: (session) => html`<span class="nowrap">${date(session.date)}</span>` },
          { label: "Center", render: (session) => session.centerName || html`<span class="muted">Online</span>` },
          { label: "Grade", render: (session) => (session.grade !== "" && session.grade !== null && session.grade !== undefined ? gradeLabel(session.grade) : "All") },
          { label: "Present", className: "num", render: (session) => session.presentCount ?? session.attendance?.length ?? 0 },
          { label: "Collected", className: "num", render: (session) => money(session.collected || 0) },
          {
            label: "Status",
            render: (session) => (session.status === "cancelled" ? badge("Cancelled", "muted") : session.active ? badge("Live", "success") : badge("Closed", "accent")),
          },
          {
            label: "",
            className: "actions",
            render: (session) => html`${manage && session.status !== "cancelled"
              ? html`<button class="btn btn-sm ${session.active ? "btn-secondary" : "btn-primary"}" data-action="toggle" data-id="${session._id}">${session.active ? "End" : "Start"}</button>`
              : ""}
              ${manage ? html`<button class="btn btn-sm btn-ghost" data-action="more" data-id="${session._id}" aria-label="More actions">⋯</button>` : ""}`,
          },
        ],
        rows,
        { empty: list.length ? "No sessions match." : "No sessions yet. Create your first one or start it from your weekly schedule." },
      )}</div>`;
  }

  function render() {
    const active = list.find((session) => session.active);
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Classroom",
        title: "Sessions",
        text: "Plan sessions, start one to scan attendance, and open the report for payments, homework and closing.",
        actions: can("sessions_manage")
          ? html`<a class="btn btn-secondary" href="#/schedule">${icon("clock")} From schedule</a><button class="btn btn-primary" data-action="create">${icon("plus")} New session</button>`
          : "",
      })}
      ${active
        ? html`<div class="notice notice-success mb row-between"><span><strong>Live:</strong> Week ${active.week} · #${active.number} — ${active.sequence} · ${active.presentCount ?? active.attendance?.length ?? 0} present</span>
            <span class="row"><a class="btn btn-sm btn-success" href="#/scan">Scan</a><a class="btn btn-sm btn-secondary" href="#/sessions/${active._id}">Report</a></span></div>`
        : ""}
      <div class="toolbar">
        <label class="search">${icon("search", 16)}<input type="search" id="session-search" placeholder="Search topic, week, center…" aria-label="Search sessions"></label>
        <select class="select-sm" data-filter="status" aria-label="Status"><option value="">All sessions</option><option value="active">Live</option><option value="normal">Held</option><option value="cancelled">Cancelled</option></select>
        <select class="select-sm" data-filter="center" aria-label="Center"><option value="">All centers</option>${centers.map((center) => html`<option value="${center.value}">${center.label}</option>`)}</select>
      </div>
      <div id="results">${results()}</div>`,
    );
  }

  const refresh = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  async function create() {
    const values = suggestion();
    const session = await formDialog({
      title: "New session",
      eyebrow: "Suggested numbers follow your latest session",
      fields: [...sessionFields(centers, values), { name: "activate", label: "Start it now (go live for scanning)", type: "checkbox", checked: true, full: true }],
      submitLabel: "Create session",
      onSubmit: async ({ activate, ...body }) => {
        const created = await api.teacher.createSession(body);
        if (activate) await api.teacher.setSessionActive(created._id, true);
        return created;
      },
    });
    if (session) await refresh("Session created.");
  }

  on(root, "input", "#session-search", (event, input) => {
    filters.q = input.value;
    mount($("#results", root), results());
  });
  on(root, "change", "[data-filter]", (event, select) => {
    filters[select.dataset.filter] = select.value;
    mount($("#results", root), results());
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const session = list.find((item) => item._id === button.dataset.id);
    if (action === "create") return create();
    if (action === "toggle") {
      const starting = !session.active;
      if (starting && list.some((item) => item.active) && !(await confirmDialog("Only one session can be live at a time. The current live session will be ended.", { confirmLabel: "Start this one" }))) return;
      if (!(await withBusy(button, () => api.teacher.setSessionActive(session._id, starting)))) return;
      await refresh(starting ? "Session is live — you can scan students now." : "Session ended.");
      return;
    }
    if (action === "more") {
      const choice = await formDialog({
        title: `Week ${session.week} · #${session.number}`,
        eyebrow: session.sequence,
        size: "sm",
        fields: [
          {
            name: "choice",
            label: "What do you want to do?",
            type: "select",
            required: true,
            full: true,
            options: [
              { value: "edit", label: "Edit details" },
              session.status === "cancelled" ? { value: "restore", label: "Restore session" } : { value: "cancel", label: "Cancel session (refund students)" },
              { value: "delete", label: "Delete session" },
            ],
          },
        ],
        submitLabel: "Continue",
      });
      if (!choice) return;
      if (choice.choice === "edit") {
        const saved = await formDialog({
          title: "Edit session",
          fields: sessionFields(centers, session),
          onSubmit: (body) => api.teacher.updateSession(session._id, body),
        });
        if (saved) await refresh("Session updated.");
      }
      if (choice.choice === "cancel") {
        if (!(await confirmDialog(`Cancel this session? ${session.presentCount ? `The ${plural(session.presentCount, "student")} charged will be refunded.` : ""}`, { confirmLabel: "Cancel session", danger: true }))) return;
        await api.teacher.updateSession(session._id, { status: "cancelled" }).then(() => refresh("Session cancelled.")).catch((error) => toast(error.message, "error"));
      }
      if (choice.choice === "restore") {
        await api.teacher.updateSession(session._id, { status: "normal" }).then(() => refresh("Session restored.")).catch((error) => toast(error.message, "error"));
      }
      if (choice.choice === "delete") {
        if (!(await confirmDialog("Delete this session permanently?", { confirmLabel: "Delete", danger: true }))) return;
        await api.teacher.deleteSession(session._id).then(() => refresh("Session deleted.")).catch((error) => toast(error.message, "error"));
      }
    }
  });
  on(root, "click", "tbody tr", (event, row) => {
    if (event.target.closest("a,button")) return;
    const link = row.querySelector("a[href^='#/sessions/']");
    if (link) navigate(link.getAttribute("href"));
  });

  await load();
  render();
  if (query.new && can("sessions_manage")) {
    ctx.setQuery({ new: "" });
    create();
  }
}
