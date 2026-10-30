import { icon } from "../../core/icons.js";
import { $, badge, emptyState, html, money, mount, on, openDialog, pageHeader, toast } from "../../core/ui.js";
import { statusBadge } from "../shared/common.js";
import { requireTeacher } from "./common.js";

export default async function studentBooklets(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  let list = [];

  async function load() {
    list = (await api.student.booklets(ctx.teacherId)) || [];
  }

  function render() {
    mount(
      root,
      html`${pageHeader({ eyebrow: "Learning", title: "Booklets", text: "Reserve your booklet, pay at the center or by transfer, and pick it up when you check in." })}
      ${list.length
        ? html`<div class="tile-grid">${list.map(({ booklet, order }) => {
            const remaining = order ? order.price - order.paid : booklet.sellPrice;
            return html`<article class="tile">
              <div class="row-between"><h3>${booklet.name}</h3>${badge(money(booklet.sellPrice), "accent")}</div>
              ${order
                ? html`<div class="status-chips">${statusBadge(order.status)}${order.delivered ? badge("Received ✓", "success") : badge("Not received yet", "warn")}${remaining > 0 && order.status !== "rejected" ? badge(`${money(remaining)} left to pay`, "danger") : order.status !== "rejected" ? badge("Fully paid", "success") : ""}</div>
                  ${order.paid ? html`<div class="meter meter-success"><span style="width:${Math.min(100, (order.paid / order.price) * 100)}%"></span></div>` : ""}
                  <p class="small">${order.method === "transfer" ? "Paid by transfer" : "Pay at the center"}${order.status === "pending" ? " · waiting for the teacher to confirm" : ""}</p>`
                : html`<p>${booklet.stock > 0 ? "Available" : "Out of stock — reserve now and get it in the next print."}</p>`}
              <div class="tile-foot"><span></span>${!order || order.status === "rejected" ? html`<button class="btn btn-sm btn-primary" data-action="reserve" data-id="${booklet._id}">${icon("book", 14)} ${order ? "Reserve again" : "Reserve"}</button>` : ""}</div>
            </article>`;
          })}</div>`
        : html`<div class="card">${emptyState("No booklets available")}</div>`}`,
    );
  }

  function reserveDialog(booklet) {
    const { dialog, close } = openDialog({
      title: `Reserve “${booklet.name}”`,
      eyebrow: money(booklet.sellPrice),
      body: html`<p class="strong">How will you pay?</p>
        <div class="choice-grid mb">
          <label class="answer-option"><input type="radio" name="method" value="center" checked> 🏫 At the center</label>
          <label class="answer-option"><input type="radio" name="method" value="transfer"> 📱 Vodafone Cash / InstaPay</label>
        </div>
        <div id="transfer-fields" hidden class="form-grid single">
          <div class="field"><label for="bk-receipt">Transfer receipt (screenshot)</label><input id="bk-receipt" type="file" accept="image/*"></div>
          <div class="field"><label for="bk-ref">Transaction reference</label><input id="bk-ref" placeholder="From the receipt"></div>
        </div>
        <p class="form-error" hidden></p>`,
      actions: html`<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" data-confirm>Confirm reservation</button>`,
    });
    dialog.addEventListener("change", () => {
      $("#transfer-fields", dialog).hidden = dialog.querySelector("input[name=method]:checked").value !== "transfer";
    });
    $("[data-confirm]", dialog).addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const error = $(".form-error", dialog);
      const method = dialog.querySelector("input[name=method]:checked").value;
      try {
        button.disabled = true;
        let receiptUrl = "";
        if (method === "transfer") {
          const file = $("#bk-receipt", dialog).files[0];
          if (!file) throw new Error("Upload the transfer receipt first.");
          receiptUrl = (await api.upload(file)).url;
        }
        await api.student.reserveBooklet(booklet._id, { method, receiptUrl, reference: $("#bk-ref", dialog).value.trim() });
        close();
        toast("Booklet reserved.");
        await load();
        render();
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        button.disabled = false;
      }
    });
  }

  on(root, "click", "[data-action=reserve]", (event, button) => reserveDialog(list.find((item) => item.booklet._id === button.dataset.id).booklet));

  await load();
  render();
}
