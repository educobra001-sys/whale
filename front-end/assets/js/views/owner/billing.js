import { badge, fullName, html, money, mount, on, pageHeader, statTile, table, withBusy } from "../../core/ui.js";

export default async function ownerBilling(ctx) {
  const { root, api, query, setQuery } = ctx;
  const now = new Date();
  let month = query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function render() {
    const data = await api.owner.billing({ month });
    const rows = data.rows;
    mount(root, html`${pageHeader({
      eyebrow: "EduCobra",
      title: "Pricing & billing",
      text: "Active and total students per teacher, and what each one owes for the month.",
      actions: html`<input id="billing-month" type="month" value="${month}" aria-label="Month"><button class="btn btn-primary" data-action="generate">Generate invoices</button>`,
    })}
    <section class="stats">
      ${statTile("Active students", rows.reduce((sum, row) => sum + row.activeStudents, 0))}
      ${statTile("Total students", rows.reduce((sum, row) => sum + row.totalStudents, 0))}
      ${statTile("Expected", money(rows.reduce((sum, row) => sum + row.estimate, 0)), { tone: "accent" })}
      ${statTile("Paid", money(rows.reduce((sum, row) => sum + (row.invoice?.status === "paid" ? row.invoice.total : 0), 0)))}
    </section>
    <div class="card card-flush">${table(
      [
        { label: "Teacher", render: (row) => html`<a class="strong" href="#/teachers/${row._id}">${fullName(row)}</a>` },
        { label: "Active", className: "num", render: (row) => row.activeStudents },
        { label: "Inactive", className: "num", render: (row) => row.inactiveStudents },
        { label: "Total", className: "num", render: (row) => row.totalStudents },
        { label: "Per student", className: "num", render: (row) => money(row.pricePerStudent) },
        { label: "Amount", className: "num", render: (row) => money(row.estimate) },
        {
          label: "Invoice",
          render: (row) => (row.invoice
            ? html`${badge(row.invoice.status === "paid" ? "Paid" : "Open", row.invoice.status === "paid" ? "success" : "warn")}
                <button class="btn btn-ghost btn-sm" data-invoice="${row.invoice._id}" data-next="${row.invoice.status === "paid" ? "open" : "paid"}">${row.invoice.status === "paid" ? "Reopen" : "Mark paid"}</button>`
            : html`<span class="muted small">Not generated</span>`),
        },
      ],
      rows,
      { empty: "No teachers this month." },
    )}</div>`);
  }

  const stops = [
    on(root, "change", "#billing-month", (event, input) => {
      month = input.value;
      setQuery({ month });
      render();
    }),
    on(root, "click", "button", async (event, button) => {
      if (button.dataset.action === "generate") {
        await withBusy(button, () => api.owner.generateInvoices(month), "Invoices generated.");
        await render();
      }
      if (button.dataset.invoice) {
        await withBusy(button, () => api.owner.setInvoice(button.dataset.invoice, { status: button.dataset.next }));
        await render();
      }
    }),
  ];
  await render();
  return () => stops.forEach((stop) => stop());
}
