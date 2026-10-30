import { icon } from "../../core/icons.js";
import {
  $, badge, confirmDialog, date, formDialog, fullName, gradeLabel, html, money, mount, on, openDialog, pageHeader, statTile, table, tabs, toast, withBusy,
} from "../../core/ui.js";
import { gradeOptions, matches, statusBadge, studentCell, studentOptions } from "../shared/common.js";

export default async function booklets(ctx) {
  const { root, api, query, setQuery } = ctx;
  let tab = query.tab || "catalogue";
  let catalogue = [];
  let orders = [];
  let students = [];
  const filters = { status: "", q: "" };

  async function load() {
    [catalogue, orders, students] = await Promise.all([api.teacher.booklets(), api.teacher.bookletOrders(), api.teacher.students().catch(() => [])]);
  }

  const bookletFields = (values = {}) => [
    { name: "name", label: "Name", required: true, full: true, value: values.name },
    { name: "grade", label: "Grade", type: "select", options: gradeOptions, value: values.grade, emptyLabel: "All grades" },
    { name: "stock", label: "Copies in stock", type: "number", min: 0, value: values.stock ?? 0 },
    { name: "printPrice", label: "Printing cost per copy", type: "number", min: 0, value: values.printPrice ?? 0 },
    { name: "sellPrice", label: "Selling price", type: "number", min: 0, required: true, value: values.sellPrice },
    { name: "isActive", label: "Visible to students", type: "checkbox", checked: values.isActive !== false },
  ];

  function catalogueTab() {
    return html`<div class="card card-flush">${table(
      [
        { label: "Booklet", render: (b) => html`<strong>${b.name}</strong>${b.isActive ? "" : html` ${badge("Hidden", "muted")}`}` },
        { label: "Grade", render: (b) => (b.grade !== "" && b.grade != null ? gradeLabel(b.grade) : "All") },
        { label: "Price", className: "num", render: (b) => money(b.sellPrice) },
        { label: "Profit / copy", className: "num", render: (b) => money(b.sellPrice - (b.printPrice || 0)) },
        { label: "In stock", className: "num", render: (b) => (b.stock <= 5 ? html`<span class="text-danger strong">${b.stock}</span>` : b.stock) },
        { label: "Sold", className: "num", render: (b) => b.sold ?? 0 },
        { label: "Delivered", className: "num", render: (b) => b.delivered ?? 0 },
        { label: "Collected", className: "num", render: (b) => money(b.collected || 0) },
        { label: "Outstanding", className: "num", render: (b) => (b.outstanding ? html`<span class="text-danger">${money(b.outstanding)}</span>` : "—") },
        { label: "", className: "actions", render: (b) => html`<button class="btn btn-sm btn-secondary" data-action="edit" data-id="${b._id}">Edit</button><button class="btn btn-sm btn-ghost" data-action="delete" data-id="${b._id}">Delete</button>` },
      ],
      catalogue,
      { empty: "No booklets yet." },
    )}</div>`;
  }

  function filteredOrders() {
    return orders.filter((order) => {
      if (!matches(filters.q, fullName(order.student), order.student.userID, order.booklet.name, order.reference)) return false;
      if (filters.status === "review") return order.status === "pending";
      if (filters.status === "unpaid") return order.price - order.paid > 0 && order.status !== "rejected";
      if (filters.status === "undelivered") return !order.delivered && order.status !== "rejected";
      return true;
    });
  }

  function ordersTab() {
    return html`<div class="toolbar">
        <label class="search">${icon("search", 16)}<input type="search" id="order-search" placeholder="Student, booklet, transfer reference…" value="${filters.q}" aria-label="Search orders"></label>
        <select class="select-sm" id="order-status" aria-label="Filter"><option value="">All orders</option>
          <option value="review" ${filters.status === "review" ? html`selected` : ""}>Waiting for review</option>
          <option value="unpaid" ${filters.status === "unpaid" ? html`selected` : ""}>Not fully paid</option>
          <option value="undelivered" ${filters.status === "undelivered" ? html`selected` : ""}>Not delivered</option></select>
      </div>
      <div class="card card-flush" id="orders-table">${ordersTable()}</div>`;
  }

  function ordersTable() {
    return table(
      [
        { label: "Student", render: (order) => studentCell(order.student) },
        { label: "Booklet", render: (order) => order.booklet.name },
        { label: "Ordered", render: (order) => date(order.createdAt) },
        { label: "Payment", render: (order) => html`${money(order.paid)} / ${money(order.price)}<div class="muted small">${order.method === "transfer" ? `Transfer ${order.reference || ""}` : "At the center"}</div>` },
        { label: "Status", render: (order) => statusBadge(order.status) },
        { label: "Delivery", render: (order) => (order.delivered ? badge(`Delivered ${date(order.deliveredAt)}`, "success") : badge("Waiting", "warn")) },
        {
          label: "",
          className: "actions",
          render: (order) => html`${order.status === "pending" ? html`<button class="btn btn-sm btn-primary" data-action="review" data-id="${order._id}">Review</button>` : ""}
            ${order.status !== "rejected" ? html`<button class="btn btn-sm btn-secondary" data-action="pay" data-id="${order._id}">Payment</button>` : ""}
            ${!order.delivered && order.status !== "rejected" ? html`<button class="btn btn-sm btn-secondary" data-action="deliver" data-id="${order._id}">Deliver</button>` : ""}`,
        },
      ],
      filteredOrders(),
      { empty: "No orders match." },
    );
  }

  function render() {
    const outstanding = orders.filter((order) => order.status !== "rejected").reduce((total, order) => total + (order.price - order.paid), 0);
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Teaching",
        title: "Booklets",
        text: "Your printed material: stock, sales, payments and who still needs a copy. Undelivered booklets show up when the student is scanned.",
        actions: html`<button class="btn btn-secondary" data-action="assign">${icon("users")} Sell to a student</button><button class="btn btn-primary" data-action="create">${icon("plus")} New booklet</button>`,
      })}
      <section class="stats">
        ${statTile("Booklets", catalogue.length)}
        ${statTile("Waiting for review", orders.filter((order) => order.status === "pending").length, { tone: "accent" })}
        ${statTile("Not delivered", orders.filter((order) => !order.delivered && order.status !== "rejected").length)}
        ${statTile("Outstanding payments", money(outstanding), { tone: outstanding ? "danger" : "" })}
      </section>
      ${tabs([{ key: "catalogue", label: "Catalogue", count: catalogue.length }, { key: "orders", label: "Orders", count: orders.length }], tab)}
      <div id="tab-body">${tab === "orders" ? ordersTab() : catalogueTab()}</div>`,
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
  on(root, "input", "#order-search", (event, input) => {
    filters.q = input.value;
    mount($("#orders-table", root), ordersTable());
  });
  on(root, "change", "#order-status", (event, select) => {
    filters.status = select.value;
    mount($("#orders-table", root), ordersTable());
  });

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    const booklet = catalogue.find((item) => item._id === button.dataset.id);
    const order = orders.find((item) => item._id === button.dataset.id);
    if (action === "create" || action === "edit") {
      const saved = await formDialog({
        title: booklet ? "Edit booklet" : "New booklet",
        fields: bookletFields(booklet),
        onSubmit: (body) => (booklet ? api.teacher.updateBooklet(booklet._id, body) : api.teacher.createBooklet(body)),
      });
      if (saved) await reload("Booklet saved.");
    }
    if (action === "delete") {
      if (!(await confirmDialog(`Delete “${booklet.name}”?`, { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteBooklet(booklet._id)))) return;
      await reload("Booklet deleted.");
    }
    if (action === "assign") {
      const saved = await formDialog({
        title: "Sell a booklet to a student",
        fields: [
          { name: "student", label: "Student", type: "select", required: true, full: true, options: studentOptions(students) },
          { name: "booklet", label: "Booklet", type: "select", required: true, options: catalogue.map((b) => ({ value: b._id, label: `${b.name} · ${money(b.sellPrice)}` })) },
          { name: "price", label: "Price for this student", type: "number", min: 0, hint: "Leave empty for the normal price." },
          { name: "paid", label: "Paid now", type: "number", min: 0, value: 0 },
          { name: "delivered", label: "Handed over now", type: "checkbox" },
        ],
        onSubmit: (body) => api.teacher.createBookletOrder(body),
      });
      if (saved) await reload("Booklet sold.");
    }
    if (action === "review") {
      const { dialog, close } = openDialog({
        title: "Review transfer",
        eyebrow: `${fullName(order.student)} · ${order.booklet.name}`,
        body: html`<dl class="kv mb"><dt>Amount</dt><dd>${money(order.paid || order.price)}</dd><dt>Reference</dt><dd class="mono">${order.reference || "—"}</dd><dt>Method</dt><dd>${order.method === "transfer" ? "Transfer" : "Pay at the center"}</dd></dl>
          ${order.receiptUrl ? html`<img src="${order.receiptUrl}" alt="Transfer receipt" style="width:100%;border-radius:12px;border:1px solid var(--border)">` : html`<p class="muted">No receipt — the student will pay at the center.</p>`}`,
        actions: html`<button class="btn btn-danger" data-reject>Reject</button><button class="btn btn-primary" data-approve>Approve</button>`,
      });
      const decide = async (status, target) => {
        if (!(await withBusy(target, () => api.teacher.updateBookletOrder(order._id, { status })))) return;
        close();
        await reload(status === "verified" ? "Order approved." : "Order rejected.");
      };
      $("[data-approve]", dialog).addEventListener("click", (e) => decide("verified", e.currentTarget));
      $("[data-reject]", dialog).addEventListener("click", (e) => decide("rejected", e.currentTarget));
    }
    if (action === "pay") {
      const saved = await formDialog({
        title: "Booklet payment",
        eyebrow: `${fullName(order.student)} · ${order.booklet.name}`,
        fields: [
          { name: "price", label: "Price for this student", type: "number", min: 0, value: order.price },
          { name: "paid", label: "Total paid so far", type: "number", min: 0, value: order.paid },
        ],
        onSubmit: (body) => api.teacher.updateBookletOrder(order._id, body),
      });
      if (saved) await reload("Payment updated.");
    }
    if (action === "deliver") {
      if (!(await withBusy(button, () => api.teacher.updateBookletOrder(order._id, { delivered: true })))) return;
      await reload("Marked as delivered.");
    }
  });

  await load();
  render();
}
