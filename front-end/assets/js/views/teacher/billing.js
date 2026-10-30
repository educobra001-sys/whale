import { date, html, money, mount, pageHeader, statTile, table, badge } from "../../core/ui.js";

export default async function billing(ctx) {
  const { root, api } = ctx;
  const data = await api.teacher.billing();
  const { current } = data;

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Money",
      title: "Your EduCobra plan",
      text: "You pay per active student each month. A student is active in a month once they attend a session or recharge their balance.",
    })}
    <section class="stats">
      ${statTile("Price per active student", money(data.pricePerStudent), { tone: "accent" })}
      ${statTile("Active this month", current.activeStudents, { hint: current.month })}
      ${statTile("Total students", current.totalStudents, { hint: `${current.inactiveStudents} inactive` })}
      ${statTile("This month so far", money(current.total))}
    </section>
    <div class="grid grid-main">
      <div class="stack">
        <section class="card card-flush"><div class="card-head"><h3>This month</h3></div>${table(
          [
            { label: "Price", render: (row) => row.label },
            { label: "Students", className: "num", render: (row) => row.count },
            { label: "Each", className: "num", render: (row) => money(row.price) },
            { label: "Amount", className: "num", render: (row) => money(row.amount) },
          ],
          current.lines,
          { empty: "No active students yet this month." },
        )}</section>
        <section class="card card-flush"><div class="card-head"><h3>Invoices</h3></div>${table(
          [
            { label: "Month", render: (row) => row.month },
            { label: "Active", className: "num", render: (row) => row.activeStudents },
            { label: "Total", className: "num", render: (row) => money(row.total) },
            { label: "Status", render: (row) => badge(row.status === "paid" ? "Paid" : "Open", row.status === "paid" ? "success" : "warn") },
            { label: "Paid on", render: (row) => (row.paidAt ? date(row.paidAt) : "—") },
          ],
          data.invoices,
          { empty: "Your first invoice appears when a month closes." },
        )}</section>
      </div>
      <div class="stack">
        <section class="card"><div class="card-head"><h3>Sections in your plan</h3></div>
          <ul class="list">${data.features.map((feature) => html`<li class="list-item"><span class="grow">${feature.name}</span><span class="muted small">${money(feature.price)}</span></li>`)}</ul>
        </section>
        ${data.rules.length
          ? html`<section class="card"><div class="card-head"><h3>Special prices</h3></div>
              <ul class="list">${data.rules.map((rule) => html`<li class="list-item"><span class="grow">${rule.name}</span><span class="strong">${money(rule.price)}</span></li>`)}</ul></section>`
          : ""}
      </div>
    </div>`,
  );
}
