import { icon } from "../../core/icons.js";
import { $, dateTime, fullName, html, money, mount, on, pageHeader, statTile, table, toast } from "../../core/ui.js";
import { txBadge } from "../shared/common.js";
import { activeTeacher, requireTeacher } from "./common.js";

export default async function studentWallet(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  let overview;
  let transactions = [];

  async function load() {
    [overview, transactions] = await Promise.all([api.student.overview(ctx.teacherId), api.student.transactions(ctx.teacherId)]);
  }

  function render() {
    const teacher = activeTeacher(ctx) || overview.teacher;
    mount(
      root,
      html`${pageHeader({ eyebrow: "Account", title: "Wallet", text: `Your balance with ${fullName(teacher)}. Each session you attend is paid from it.` })}
      <section class="stats">
        ${statTile("Balance", money(overview.balance), { tone: overview.balance < 0 ? "danger" : "accent" })}
        ${statTile("Session price", money(overview.pricePerSession))}
        ${statTile("Sessions covered", overview.pricePerSession ? Math.max(0, Math.floor(overview.balance / overview.pricePerSession)) : "—")}
      </section>
      <div class="grid grid-2 mb">
        <section class="card card-accent">
          <div class="card-head"><div><p class="eyebrow">Option 1</p><h3>Recharge code</h3></div>${icon("qr")}</div>
          <p class="muted small">Bought a recharge card from the center or bookshop? Type the code here.</p>
          <form id="recharge-form" class="row"><label class="sr-only" for="recharge-code">Recharge code</label>
            <input id="recharge-code" class="input mono" style="flex:1;min-width:160px;text-transform:uppercase" placeholder="LC-XXXXXX" autocomplete="off" required>
            <button class="btn btn-primary" type="submit">Add balance</button></form>
        </section>
        <section class="card">
          <div class="card-head"><div><p class="eyebrow">Option 2</p><h3>Transfer receipt</h3></div>${icon("upload")}</div>
          <p class="muted small">Sent money by Vodafone Cash or InstaPay? Upload the receipt — your teacher checks it and adds the balance.</p>
          <form id="topup-form" class="form-grid">
            <div class="field"><label for="tp-amount">Amount</label><input id="tp-amount" type="number" min="1" required></div>
            <div class="field"><label for="tp-method">Method</label><select id="tp-method"><option>Vodafone Cash</option><option>InstaPay</option><option>Bank transfer</option></select></div>
            <div class="field"><label for="tp-ref">Reference number</label><input id="tp-ref" placeholder="From the receipt"></div>
            <div class="field"><label for="tp-file">Receipt screenshot</label><input id="tp-file" type="file" accept="image/*" required></div>
            <div class="field-full"><button class="btn btn-secondary" type="submit">Send for review</button></div>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><div><p class="eyebrow">Option 3</p><h3>Cash at the door</h3></div></div>
          <p class="muted small" style="margin:0">Pay cash when you check in — the assistant adds it to your balance on the spot.</p>
        </section>
      </div>
      <section class="card card-flush"><div class="card-head"><h3>Statement</h3></div>${table(
        [
          { label: "Date", render: (tx) => dateTime(tx.createdAt) },
          { label: "Type", render: (tx) => txBadge(tx.type) },
          { label: "Details", render: (tx) => tx.reason },
          { label: "Amount", className: "num", render: (tx) => html`<span class="${tx.amount < 0 ? "text-danger" : "text-success"} strong">${tx.amount > 0 ? "+" : ""}${money(tx.amount)}</span>` },
        ],
        transactions,
        { empty: "No transactions yet." },
      )}</section>`,
    );
  }

  on(root, "submit", "#recharge-form", async (event, form) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await api.student.recharge($("#recharge-code", root).value.trim().toUpperCase());
      toast(`${money(result.amount)} added with ${fullName(result.teacher)}. New balance ${money(result.balance)}.`);
      await load();
      render();
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
  });
  on(root, "submit", "#topup-form", async (event, form) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const file = $("#tp-file", root).files[0];
    button.disabled = true;
    try {
      const { url } = await api.upload(file);
      await api.student.topup(ctx.teacherId, { amount: Number($("#tp-amount", root).value), method: $("#tp-method", root).value, reference: $("#tp-ref", root).value.trim(), receiptUrl: url });
      toast("Receipt sent. Your balance updates when your teacher approves it.");
      form.reset();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  await load();
  render();
}
