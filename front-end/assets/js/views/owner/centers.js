import { icon } from "../../core/icons.js";
import { badge, date, formDialog, html, mount, on, pageHeader, table, toast, withBusy } from "../../core/ui.js";

const TONE = { pending_approval: ["Waiting", "warn"], active: ["Active", "success"], rejected: ["Rejected", "danger"], suspended: ["Suspended", "danger"] };

export default async function ownerCenters(ctx) {
  const { root, api } = ctx;

  async function render() {
    const rows = await api.owner.centers();
    mount(root, html`${pageHeader({
      eyebrow: "EduCobra",
      title: "Learning centers",
      text: "Create center accounts or approve the ones that registered. A center links to a teacher only when both sides agree.",
      actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New center</button>`,
    })}
    <div class="card card-flush">${table(
      [
        { label: "Center", render: (row) => html`<strong>${row.name}</strong><br><span class="muted small">${row.phone}</span>` },
        { label: "Status", render: (row) => badge(...(TONE[row.status] || [row.status, "muted"])) },
        { label: "Teachers", className: "num", render: (row) => row.teachers },
        { label: "Marketing ID", render: (row) => html`<span class="mono small">${row.referralId}</span>` },
        { label: "Joined", render: (row) => date(row.createdAt) },
        {
          label: "",
          render: (row) => html`<span class="row">${row.status !== "active" ? html`<button class="btn btn-primary btn-sm" data-id="${row._id}" data-status="active">Approve</button>` : html`<button class="btn btn-ghost btn-sm" data-id="${row._id}" data-status="suspended">Suspend</button>`}
            ${row.status === "pending_approval" ? html`<button class="btn btn-ghost btn-sm" data-id="${row._id}" data-status="rejected">Reject</button>` : ""}</span>`,
        },
      ],
      rows,
      { empty: "No centers yet." },
    )}</div>`);
  }

  const stop = on(root, "click", "button", async (event, button) => {
    if (button.dataset.status) {
      await withBusy(button, () => api.owner.setCenterStatus(button.dataset.id, { status: button.dataset.status }), "Status updated.");
      await render();
    }
    if (button.dataset.action === "create") {
      const saved = await formDialog({
        title: "New center",
        fields: [
          { name: "name", label: "Center name", required: true, full: true },
          { name: "phone", label: "Phone", type: "tel", required: true },
          { name: "password", label: "Password", type: "text", required: true, hint: "Give this to the center." },
          { name: "textlocation", label: "Address", full: true },
        ],
        submitLabel: "Create center",
        onSubmit: (values) => api.owner.createCenter(values),
      });
      if (saved) {
        toast("Center created.");
        await render();
      }
    }
  });
  await render();
  return stop;
}
