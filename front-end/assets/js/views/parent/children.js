import { STORAGE_KEYS } from "../../core/config.js";
import { icon } from "../../core/icons.js";
import { avatar, badge, confirmDialog, emptyState, formDialog, fullName, gradeLabel, html, mount, on, pageHeader, toast, withBusy } from "../../core/ui.js";

export default async function parentChildren(ctx) {
  const { root, api, me, reloadMe, navigate } = ctx;
  const children = me.children || [];

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Family",
      title: "My children",
      text: `Children are linked with their student code. Their account must list ${me.person.phone} as the parent phone.`,
      actions: html`<button class="btn btn-primary" data-action="add">${icon("plus")} Add a child</button>`,
    })}
    ${children.length
      ? html`<div class="tile-grid">${children.map(
          (child) => html`<article class="tile">
            <div class="person">${avatar(child, "lg")}<div><strong>${fullName(child)}</strong><span>${child.userID} · ${gradeLabel(child.grade)}</span></div></div>
            <div class="status-chips">${(child.teachers || []).map((teacher) => badge(`${fullName(teacher)} · ${(teacher.subject || []).join(", ")}`, "accent"))}${(child.teachers || []).length ? "" : badge("No teachers yet", "muted")}</div>
            <div class="tile-foot"><button class="btn btn-sm btn-ghost" data-action="remove" data-id="${child._id}">Unlink</button><button class="btn btn-sm btn-primary" data-action="open" data-id="${child._id}">Follow</button></div>
          </article>`,
        )}</div>`
      : html`<div class="card">${emptyState("No children linked yet", "Ask your child for their student code (it starts with STU-).")}</div>`}`,
  );

  on(root, "click", "[data-action]", async (event, button) => {
    const action = button.dataset.action;
    if (action === "add") {
      const saved = await formDialog({
        title: "Add a child",
        fields: [{ name: "code", label: "Student code", required: true, full: true, placeholder: "STU-000123" }],
        submitLabel: "Link child",
        onSubmit: (body) => api.parent.linkChild(body),
      });
      if (saved) {
        toast(`${fullName(saved)} linked.`);
        await reloadMe();
      }
    }
    if (action === "remove") {
      if (!(await confirmDialog("Stop following this child?", { confirmLabel: "Unlink", danger: true }))) return;
      if (!(await withBusy(button, () => api.parent.unlinkChild(button.dataset.id)))) return;
      await reloadMe();
    }
    if (action === "open") {
      localStorage.setItem(STORAGE_KEYS.activeChild, button.dataset.id);
      await reloadMe();
      navigate("#/home");
    }
  });
}
