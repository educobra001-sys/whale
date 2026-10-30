import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, date, dateTime, downloadCSV, formDialog, fullName, html, isoDate, money, mount, on, openDialog, pageHeader,
  plural, statTile, table, tabs, toast, withBusy,
} from "../../core/ui.js";
import { matches, statusBadge, studentCell, txBadge } from "../shared/common.js";

export default async function wallet(ctx) {
  const { root, api, query, setQuery } = ctx;
  let tab = query.tab || "topups";
  let topups = [];
  let codes = [];
  let transactions = [];
  const filters = { code: "unused", q: "", type: "", from: isoDate(Date.now() - 30 * 86400000), to: isoDate() };

  async function load() {
    [topups, codes, transactions] = await Promise.all([
      api.teacher.topups(),
      api.teacher.rechargeCodes(),
      api.teacher.transactions({ from: filters.from, to: filters.to, type: filters.type }),
    ]);
  }

  function topupsTab() {
    return html`<p class="muted small mb">Students who pay by Vodafone Cash / InstaPay upload the receipt from their wallet. Approving adds the amount to their balance.</p>
      <div class="card card-flush">${table(
        [
          { label: "Student", render: (t) => studentCell(t.student) },
          { label: "Amount", className: "num", render: (t) => html`<strong>${money(t.amount)}</strong>` },
          { label: "Method", render: (t) => html`${t.method}<div class="muted small mono">${t.reference || ""}</div>` },
          { label: "Sent", render: (t) => dateTime(t.createdAt) },
          { label: "Status", render: (t) => html`${statusBadge(t.status)}${t.reason ? html`<div class="muted small">${t.reason}</div>` : ""}` },
          { label: "", className: "actions", render: (t) => (t.status === "pending" ? html`<button class="btn btn-sm btn-primary" data-action="review" data-id="${t._id}">Review</button>` : "") },
        ],
        topups,
        { empty: "No transfer receipts yet." },
      )}</div>`;
  }

  const visibleCodes = () => codes.filter((code) => (filters.code === "unused" ? !code.used : filters.code === "used" ? code.used : true) && matches(filters.q, code.code, code.batch, fullName(code.usedBy)));

  function codesTab() {
    const unused = codes.filter((code) => !code.used);
    return html`<section class="stats">
        ${statTile("Unused codes", unused.length)}
        ${statTile("Unused value", money(unused.reduce((total, code) => total + code.amount, 0)))}
        ${statTile("Redeemed", codes.length - unused.length, { tone: "success" })}
      </section>
      <div class="toolbar">
        <label class="search">${icon("search", 16)}<input type="search" id="code-search" placeholder="Code, batch or student…" value="${filters.q}" aria-label="Search codes"></label>
        <select class="select-sm" id="code-filter" aria-label="Filter codes"><option value="unused" ${filters.code === "unused" ? html`selected` : ""}>Unused</option><option value="used" ${filters.code === "used" ? html`selected` : ""}>Used</option><option value="all" ${filters.code === "all" ? html`selected` : ""}>All</option></select>
        <button class="btn btn-secondary" data-action="print-codes">${icon("file", 16)} Print</button>
        <button class="btn btn-secondary" data-action="export-codes">${icon("download", 16)} Export</button>
        <button class="btn btn-primary" data-action="generate">${icon("plus", 16)} Generate codes</button>
      </div>
      <div class="card card-flush" id="codes-table">${codesTable()}</div>`;
  }

  function codesTable() {
    return table(
      [
        { label: "Code", render: (code) => html`<span class="mono strong">${code.code}</span>` },
        { label: "Value", className: "num", render: (code) => money(code.amount) },
        { label: "Batch", render: (code) => code.batch || "—" },
        { label: "Created", render: (code) => date(code.createdAt) },
        { label: "Used by", render: (code) => (code.used ? html`${fullName(code.usedBy)} <div class="muted small">${dateTime(code.usedAt)}</div>` : badge("Unused", "success")) },
        { label: "", className: "actions", render: (code) => (code.used ? "" : html`<button class="btn btn-sm btn-ghost" data-action="delete-code" data-id="${code._id}">Delete</button>`) },
      ],
      visibleCodes(),
      { empty: "No codes here. Generate a batch and sell them at the center or bookshop." },
    );
  }

  function transactionsTab() {
    const income = transactions.filter((tx) => tx.amount > 0 && tx.type !== "refund").reduce((total, tx) => total + tx.amount, 0);
    return html`<div class="toolbar">
        <div class="field"><label for="tx-from">From</label><input id="tx-from" type="date" value="${filters.from}" data-tx="from"></div>
        <div class="field"><label for="tx-to">To</label><input id="tx-to" type="date" value="${filters.to}" data-tx="to"></div>
        <div class="field"><label for="tx-type">Type</label><select id="tx-type" data-tx="type"><option value="">All</option>
          ${["payment", "recharge", "topup", "attendance", "lesson", "refund", "adjustment"].map((type) => html`<option value="${type}" ${filters.type === type ? html`selected` : ""}>${type}</option>`)}</select></div>
        <button class="btn btn-secondary" data-action="export-tx" style="align-self:end">${icon("download", 16)} Export</button>
      </div>
      <p class="muted small mb">${plural(transactions.length, "transaction")} · money in ${money(income)}</p>
      <div class="card card-flush">${table(
        [
          { label: "Date", render: (tx) => dateTime(tx.createdAt) },
          { label: "Student", render: (tx) => studentCell(tx.student) },
          { label: "Type", render: (tx) => txBadge(tx.type) },
          { label: "Details", render: (tx) => tx.reason },
          { label: "By", render: (tx) => tx.byName || "—" },
          { label: "Amount", className: "num", render: (tx) => html`<span class="${tx.amount < 0 ? "text-danger" : "text-success"} strong">${tx.amount > 0 ? "+" : ""}${money(tx.amount)}</span>` },
        ],
        transactions,
        { empty: "No transactions in this period." },
      )}</div>`;
  }

  function render() {
    const pending = topups.filter((t) => t.status === "pending");
    mount(
      root,
      html`${pageHeader({ eyebrow: "Money", title: "Wallet & payments", text: "Every student has a balance with you. They top it up with cash at the door, recharge codes, or a transfer receipt you approve." })}
      ${tabs(
        [
          { key: "topups", label: "Transfer receipts", count: pending.length || undefined },
          { key: "codes", label: "Recharge codes", count: codes.filter((code) => !code.used).length },
          { key: "transactions", label: "Transactions" },
        ],
        tab,
      )}
      <div id="tab-body">${{ topups: topupsTab, codes: codesTab, transactions: transactionsTab }[tab]()}</div>`,
    );
  }

  const reload = async (message) => {
    await load();
    render();
    if (message) toast(message);
  };

  on(root, "click", "[data-tab]", (event, button) => {
    tab = button.dataset.tab;
    setQuery({ tab });
    render();
  });
  on(root, "input", "#code-search", (event, input) => {
    filters.q = input.value;
    mount($("#codes-table", root), codesTable());
  });
  on(root, "change", "#code-filter", (event, select) => {
    filters.code = select.value;
    mount($("#codes-table", root), codesTable());
  });
  on(root, "change", "[data-tx]", async (event, input) => {
    filters[input.dataset.tx] = input.value;
    transactions = await api.teacher.transactions({ from: filters.from, to: filters.to, type: filters.type });
    render();
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "review") {
      const topup = topups.find((item) => item._id === button.dataset.id);
      const { dialog, close } = openDialog({
        title: `${money(topup.amount)} from ${fullName(topup.student)}`,
        eyebrow: `${topup.method} · ${topup.reference || "no reference"}`,
        size: "lg",
        body: html`${topup.receiptUrl ? html`<a href="${topup.receiptUrl}" target="_blank" rel="noopener"><img src="${topup.receiptUrl}" alt="Transfer receipt" style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px;border:1px solid var(--border);background:var(--surface-sunken)"></a>` : html`<p class="muted">No receipt image.</p>`}
          <div class="form-grid mt">
            <div class="field"><label for="tp-amount">Amount to add</label><input id="tp-amount" type="number" min="1" value="${topup.amount}"></div>
            <div class="field"><label for="tp-reason">Reason (if rejecting)</label><input id="tp-reason" placeholder="e.g. Receipt not clear"></div>
          </div>`,
        actions: html`<button class="btn btn-danger" data-reject>Reject</button><button class="btn btn-primary" data-approve>Approve & add balance</button>`,
      });
      const decide = async (status, target) => {
        const body = { status, amount: Number($("#tp-amount", dialog).value) || topup.amount, reason: $("#tp-reason", dialog).value.trim() };
        if (!(await withBusy(target, () => api.teacher.reviewTopup(topup._id, body)))) return;
        close();
        await reload(status === "approved" ? "Approved — balance updated." : "Request rejected.");
      };
      $("[data-approve]", dialog).addEventListener("click", (e) => decide("approved", e.currentTarget));
      $("[data-reject]", dialog).addEventListener("click", (e) => decide("rejected", e.currentTarget));
    }
    if (action === "generate") {
      const created = await formDialog({
        title: "Generate recharge codes",
        intro: "Each code adds its value to the balance of the student who redeems it — only students in your class can use them.",
        fields: [
          { name: "count", label: "How many codes", type: "number", min: 1, max: 200, required: true, value: 20 },
          { name: "amount", label: "Value of each code", type: "number", min: 1, required: true, value: 100 },
          { name: "prefix", label: "Prefix", value: "LC", maxlength: 6, hint: "Letters shown at the start of every code" },
          { name: "batch", label: "Batch name", placeholder: "e.g. October — bookshop" },
        ],
        submitLabel: "Generate",
        onSubmit: (body) => api.teacher.generateCodes(body),
      });
      if (created) {
        filters.code = "unused";
        await reload(`${plural(created.length, "code")} generated.`);
      }
    }
    if (action === "delete-code") {
      if (!(await confirmDialog("Delete this unused code? It will stop working immediately.", { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteCode(button.dataset.id)))) return;
      await reload("Code deleted.");
    }
    if (action === "export-codes") {
      downloadCSV("recharge-codes", [
        { label: "Code", value: (code) => code.code },
        { label: "Value", value: (code) => code.amount },
        { label: "Batch", value: (code) => code.batch },
        { label: "Used", value: (code) => (code.used ? "Yes" : "No") },
        { label: "Used by", value: (code) => (code.used ? fullName(code.usedBy) : "") },
      ], visibleCodes());
    }
    if (action === "print-codes") {
      const list = visibleCodes().filter((code) => !code.used);
      if (!list.length) {
        toast("No unused codes to print.", "error");
        return;
      }
      openDialog({
        title: `${plural(list.length, "code")} ready to print`,
        size: "xl",
        body: html`<div class="code-list">${list.map((code) => html`<div class="code-chip"><span class="muted small">Learning Center · ${money(code.amount)}</span><strong>${code.code}</strong><span class="muted small">Redeem from Wallet → Recharge code</span></div>`)}</div>`,
        actions: html`<button class="btn btn-primary" onclick="window.print()">Print</button>`,
      });
    }
    if (action === "export-tx") {
      downloadCSV(`transactions-${filters.from}-to-${filters.to}`, [
        { label: "Date", value: (tx) => dateTime(tx.createdAt) },
        { label: "Code", value: (tx) => tx.student?.userID },
        { label: "Student", value: (tx) => fullName(tx.student) },
        { label: "Type", value: (tx) => tx.type },
        { label: "Details", value: (tx) => tx.reason },
        { label: "By", value: (tx) => tx.byName },
        { label: "Amount", value: (tx) => tx.amount },
      ], transactions);
    }
  });

  await load();
  render();
}
