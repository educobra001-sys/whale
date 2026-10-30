import { badge, fullName, html, money, mount, on, pageHeader, statTile, table, toast, withBusy } from "../../core/ui.js";

export default async function ownerAffiliates(ctx) {
  const { root, api, query, setQuery } = ctx;
  const now = new Date();
  let month = query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  async function render() {
    const data = await api.owner.affiliates({ month });
    mount(root, html`${pageHeader({
      eyebrow: "EduCobra",
      title: "Affiliates",
      text: "Anyone on the platform can earn through their marketing ID. Attach an ID and an amount from the teacher's page.",
      actions: html`<input id="aff-month" type="month" value="${month}" aria-label="Month">`,
    })}
    <section class="card mb"><div class="row"><input id="aff-code" placeholder="EC-ABCD2345" aria-label="Marketing ID"><button class="btn btn-secondary" data-action="lookup">Find who owns this ID</button></div></section>
    <section class="stats">${statTile("Owed this month", money(data.total), { tone: "accent" })}${statTile("Deals", data.rows.length)}</section>
    <div class="card card-flush">${table(
      [
        { label: "Marketing ID", render: (row) => html`<span class="mono small">${row.code}</span><br><span class="muted small">${row.ownerRole}</span>` },
        { label: "Teacher", render: (row) => html`<a class="strong" href="#/teachers/${row.teacher._id}">${fullName(row.teacher)}</a>` },
        { label: "Per student", className: "num", render: (row) => money(row.ratePerStudent) },
        { label: "Active", className: "num", render: (row) => row.activeStudents },
        { label: "Amount", className: "num", render: (row) => money(row.amount) },
        {
          label: "Payout",
          render: (row) => (row.earning
            ? html`${badge(row.earning.status === "paid" ? "Paid" : "Due", row.earning.status === "paid" ? "success" : "warn")}
                <button class="btn btn-ghost btn-sm" data-earning="${row.earning._id}" data-next="${row.earning.status === "paid" ? "due" : "paid"}">${row.earning.status === "paid" ? "Undo" : "Mark paid"}</button>`
            : html`<span class="muted small">Closes with the month's invoices</span>`),
        },
      ],
      data.rows,
      { empty: "No affiliate deals yet." },
    )}</div>`);
  }

  const stops = [
    on(root, "change", "#aff-month", (event, input) => {
      month = input.value;
      setQuery({ month });
      render();
    }),
    on(root, "click", "button", async (event, button) => {
      if (button.dataset.action === "lookup") {
        const code = root.querySelector("#aff-code").value.trim();
        if (!code) return;
        const found = await withBusy(button, () => api.owner.lookupReferral(code));
        if (found) toast(`${found.code} belongs to ${found.name} (${found.role}).`);
      }
      if (button.dataset.earning) {
        await withBusy(button, () => api.owner.setEarning(button.dataset.earning, button.dataset.next));
        await render();
      }
    }),
  ];
  await render();
  return () => stops.forEach((stop) => stop());
}
