import { HOMEWORK_STATUS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import {
  $, $$, badge, date, downloadCSV, formDialog, fullName, homeworkBadge, html, mount, on, pageHeader, plural, relative, statTile, toast, whatsappLink,
} from "../../core/ui.js";
import { balanceText, matches, studentCell } from "../shared/common.js";

export default async function followUp(ctx) {
  const { root, api, query, setQuery, role, me } = ctx;
  let data;
  const filters = { session: query.session || "", show: query.show || "attention", homework: "", examBelow: "", absences: "", assigned: "", q: "", mine: role === "assistant" ? "1" : "" };

  async function load() {
    data = await api.teacher.followUp({ session: filters.session, mine: filters.mine });
    if (!filters.session && data.session) filters.session = data.session._id;
  }

  function needsAttention(row) {
    return !row.attended || ["incomplete", "no_steps", "not_done"].includes(row.homeworkStatus) || (data.exam && row.examScore !== undefined && (row.examScore === null || row.examScore < data.exam.maxScore / 2)) || row.absences >= 2;
  }

  function rows() {
    return data.rows.filter((row) => {
      if (!matches(filters.q, fullName(row.student), row.student.userID, row.student.phone)) return false;
      if (filters.show === "attention" && !needsAttention(row)) return false;
      if (filters.show === "absent" && row.attended) return false;
      if (filters.show === "present" && !row.attended) return false;
      if (filters.homework === "none" && row.homeworkStatus) return false;
      if (filters.homework && filters.homework !== "none" && row.homeworkStatus !== filters.homework) return false;
      if (filters.examBelow !== "" && !(row.examScore === null || (row.examScore ?? Infinity) < Number(filters.examBelow))) return false;
      if (filters.absences !== "" && row.absences < Number(filters.absences)) return false;
      if (filters.assigned === "none" && row.assignedTo) return false;
      if (filters.assigned && filters.assigned !== "none" && String(row.assignedTo?._id) !== filters.assigned) return false;
      return true;
    });
  }

  function resultsHtml() {
    const list = rows();
    const teacherMode = role === "teacher";
    return html`<div class="row-between mb"><p class="muted small" style="margin:0">${plural(list.length, "student")} to follow up</p>
        <div class="row">${teacherMode && data.assistants.length ? html`<button class="btn btn-sm btn-secondary" data-action="assign">${icon("users", 15)} Assign selected</button>` : ""}
          <button class="btn btn-sm btn-secondary" data-action="export">${icon("download", 15)} Call list</button></div></div>
      ${list.length
        ? html`<div class="card card-flush"><div class="table-wrap"><table class="table">
            <thead><tr>${teacherMode ? html`<th><input type="checkbox" data-select-all aria-label="Select all"></th>` : ""}<th>Student</th><th>Contact</th><th>Session</th><th>Homework</th>${data.exam ? html`<th class="num">${data.exam.name}</th>` : ""}<th class="num">Missed (last 4)</th><th>Balance</th><th>Follow-up</th><th></th></tr></thead>
            <tbody>${list.map(
              (row) => html`<tr>
                ${teacherMode ? html`<td data-label="Select"><input type="checkbox" data-select="${row.student._id}" aria-label="Select ${fullName(row.student)}"></td>` : ""}
                <td data-label="Student">${studentCell(row.student)}</td>
                <td data-label="Contact"><div class="row">${row.student.phone ? html`<a class="badge badge-success" href="${whatsappLink(row.student.phone)}" target="_blank" rel="noopener">Student</a>` : ""}${row.student.parentPhone ? html`<a class="badge badge-info" href="${whatsappLink(row.student.parentPhone, `Hello, this is about ${fullName(row.student)}.`)}" target="_blank" rel="noopener">Parent</a>` : ""}</div></td>
                <td data-label="Session">${row.attended ? badge("Present", "success") : badge("Absent", "danger")}</td>
                <td data-label="Homework">${row.attended ? homeworkBadge(row.homeworkStatus) : "—"}</td>
                ${data.exam ? html`<td class="num" data-label="Exam">${row.examScore === null || row.examScore === undefined ? badge("No score", "danger") : html`<span class="${row.examScore < data.exam.maxScore / 2 ? "text-danger strong" : ""}">${row.examScore} / ${data.exam.maxScore}</span>`}</td>` : ""}
                <td class="num" data-label="Missed">${row.absences >= 2 ? html`<span class="text-danger strong">${row.absences}</span>` : row.absences}</td>
                <td data-label="Balance">${balanceText(row.balance)}</td>
                <td data-label="Follow-up"><span class="small">${row.assignedTo?.name || html`<span class="muted">Unassigned</span>`}</span>
                  ${row.lastComment ? html`<div class="small muted" title="${row.lastComment.comment}">“${row.lastComment.comment.slice(0, 40)}${row.lastComment.comment.length > 40 ? "…" : ""}” · ${relative(row.lastComment.createdAt)}</div>` : ""}</td>
                <td class="actions"><button class="btn btn-sm btn-secondary" data-action="comment" data-id="${row.student._id}">Note</button></td>
              </tr>`,
            )}</tbody></table></div></div>`
        : html`<div class="card">${html`<div class="empty"><div class="empty-mark">✓</div><p class="empty-title">Nobody needs a call</p><p class="empty-text">Everyone matches. Change the filters to see more students.</p></div>`}</div>`}`;
  }

  function render() {
    const all = data.rows;
    const absent = all.filter((row) => !row.attended).length;
    const homeworkIssues = all.filter((row) => ["incomplete", "no_steps", "not_done"].includes(row.homeworkStatus)).length;
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Engagement",
        title: "Student follow-up",
        text: role === "assistant" ? `Students ${fullName(me.teacher)} assigned to you. Call them, then leave a note so everyone knows what happened.` : "After each session: who missed it, who didn't do the homework, who scored low. Assign students to assistants and track every call.",
      })}
      <div class="toolbar">
        <div class="field grow"><label for="fu-session">Session</label><select id="fu-session" data-filter="session">${data.sessions.map((session) => html`<option value="${session._id}" ${session._id === filters.session ? html`selected` : ""}>${session.label} · ${date(session.date)}</option>`)}</select></div>
        ${role === "assistant" ? html`<label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" data-filter="mine" ${filters.mine ? html`checked` : ""}> Only my students</label>` : ""}
      </div>
      ${data.session
        ? html`<section class="stats">
            ${statTile("Students", all.length)}
            ${statTile("Absent", absent, { tone: absent ? "danger" : "" })}
            ${statTile("Homework problems", homeworkIssues, { tone: homeworkIssues ? "danger" : "" })}
            ${statTile("Missed 2+ of last 4", all.filter((row) => row.absences >= 2).length)}
          </section>`
        : ""}
      <div class="toolbar">
        <label class="search">${icon("search", 16)}<input type="search" id="fu-search" placeholder="Find a student…" aria-label="Find a student"></label>
        <select class="select-sm" data-filter="show" aria-label="Show"><option value="attention" ${filters.show === "attention" ? html`selected` : ""}>Needs attention</option><option value="absent" ${filters.show === "absent" ? html`selected` : ""}>Absent only</option><option value="present" ${filters.show === "present" ? html`selected` : ""}>Present only</option><option value="all" ${filters.show === "all" ? html`selected` : ""}>Everyone</option></select>
        <select class="select-sm" data-filter="homework" aria-label="Homework"><option value="">Any homework</option><option value="none">Not checked</option>${Object.entries(HOMEWORK_STATUS).filter(([key]) => key !== "submitted").map(([key, info]) => html`<option value="${key}">${info.label}</option>`)}</select>
        ${data.exam ? html`<input class="select-sm" type="number" min="0" data-filter="examBelow" placeholder="Score below…" aria-label="Exam score below" style="width:130px">` : ""}
        <select class="select-sm" data-filter="absences" aria-label="Absences"><option value="">Any absences</option><option value="1">Missed 1+</option><option value="2">Missed 2+</option><option value="3">Missed 3+</option></select>
        ${role === "teacher" ? html`<select class="select-sm" data-filter="assigned" aria-label="Assigned to"><option value="">Any assistant</option><option value="none">Unassigned</option>${data.assistants.map((assistant) => html`<option value="${assistant._id}">${assistant.name}</option>`)}</select>` : ""}
      </div>
      <div id="fu-results">${resultsHtml()}</div>`,
    );
  }

  const renderResults = () => mount($("#fu-results", root), resultsHtml());

  on(root, "input", "#fu-search", (event, input) => {
    filters.q = input.value;
    renderResults();
  });
  on(root, "change", "[data-filter]", async (event, input) => {
    const key = input.dataset.filter;
    filters[key] = input.type === "checkbox" ? (input.checked ? "1" : "") : input.value;
    if (key === "session" || key === "mine") {
      setQuery({ session: filters.session });
      await load();
      render();
    } else {
      setQuery({ show: filters.show });
      renderResults();
    }
  });
  on(root, "change", "[data-select-all]", (event, box) => {
    for (const input of $$("[data-select]", root)) input.checked = box.checked;
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "comment") {
      const row = data.rows.find((item) => String(item.student._id) === button.dataset.id);
      const saved = await formDialog({
        title: `Follow-up note · ${fullName(row.student)}`,
        intro: row.lastComment ? `Last note: “${row.lastComment.comment}” — ${row.lastComment.byName}, ${relative(row.lastComment.createdAt)}` : "",
        fields: [{ name: "comment", label: "What happened?", type: "textarea", required: true, full: true, placeholder: "e.g. Called the parent — he was sick, will attend Thursday." }],
        onSubmit: ({ comment }) => api.teacher.followUpComment({ student: row.student._id, session: filters.session, comment }),
      });
      if (saved) {
        row.lastComment = { comment: saved.comment, byName: saved.byName, createdAt: saved.createdAt };
        renderResults();
        toast("Note saved.");
      }
    }
    if (action === "assign") {
      const selected = $$("[data-select]:checked", root).map((input) => input.dataset.select);
      if (!selected.length) {
        toast("Select students first.", "error");
        return;
      }
      const saved = await formDialog({
        title: `Assign ${plural(selected.length, "student")}`,
        fields: [{ name: "assistant", label: "Assistant", type: "select", options: data.assistants.map((assistant) => ({ value: assistant._id, label: assistant.name })), emptyLabel: "Nobody (unassign)", full: true }],
        submitLabel: "Assign",
        onSubmit: (body) => api.teacher.assignFollowUp({ assistant: body.assistant || null, students: selected }),
      });
      if (saved) {
        await load();
        render();
        toast("Follow-up updated.");
      }
    }
    if (action === "export") {
      downloadCSV(`call-list-${new Date().toISOString().slice(0, 10)}`, [
        { label: "Code", value: (row) => row.student.userID },
        { label: "Name", value: (row) => fullName(row.student) },
        { label: "Student phone", value: (row) => row.student.phone },
        { label: "Parent phone", value: (row) => row.student.parentPhone },
        { label: "Session", value: (row) => (row.attended ? "Present" : "Absent") },
        { label: "Homework", value: (row) => HOMEWORK_STATUS[row.homeworkStatus]?.label || "" },
        { label: "Exam", value: (row) => (row.examScore ?? "") },
        { label: "Missed (last 4)", value: (row) => row.absences },
        { label: "Assigned to", value: (row) => row.assignedTo?.name || "" },
        { label: "Last note", value: (row) => row.lastComment?.comment || "" },
      ], rows());
    }
  });

  await load();
  render();
}
