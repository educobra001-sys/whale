import { badge, date, fullName, html, money, mount, on, pageHeader, table, tabs } from "../../core/ui.js";

export const STATUS = {
  pending_email: ["Verifying email", "muted"],
  pending_approval: ["Waiting for approval", "warn"],
  active: ["Active", "success"],
  rejected: ["Rejected", "danger"],
  suspended: ["Suspended", "danger"],
};
export const statusChip = (status) => badge(...(STATUS[status] || [status, "muted"]));

export default async function ownerTeachers(ctx) {
  const { root, api, query, setQuery } = ctx;
  let status = query.status || "";

  async function render() {
    const rows = await api.owner.teachers({ status });
    mount(root, html`${pageHeader({ eyebrow: "EduCobra", title: "Teachers", text: "Approve teachers, set their plan, channels, prices and affiliate deals." })}
      ${tabs([{ key: "", label: "All" }, { key: "pending_approval", label: "Waiting" }, { key: "active", label: "Active" }, { key: "suspended", label: "Suspended" }, { key: "rejected", label: "Rejected" }], status)}
      <div class="card card-flush mt">${table(
        [
          { label: "Teacher", render: (row) => html`<a class="strong" href="#/teachers/${row._id}">${fullName(row)}</a><br><span class="muted small">${row.email}</span>` },
          { label: "Status", render: (row) => statusChip(row.status) },
          { label: "Visibility", render: (row) => row.visibility },
          { label: "Active", className: "num", render: (row) => row.activeStudents },
          { label: "Total", className: "num", render: (row) => row.totalStudents },
          { label: "Per student", className: "num", render: (row) => money(row.pricePerStudent) },
          { label: "Expected", className: "num", render: (row) => money(row.estimate) },
          { label: "Joined", render: (row) => date(row.createdAt) },
        ],
        rows,
        { empty: "No teachers here." },
      )}</div>`);
  }

  const stop = on(root, "click", "[data-tab]", (event, button) => {
    status = button.dataset.tab;
    setQuery({ status });
    render();
  });
  await render();
  return stop;
}
