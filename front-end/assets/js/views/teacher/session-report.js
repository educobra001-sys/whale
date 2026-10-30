import { HOMEWORK_STATUS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, date, dateTime, downloadCSV, emptyState, formDialog, fullName, gradeLabel, html, isoDate, money,
  mount, on, plural, statTile, table, tabs, time, toast, whatsappLink, withBusy,
} from "../../core/ui.js";
import { balanceText, centerOptions, matches, studentCell } from "../shared/common.js";
import { sessionFields } from "./sessions.js";

export default async function sessionReport(ctx) {
  const { root, api, params, query, setQuery, can } = ctx;
  let tab = query.tab || "present";
  let session;
  let students = [];
  let assistants = [];
  const centers = await centerOptions();
  const filters = { q: "", homework: "", paid: "", comment: "" };

  async function load() {
    [session, students, assistants] = await Promise.all([
      api.teacher.session(params.id),
      api.teacher.students(),
      ctx.role === "teacher" ? api.teacher.assistants().catch(() => []) : Promise.resolve([]),
    ]);
  }

  const presentIds = () => new Set(session.attendance.map((row) => String(row.student._id)));
  const roster = () =>
    students.filter(
      (student) =>
        (!session.center || String(student.center) === String(session.center)) &&
        (session.grade === "" || session.grade === null || session.grade === undefined || String(student.grade) === String(session.grade)),
    );
  const absent = () => {
    const present = presentIds();
    return roster().filter((student) => !present.has(String(student._id)));
  };
  const studentById = (id) => students.find((student) => String(student._id) === String(id));

  function presentRows() {
    return session.attendance.filter((row) => {
      if (!matches(filters.q, fullName(row.student), row.student.userID, row.comment)) return false;
      if (filters.homework === "none" && row.homeworkStatus) return false;
      if (filters.homework && filters.homework !== "none" && row.homeworkStatus !== filters.homework) return false;
      if (filters.paid === "yes" && !(row.payment > 0)) return false;
      if (filters.paid === "no" && row.payment > 0) return false;
      if (filters.comment === "yes" && !row.comment) return false;
      if (filters.comment === "no" && row.comment) return false;
      return true;
    });
  }

  function presentTab() {
    const manage = can("sessions_manage");
    const homeworkSelect = (row) =>
      can(["sessions_manage", "scan_homework"])
        ? html`<select class="select-sm" data-homework="${row.student._id}" aria-label="Homework status for ${fullName(row.student)}">
            <option value="">Not checked</option>
            ${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(([key, info]) => html`<option value="${key}" ${row.homeworkStatus === key ? html`selected` : ""}>${info.label}</option>`)}
          </select>`
        : row.homeworkStatus ? badge(HOMEWORK_STATUS[row.homeworkStatus]?.label || row.homeworkStatus, HOMEWORK_STATUS[row.homeworkStatus]?.tone) : "—";
    const rows = presentRows();
    return html`<div class="toolbar">
        <label class="search">${icon("search", 16)}<input type="search" id="present-search" placeholder="Search present students…" value="${filters.q}" aria-label="Search present students"></label>
        <select class="select-sm" data-filter="homework" aria-label="Homework"><option value="">Any homework</option><option value="none">Not checked</option>${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(([key, info]) => html`<option value="${key}" ${filters.homework === key ? html`selected` : ""}>${info.label}</option>`)}</select>
        <select class="select-sm" data-filter="paid" aria-label="Payment"><option value="">Paid or not</option><option value="yes">Paid at the door</option><option value="no">Didn't pay</option></select>
        <select class="select-sm" data-filter="comment" aria-label="Comment"><option value="">Any comment</option><option value="yes">Has comment</option><option value="no">No comment</option></select>
      </div>
      <p class="muted small mb">Showing ${rows.length} of ${session.attendance.length}</p>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (row) => studentCell(row.student) },
          { label: "Arrived", render: (row) => html`<span class="nowrap">${time(row.markedAt)}</span>` },
          { label: "Paid", className: "num", render: (row) => (row.payment ? money(row.payment) : html`<span class="muted">—</span>`) },
          { label: "Homework", render: homeworkSelect },
          { label: "Comment", render: (row) => row.comment || html`<span class="muted">—</span>` },
          { label: "Recorded by", render: (row) => html`<span class="small">${row.markedBy?.name || "—"}</span>` },
          {
            label: "",
            className: "actions",
            render: (row) => (manage ? html`<button class="btn btn-sm btn-ghost" data-action="edit-row" data-id="${row.student._id}">Edit</button><button class="btn btn-sm btn-ghost" data-action="remove-row" data-id="${row.student._id}">Remove</button>` : ""),
          },
        ],
        rows,
        { empty: session.attendance.length ? "No present students match these filters." : "Nobody has been checked in yet." },
      )}</div>`;
  }

  function absentTab() {
    const rows = absent();
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">Students of ${session.centerName || "your class"}${session.grade !== "" && session.grade != null ? ` (${gradeLabel(session.grade)})` : ""} who didn't attend.</p>
        ${session.active && can("scan_attendance") ? html`<span class="badge badge-success">Session is live — you can mark late arrivals</span>` : ""}</div>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (student) => studentCell(student) },
          { label: "Phone", render: (student) => (student.phone ? html`<a href="${whatsappLink(student.phone)}" target="_blank" rel="noopener">${student.phone}</a>` : "—") },
          { label: "Parent", render: (student) => (student.parentPhone ? html`<a href="${whatsappLink(student.parentPhone, `Hello, ${fullName(student)} missed today's session (${session.sequence}).`)}" target="_blank" rel="noopener">${student.parentPhone}</a>` : "—") },
          { label: "Balance", className: "num", render: (student) => balanceText(student.balance) },
          { label: "", className: "actions", render: (student) => (session.active && can("scan_attendance") ? html`<button class="btn btn-sm btn-secondary" data-action="mark" data-id="${student.userID || student._id}">Mark present</button>` : "") },
        ],
        rows,
        { empty: "Everyone attended. 🎉" },
      )}</div>`;
  }

  function staffTab() {
    const manage = can("sessions_manage") && ctx.role === "teacher";
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">Assistants' check-in and check-out for this session (used for hourly / per-session salaries).</p>
        ${manage && assistants.length ? html`<button class="btn btn-sm btn-primary" data-action="staff-add">${icon("plus", 15)} Check in assistant</button>` : ""}</div>
      <div class="card card-flush">${table(
        [
          { label: "Assistant", render: (row) => html`<strong>${fullName(row.assistant)}</strong>` },
          { label: "Check-in", render: (row) => dateTime(row.checkIn) },
          { label: "Check-out", render: (row) => (row.checkOut ? dateTime(row.checkOut) : badge("Still here", "success")) },
          { label: "Worked", className: "num", render: (row) => (row.minutes ? `${Math.floor(row.minutes / 60)}h ${row.minutes % 60}m` : "—") },
          { label: "Notes", render: (row) => row.notes || "—" },
          {
            label: "",
            className: "actions",
            render: (row) => (manage ? html`${row.checkOut ? "" : html`<button class="btn btn-sm btn-secondary" data-action="staff-out" data-id="${row._id}">Check out</button>`}<button class="btn btn-sm btn-ghost" data-action="staff-remove" data-id="${row._id}">Remove</button>` : ""),
          },
        ],
        session.staff || [],
        { empty: "No assistants checked in for this session." },
      )}</div>`;
  }

  function closingTab() {
    const closing = session.closing;
    const collected = session.attendance.reduce((total, row) => total + (Number(row.payment) || 0), 0);
    const charged = session.attendance.reduce((total, row) => total + (Number(row.charged) || 0), 0);
    return html`<div class="grid grid-2">
      <section class="card card-accent">
        <div class="card-head"><div><p class="eyebrow">Center closing</p><h3>What you owe the center</h3></div>
          ${can("sessions_manage") ? html`<button class="btn btn-sm btn-primary" data-action="closing">${closing ? "Edit" : "Calculate"}</button>` : ""}</div>
        ${closing
          ? html`<dl class="kv">
              <dt>Regular students</dt><dd>${closing.normalCount} × ${money(closing.normalCost)}</dd>
              <dt>Reduced price</dt><dd>${closing.reducedCount} × ${money(closing.reducedCost)}</dd>
              <dt>Total for the center</dt><dd class="strong">${money(closing.total)}</dd>
              ${closing.notes ? html`<dt>Notes</dt><dd>${closing.notes}</dd>` : ""}
            </dl>`
          : emptyState("Not calculated yet", "Enter the center's cost per student to calculate the closing. The center sees this total on their side.")}
      </section>
      <section class="card">
        <div class="card-head"><div><p class="eyebrow">Money</p><h3>Session cash</h3></div></div>
        <dl class="kv">
          <dt>Cash collected at the door</dt><dd class="strong">${money(collected)}</dd>
          <dt>Charged to balances</dt><dd>${money(charged)}</dd>
          <dt>Center cost</dt><dd>${money(closing?.total || 0)}</dd>
          <dt>Cash after center</dt><dd class="strong">${money(collected - (closing?.total || 0))}</dd>
        </dl>
        <p class="muted small mt">Cash collected only counts money paid while checking in, not amounts taken from an existing balance.</p>
      </section>
    </div>`;
  }

  function render() {
    const absentCount = absent().length;
    const checked = session.attendance.filter((row) => row.homeworkStatus);
    const done = checked.filter((row) => row.homeworkStatus === "complete").length;
    mount(
      root,
      html`<a class="back-link" href="#/sessions">${icon("arrowLeft", 15)} All sessions</a>
      <header class="page-header">
        <div>
          <p class="eyebrow">Week ${session.week} · Session ${session.number}</p>
          <h1>${session.sequence}</h1>
          <p class="page-text">${date(session.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${session.centerName || "Online"}${session.grade !== "" && session.grade != null ? ` · ${gradeLabel(session.grade)}` : ""}
            ${session.status === "cancelled" ? badge("Cancelled", "muted") : session.active ? badge("Live", "success") : badge("Closed", "accent")}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-action="export">${icon("download")} Export</button>
          ${can("sessions_manage") ? html`<button class="btn btn-secondary" data-action="edit">${icon("pencil")} Edit</button>` : ""}
          ${can("sessions_manage") && session.status !== "cancelled" ? html`<button class="btn ${session.active ? "btn-secondary" : "btn-primary"}" data-action="toggle">${session.active ? "End session" : "Start session"}</button>` : ""}
          ${session.active ? html`<a class="btn btn-primary" href="#/scan">${icon("scan")} Scan</a>` : ""}
        </div>
      </header>
      <section class="stats">
        ${statTile("Present", session.attendance.length, { tone: "success" })}
        ${statTile("Absent", absentCount, { tone: absentCount ? "danger" : "" })}
        ${statTile("Attendance", `${session.attendance.length + absentCount ? Math.round((session.attendance.length / (session.attendance.length + absentCount)) * 100) : 0}%`)}
        ${statTile("Homework complete", checked.length ? `${Math.round((done / checked.length) * 100)}%` : "—", { hint: `${checked.length} checked` })}
        ${statTile("Cash collected", money(session.attendance.reduce((total, row) => total + (Number(row.payment) || 0), 0)))}
      </section>
      ${tabs(
        [
          { key: "present", label: "Present", count: session.attendance.length },
          { key: "absent", label: "Absent", count: absentCount },
          { key: "staff", label: "Assistants", count: (session.staff || []).length },
          { key: "closing", label: "Closing & money" },
        ],
        tab,
      )}
      <div id="tab-body">${{ present: presentTab, absent: absentTab, staff: staffTab, closing: closingTab }[tab]()}</div>`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab: tab === "present" ? "" : tab });
    render();
  });
  on(root, "input", "#present-search", (event, input) => {
    filters.q = input.value;
    const position = input.selectionStart;
    mount($("#tab-body", root), presentTab());
    const next = $("#present-search", root);
    next.focus();
    next.setSelectionRange(position, position);
  });
  on(root, "change", "[data-filter]", (event, select) => {
    filters[select.dataset.filter] = select.value;
    mount($("#tab-body", root), presentTab());
  });
  on(root, "change", "[data-homework]", async (event, select) => {
    select.disabled = true;
    try {
      await api.teacher.updateAttendance(session._id, select.dataset.homework, { homeworkStatus: select.value || null });
      const row = session.attendance.find((item) => String(item.student._id) === select.dataset.homework);
      if (row) row.homeworkStatus = select.value || null;
      toast("Homework status saved.");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      select.disabled = false;
    }
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "toggle") {
      if (!(await withBusy(button, () => api.teacher.setSessionActive(session._id, !session.active)))) return;
      await reload(session.active ? "Session ended." : "Session is live.");
    }
    if (action === "edit") {
      const saved = await formDialog({ title: "Edit session", fields: sessionFields(centers, session), onSubmit: (body) => api.teacher.updateSession(session._id, body) });
      if (saved) await reload("Session updated.");
    }
    if (action === "export") {
      const label = `week${session.week}-session${session.number}`;
      downloadCSV(`${label}-present`, [
        { label: "Code", value: (row) => row.student.userID },
        { label: "Name", value: (row) => fullName(row.student) },
        { label: "Phone", value: (row) => row.student.phone || studentById(row.student._id)?.phone },
        { label: "Parent phone", value: (row) => row.student.parentPhone || studentById(row.student._id)?.parentPhone },
        { label: "Arrived", value: (row) => dateTime(row.markedAt) },
        { label: "Paid", value: (row) => row.payment || 0 },
        { label: "Homework", value: (row) => HOMEWORK_STATUS[row.homeworkStatus]?.label || "" },
        { label: "Comment", value: (row) => row.comment },
        { label: "Recorded by", value: (row) => row.markedBy?.name },
      ], session.attendance);
      downloadCSV(`${label}-absent`, [
        { label: "Code", value: (student) => student.userID },
        { label: "Name", value: (student) => fullName(student) },
        { label: "Phone", value: (student) => student.phone },
        { label: "Parent phone", value: (student) => student.parentPhone },
        { label: "Balance", value: (student) => student.balance },
      ], absent());
      toast("Downloaded present and absent lists.");
    }
    if (action === "mark") {
      const marked = await withBusy(button, async () => {
        try {
          return await api.teacher.markAttendance(session._id, { identifier: id });
        } catch (error) {
          const forceable = ["INSUFFICIENT_BALANCE", "BLOCKED"].includes(error.details?.code);
          if (forceable && (await confirmDialog(`${error.message} Check the student in anyway?`, { confirmLabel: "Check in anyway" }))) {
            return api.teacher.markAttendance(session._id, { identifier: id, force: true });
          }
          throw error;
        }
      });
      if (!marked) return;
      await reload("Marked present.");
    }
    if (action === "edit-row") {
      const row = session.attendance.find((item) => String(item.student._id) === id);
      const saved = await formDialog({
        title: `Edit · ${fullName(row.student)}`,
        fields: [
          { name: "payment", label: "Paid at the door", type: "number", min: 0, value: row.payment || 0, hint: "Changing this updates the student's balance." },
          { name: "comment", label: "Comment", type: "textarea", value: row.comment, full: true },
        ],
        onSubmit: (body) => api.teacher.updateAttendance(session._id, id, body),
      });
      if (saved) await reload("Attendance updated.");
    }
    if (action === "remove-row") {
      if (!(await confirmDialog("Remove this attendance record? The session price is refunded to the student's balance.", { confirmLabel: "Remove", danger: true }))) return;
      if (!(await withBusy(button, () => api.teacher.removeAttendance(session._id, id)))) return;
      await reload("Attendance removed and refunded.");
    }
    if (action === "staff-add") {
      const saved = await formDialog({
        title: "Check in an assistant",
        fields: [
          { name: "assistant", label: "Assistant", type: "select", required: true, options: assistants.map((assistant) => ({ value: assistant._id, label: fullName(assistant) })) },
          { name: "checkIn", label: "Check-in time", type: "datetime-local", value: `${isoDate()}T${new Date().toTimeString().slice(0, 5)}` },
          { name: "notes", label: "Notes", full: true },
        ],
        onSubmit: (body) => api.teacher.staffCheckIn(session._id, body),
      });
      if (saved) await reload("Assistant checked in.");
    }
    if (action === "staff-out") {
      if (!(await withBusy(button, () => api.teacher.staffUpdate(session._id, id, { checkOut: new Date().toISOString() })))) return;
      await reload("Checked out.");
    }
    if (action === "staff-remove") {
      if (!(await confirmDialog("Remove this check-in record?", { danger: true, confirmLabel: "Remove" }))) return;
      if (!(await withBusy(button, () => api.teacher.staffRemove(session._id, id)))) return;
      await reload("Record removed.");
    }
    if (action === "closing") {
      const closing = session.closing || {};
      const saved = await formDialog({
        title: "Center closing",
        intro: `${plural(session.attendance.length, "student")} attended. Enter what the center charges per student.`,
        fields: [
          { name: "normalCost", label: "Cost per regular student", type: "number", min: 0, required: true, value: closing.normalCost ?? "" },
          { name: "reducedCost", label: "Cost per reduced-price student", type: "number", min: 0, value: closing.reducedCost ?? 0 },
          { name: "reducedCount", label: "Number of reduced-price students", type: "number", min: 0, max: session.attendance.length, value: closing.reducedCount ?? 0 },
          { name: "notes", label: "Notes", full: true, value: closing.notes },
        ],
        submitLabel: "Save closing",
        onSubmit: (body) => api.teacher.saveClosing(session._id, body),
      });
      if (saved) await reload("Closing saved.");
    }
  });

  await load();
  render();
}
