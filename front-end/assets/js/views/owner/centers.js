import { icon } from "../../core/icons.js";
import { badge, date, formDialog, html, mount, on, pageHeader, table, toast, withBusy } from "../../core/ui.js";

const TONE = { pending_approval: ["Waiting", "warn"], active: ["Active", "success"], rejected: ["Rejected", "danger"], suspended: ["Suspended", "danger"] };

const WORDS = {
  center: { title: "Learning centers", one: "center", One: "Center", text: "Create center accounts or approve the ones that registered. A center links to a teacher only when both sides agree." },
  school: { title: "Schools & organizations", one: "school", One: "School", text: "Create school and organization accounts or approve the ones that registered. They work exactly like centers: a school links to a teacher only when both sides agree." },
};

export default function ownerCenters(ctx) {
  return placesPage(ctx, "center");
}

export async function placesPage(ctx, kind) {
  const { root, api } = ctx;
  const words = WORDS[kind];

  async function render() {
    const rows = await api.owner.centers({ kind });
    mount(root, html`${pageHeader({
      eyebrow: "EduCobra",
      title: words.title,
      text: words.text,
      actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New ${words.one}</button>`,
    })}
    <div class="card card-flush">${table(
      [
        { label: words.One, render: (row) => html`<strong>${row.name}</strong><br><span class="muted small">${row.phone}</span>` },
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
      { empty: `No ${words.one}s yet.` },
    )}</div>`);
  }

  const stop = on(root, "click", "button", async (event, button) => {
    if (button.dataset.status) {
      await withBusy(button, () => api.owner.setCenterStatus(button.dataset.id, { status: button.dataset.status }), "Status updated.");
      await render();
    }
    if (button.dataset.action === "create") {
      const saved = await formDialog({
        title: `New ${words.one}`,
        fields: [
          { name: "name", label: `${words.One} name`, required: true, full: true },
          { name: "phone", label: "Phone", type: "tel", required: true },
          { name: "password", label: "Password", type: "text", required: true, hint: `Give this to the ${words.one}.` },
          { name: "textlocation", label: "Address", full: true },
        ],
        submitLabel: `Create ${words.one}`,
        onSubmit: (values) => api.owner.createCenter({ ...values, kind }),
      });
      if (saved) {
        toast(`${words.One} created.`);
        await render();
      }
    }
  });
  await render();
  return stop;
}
