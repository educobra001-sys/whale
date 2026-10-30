import { $, html, money, mount, on, pageHeader, table, tabs, toast, withBusy } from "../../core/ui.js";

export default async function ownerPlans(ctx) {
  const { root, api, query, setQuery } = ctx;
  let tab = query.tab || "build";
  const [features, teachers] = await Promise.all([api.owner.features(), api.owner.teachers({})]);
  let email = query.email || "";
  const current = teachers.find((teacher) => teacher.email === email);
  let selected = new Set(current?.features || []);

  const total = () => features.filter((feature) => selected.has(feature.key)).reduce((sum, feature) => sum + feature.price, 0);

  function buildTab() {
    return html`<section class="card">
      <div class="card-head"><div><h3>Sections for this teacher</h3><p class="muted small">Anything left unticked won't be available to them.</p></div>
        <div class="row"><button class="btn btn-ghost btn-sm" type="button" data-action="all">All</button><button class="btn btn-ghost btn-sm" type="button" data-action="none">None</button></div></div>
      <ul class="list">${features.map((feature) => html`<li class="list-item"><label class="check grow"><input type="checkbox" data-feature="${feature.key}" ${selected.has(feature.key) ? html`checked` : ""}> <span><strong>${feature.name}</strong><br><span class="muted small">${feature.description}</span></span></label><span class="strong nowrap">${money(feature.price)}</span></li>`)}</ul>
      <div class="plan-total row-between mt"><span>Price per student</span><strong id="plan-total">${money(total())}</strong></div>
      <div class="form-grid mt">
        <div class="field field-full"><label for="plan-email">Teacher email</label>
          <input id="plan-email" type="email" list="teacher-emails" value="${email}" placeholder="teacher@example.com" autocomplete="off">
          <datalist id="teacher-emails">${teachers.map((teacher) => html`<option value="${teacher.email}"></option>`)}</datalist></div>
        <div class="field-full row"><button class="btn btn-primary" type="button" data-action="confirm">Confirm plan</button></div>
      </div>
    </section>`;
  }

  function pricesTab() {
    return html`<section class="card card-flush">${table(
      [
        { label: "Section", render: (row) => html`<strong>${row.name}</strong><br><span class="muted small">${row.description}</span>` },
        { label: "Price per student", render: (row) => html`<input class="input-sm" type="number" min="0" step="0.01" value="${row.price}" data-price="${row._id}" aria-label="Price of ${row.name}">` },
        { label: "", render: (row) => html`<button class="btn btn-secondary btn-sm" type="button" data-save="${row._id}">Save</button>` },
      ],
      features,
    )}</section>`;
  }

  function render() {
    mount(root, html`${pageHeader({ eyebrow: "EduCobra", title: "Plans & sections", text: "Every section has a price. A teacher's price per student is the sum of the sections you tick." })}
      ${tabs([{ key: "build", label: "Build a plan" }, { key: "prices", label: "Section prices" }], tab)}
      <div class="mt">${tab === "build" ? buildTab() : pricesTab()}</div>`);
  }

  const stops = [
    on(root, "click", "[data-tab]", (event, button) => {
      tab = button.dataset.tab;
      setQuery({ tab });
      render();
    }),
    on(root, "change", "[data-feature]", (event, box) => {
      if (box.checked) selected.add(box.dataset.feature);
      else selected.delete(box.dataset.feature);
      $("#plan-total", root).textContent = money(total());
    }),
    on(root, "input", "#plan-email", (event, input) => {
      email = input.value.trim();
    }),
    on(root, "change", "#plan-email", (event, input) => {
      const found = teachers.find((teacher) => teacher.email === input.value.trim());
      if (found) {
        selected = new Set(found.features);
        email = found.email;
        render();
      }
    }),
    on(root, "click", "[data-action]", async (event, button) => {
      const action = button.dataset.action;
      if (action === "all" || action === "none") {
        selected = new Set(action === "all" ? features.map((feature) => feature.key) : []);
        render();
      }
      if (action === "confirm") {
        if (!email) return toast("Enter the teacher's email.", "error");
        const result = await withBusy(button, () => api.owner.confirmPlan({ email, features: [...selected] }));
        if (result) toast(`Plan set for ${result.teacher}: ${money(result.pricePerStudent)} per student.`);
      }
      return undefined;
    }),
    on(root, "click", "[data-save]", async (event, button) => {
      const input = $(`[data-price="${button.dataset.save}"]`, root);
      const saved = await withBusy(button, () => api.owner.updateFeature(button.dataset.save, { price: Number(input.value) }), "Price saved.");
      if (saved) features.find((feature) => feature._id === saved._id).price = saved.price;
    }),
  ];
  render();
  return () => stops.forEach((stop) => stop());
}

