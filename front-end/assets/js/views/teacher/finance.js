import { icon } from "../../core/icons.js";
import {
  barChart, confirmDialog, date, downloadCSV, formDialog, html, isoDate, money, mount, on, pageHeader, statTile, table, toast, withBusy,
} from "../../core/ui.js";

const CATEGORIES = [
  { value: "printing", label: "Printing" },
  { value: "rent", label: "Rent / center" },
  { value: "salaries", label: "Salaries" },
  { value: "supplies", label: "Supplies" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

export default async function finance(ctx) {
  const { root, api } = ctx;
  const range = { from: isoDate(Date.now() - 29 * 86400000), to: isoDate() };
  let report;
  let expenses = [];

  async function load() {
    [report, expenses] = await Promise.all([api.teacher.finance(range), api.teacher.expenses(range)]);
  }

  function render() {
    const totals = report.totals;
    const days = report.byDay || [];
    const step = Math.max(1, Math.ceil(days.length / 15));
    const chartPoints = [];
    for (let index = 0; index < days.length; index += step) {
      const chunk = days.slice(index, index + step);
      chartPoints.push({ label: date(chunk[0].date, { day: "numeric", month: "short" }), value: chunk.reduce((total, day) => total + day.income, 0), tone: "success" });
    }
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Money",
        title: "Finance",
        text: "Money that actually came in (cash, recharge codes, approved transfers and booklets) minus expenses, center closings and assistant salaries.",
        actions: html`<button class="btn btn-secondary" data-action="export">${icon("download")} Export</button><button class="btn btn-primary" data-action="expense">${icon("plus")} Add expense</button>`,
      })}
      <div class="toolbar">
        <div class="field"><label for="fin-from">From</label><input id="fin-from" type="date" value="${range.from}" data-range="from"></div>
        <div class="field"><label for="fin-to">To</label><input id="fin-to" type="date" value="${range.to}" data-range="to"></div>
        <div class="row" style="align-self:end">
          <button class="btn btn-sm btn-ghost" data-preset="7">7 days</button><button class="btn btn-sm btn-ghost" data-preset="30">30 days</button><button class="btn btn-sm btn-ghost" data-preset="month">This month</button>
        </div>
      </div>
      <section class="stats">
        ${statTile("Money in", money(totals.income), { tone: "success" })}
        ${statTile("Expenses", money(totals.expenses))}
        ${statTile("Center closings", money(totals.centerCosts))}
        ${statTile("Assistant pay", money(totals.salaries), { hint: "hourly / per-session" })}
        ${statTile("Net", money(totals.net), { tone: totals.net < 0 ? "danger" : "accent" })}
      </section>
      <div class="grid grid-main">
        <section class="card card-accent"><div class="card-head"><h3>Money in over time</h3></div>${barChart(chartPoints, { format: (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : value) })}</section>
        <section class="card"><div class="card-head"><h3>Where it came from</h3></div>
          <dl class="kv">
            <dt>Cash at the door</dt><dd>${money(totals.cash)}</dd>
            <dt>Recharge codes</dt><dd>${money(totals.recharge)}</dd>
            <dt>Approved transfers</dt><dd>${money(totals.topups)}</dd>
            <dt>Booklets</dt><dd>${money(totals.booklets)}</dd>
            <dt>Charged to balances</dt><dd class="muted">${money(totals.charged)}</dd>
          </dl>
          <p class="muted small mt">“Charged to balances” is what sessions cost students; it's not new money, it comes from money they already paid.</p>
        </section>
      </div>
      <section class="card card-flush mt"><div class="card-head"><h3>Sessions in this period</h3></div>${table(
        [
          { label: "Session", render: (row) => html`<a class="strong" href="#/sessions/${row._id}">${row.label}</a>` },
          { label: "Date", render: (row) => date(row.date) },
          { label: "Center", render: (row) => row.centerName || "Online" },
          { label: "Present", className: "num", render: (row) => row.present },
          { label: "Cash", className: "num", render: (row) => money(row.collected) },
          { label: "Charged", className: "num", render: (row) => money(row.charged) },
          { label: "Center cost", className: "num", render: (row) => money(row.centerCost) },
        ],
        report.sessions || [],
        { empty: "No sessions in this period." },
      )}</section>
      <section class="card card-flush mt"><div class="card-head"><h3>Expenses</h3></div>${table(
        [
          { label: "Date", render: (row) => date(row.date) },
          { label: "Category", render: (row) => CATEGORIES.find((item) => item.value === row.category)?.label || row.category },
          { label: "Details", render: (row) => row.reason },
          { label: "Amount", className: "num", render: (row) => money(row.amount) },
          { label: "", className: "actions", render: (row) => html`<button class="btn btn-sm btn-ghost" data-action="delete" data-id="${row._id}">Delete</button>` },
        ],
        expenses,
        { empty: "No expenses recorded in this period." },
      )}</section>`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  on(root, "change", "[data-range]", (event, input) => {
    range[input.dataset.range] = input.value;
    reload();
  });
  on(root, "click", "[data-preset]", (event, button) => {
    const preset = button.dataset.preset;
    const now = new Date();
    range.to = isoDate(now);
    range.from = preset === "month" ? isoDate(new Date(now.getFullYear(), now.getMonth(), 1)) : isoDate(Date.now() - (Number(preset) - 1) * 86400000);
    reload();
  });
  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "expense") {
      const saved = await formDialog({
        title: "Add expense",
        fields: [
          { name: "amount", label: "Amount", type: "number", min: 1, required: true },
          { name: "category", label: "Category", type: "select", options: CATEGORIES, value: "other", required: true },
          { name: "reason", label: "Details", required: true, full: true },
          { name: "date", label: "Date", type: "date", value: isoDate() },
        ],
        onSubmit: (body) => api.teacher.addExpense(body),
      });
      if (saved) await reload("Expense added.");
    }
    if (action === "delete") {
      if (!(await confirmDialog("Delete this expense?", { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteExpense(button.dataset.id)))) return;
      await reload("Expense deleted.");
    }
    if (action === "export") {
      downloadCSV(`finance-${range.from}-to-${range.to}`, [
        { label: "Date", value: (row) => row.date },
        { label: "Money in", value: (row) => row.income },
        { label: "Expenses", value: (row) => row.expenses },
      ], report.byDay || []);
    }
  });

  await load();
  render();
}
