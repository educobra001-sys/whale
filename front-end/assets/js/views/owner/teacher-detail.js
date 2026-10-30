import { GRADES } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { badge, confirmDialog, fieldHtml, formDialog, fullName, html, money, mount, on, pageHeader, readForm, statTile, table, toast, withBusy } from "../../core/ui.js";
import { statusChip } from "./teachers.js";

const CHANNELS = [
  { name: "telegram", label: "Telegram bot" },
  { name: "whatsapp_api", label: "WhatsApp API" },
  { name: "whatsapp_web", label: "WhatsApp through the linked server number" },
  { name: "whatsapp_link", label: "WhatsApp links (wa.me)" },
];

export default async function ownerTeacher(ctx) {
  const { root, api, params } = ctx;

  const ruleFields = (teacher) => [
    { name: "name", label: "Rule name", required: true, full: true, hint: "Shown to the teacher." },
    { name: "price", label: "Price per student", type: "number", min: 0, step: "0.01", required: true },
    { name: "priority", label: "Priority", type: "number", min: 0, value: 0, hint: "The highest priority wins when a student matches several rules." },
    { name: "grades", label: "Grades", type: "checkboxes", options: GRADES.map((label, index) => ({ value: String(index), label })) },
    ...(teacher.centers.length ? [{ name: "centers", label: "Centers", type: "checkboxes", options: teacher.centers.map((center) => ({ value: center._id, label: center.name })) }] : []),
    { name: "students", label: "Specific student codes", type: "textarea", full: true, placeholder: "STU-000123, STU-000124", hint: "Separate with commas or new lines." },
    { name: "joinedAfter", label: "Joined after", type: "date" },
    { name: "joinedBefore", label: "Joined before", type: "date" },
  ];

  const filtersText = (rule) => {
    const filters = rule.filters || {};
    const parts = [];
    if (filters.grades?.length) parts.push(filters.grades.map((grade) => GRADES[Number(grade)]).join(", "));
    if (filters.centers?.length) parts.push(filters.centers.map((center) => center.name).join(", "));
    if (filters.students?.length) parts.push(`${filters.students.length} chosen student(s)`);
    if (filters.joinedAfter) parts.push(`joined after ${String(filters.joinedAfter).slice(0, 10)}`);
    if (filters.joinedBefore) parts.push(`joined before ${String(filters.joinedBefore).slice(0, 10)}`);
    return parts.join(" · ") || "Every student";
  };

  async function render() {
    const teacher = await api.owner.teacher(params.id);
    const channelFields = CHANNELS.map((channel) => ({ ...channel, type: "checkbox", checked: teacher.channels?.[channel.name] }));
    const affiliateFields = [
      { name: "code", label: "Marketing ID", value: teacher.affiliate?.code || "", placeholder: "EC-ABCD2345" },
      { name: "ratePerStudent", label: "Amount per active student", type: "number", min: 0, step: "0.01", value: teacher.affiliate?.ratePerStudent ?? 0 },
    ];
    mount(root, html`${pageHeader({
      eyebrow: "Teacher",
      title: fullName(teacher),
      text: `${teacher.email} · ${teacher.phone}`,
      actions: html`${statusChip(teacher.status)}
        ${teacher.status !== "active" ? html`<button class="btn btn-primary" data-status="active" ${teacher.confirmEmail ? "" : html`disabled`}>Approve</button>` : ""}
        ${teacher.status === "pending_approval" ? html`<button class="btn btn-secondary" data-status="rejected">Reject</button>` : ""}
        ${teacher.status === "active" ? html`<button class="btn btn-danger" data-status="suspended">Suspend</button>` : ""}`,
    })}
    ${teacher.confirmEmail ? "" : html`<div class="notice mb">This teacher hasn't verified their email yet.</div>`}
    <section class="stats">
      ${statTile("Active this month", teacher.activeStudents)}
      ${statTile("Total students", teacher.totalStudents, { hint: `${teacher.inactiveStudents} inactive` })}
      ${statTile("Price per student", money(teacher.pricePerStudent), { tone: "accent" })}
      ${statTile("Expected this month", money(teacher.estimate))}
    </section>
    <div class="grid grid-main">
      <div class="stack">
        <section class="card">
          <div class="card-head"><h3>Plan</h3><a class="btn btn-primary btn-sm" href="#/plans?email=${encodeURIComponent(teacher.email)}">Change plan</a></div>
          ${teacher.features.length ? html`<div class="status-chips">${teacher.features.map((key) => badge(key.replace("_", " "), "accent"))}</div>` : html`<p class="muted">No sections yet. This teacher can't use any section until you set a plan.</p>`}
        </section>
        <section class="card card-flush">
          <div class="card-head"><h3>Special prices</h3><button class="btn btn-secondary btn-sm" data-action="add-rule">${icon("plus", 15)} Add rule</button></div>
          ${table(
            [
              { label: "Rule", render: (row) => html`<strong>${row.name}</strong><br><span class="muted small">${filtersText(row)}</span>` },
              { label: "Price", className: "num", render: (row) => money(row.price) },
              { label: "Priority", className: "num", render: (row) => row.priority },
              { label: "", render: (row) => html`<button class="btn btn-ghost btn-sm" data-remove-rule="${row._id}">Remove</button>` },
            ],
            teacher.rules,
            { empty: "Every student is charged the plan price." },
          )}
        </section>
        <section class="card card-flush"><div class="card-head"><h3>Invoices</h3></div>${table(
          [
            { label: "Month", render: (row) => row.month },
            { label: "Active", className: "num", render: (row) => row.activeStudents },
            { label: "Total", className: "num", render: (row) => money(row.total) },
            { label: "Status", render: (row) => badge(row.status === "paid" ? "Paid" : "Open", row.status === "paid" ? "success" : "warn") },
          ],
          teacher.invoices,
          { empty: "No invoices yet." },
        )}</section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h3>Messaging channels</h3></div>
          <form id="channels-form" class="stack">${channelFields.map(fieldHtml)}<button class="btn btn-primary btn-sm" type="submit">Save channels</button></form>
          <p class="muted small mt">A channel also needs the Telegram or WhatsApp section in the plan.</p>
        </section>
        <section class="card"><div class="card-head"><h3>Affiliate deal</h3></div>
          <form id="affiliate-form" class="stack">${affiliateFields.map(fieldHtml)}<button class="btn btn-primary btn-sm" type="submit">Save deal</button></form>
          <p class="muted small mt">Leave the ID empty to end the deal.</p>
        </section>
      </div>
    </div>`);

    on(root, "submit", "#channels-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.setChannels(params.id, readForm(form, channelFields)), "Channels saved.");
    });
    on(root, "submit", "#affiliate-form", async (event, form) => {
      event.preventDefault();
      await withBusy(form.querySelector("button"), () => api.owner.setAffiliate(params.id, readForm(form, affiliateFields)), "Deal saved.");
    });
    return teacher;
  }

  let teacher = await render();

  const stop = on(root, "click", "button", async (event, button) => {
    if (button.dataset.status) {
      const status = button.dataset.status;
      if (status !== "active" && !(await confirmDialog(`${status === "suspended" ? "Suspend" : "Reject"} this teacher? Their team loses access straight away.`, { danger: true, confirmLabel: "Yes" }))) return;
      if (await withBusy(button, () => api.owner.setTeacherStatus(params.id, { status }), "Status updated.")) teacher = await render();
    }
    if (button.dataset.action === "add-rule") {
      const saved = await formDialog({
        title: "Special price",
        intro: "Students matching every filter you fill are charged this price instead of the plan price.",
        fields: ruleFields(teacher),
        submitLabel: "Add rule",
        onSubmit: (values) => api.owner.addRule(params.id, {
          name: values.name,
          price: values.price,
          priority: values.priority ?? 0,
          filters: {
            grades: values.grades,
            centers: values.centers || [],
            students: String(values.students || "").split(/[\s,]+/).filter(Boolean),
            joinedAfter: values.joinedAfter,
            joinedBefore: values.joinedBefore,
          },
        }),
      });
      if (saved) {
        toast("Rule added.");
        teacher = await render();
      }
    }
    if (button.dataset.removeRule) {
      await withBusy(button, () => api.owner.removeRule(params.id, button.dataset.removeRule), "Rule removed.");
      teacher = await render();
    }
  });
  return stop;
}
