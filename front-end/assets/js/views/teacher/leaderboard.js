import { icon } from "../../core/icons.js";
import { $, formDialog, html, mount, on, pageHeader, table, toast } from "../../core/ui.js";
import { studentCell } from "../shared/common.js";

export function rankBadge(rank) {
  return html`<span class="rank ${rank <= 3 ? `rank-${rank}` : ""}">${rank}</span>`;
}

export default async function leaderboard(ctx) {
  const { root, api, can } = ctx;
  let rows = (await api.teacher.leaderboard()) || [];
  let center = "";
  const centers = [...new Set(rows.map((row) => row.centerName).filter(Boolean))];

  const visible = () => rows.filter((row) => !center || row.centerName === center);

  function body() {
    return html`<div class="card card-flush">${table(
      [
        { label: "Rank", render: (row) => rankBadge(row.rank) },
        { label: "Student", render: (row) => studentCell(row.student) },
        { label: "Center", render: (row) => row.centerName || "—" },
        { label: "Points", className: "num", render: (row) => html`<strong>${row.points}</strong>` },
        { label: "", className: "actions", render: (row) => (can("students_balance") ? html`<button class="btn btn-sm btn-ghost" data-action="points" data-id="${row.student._id}">${icon("plus", 14)} Points</button>` : "") },
      ],
      visible(),
      { empty: "No points yet. Students earn points from video questions and from you." },
    )}</div>`;
  }

  mount(
    root,
    html`${pageHeader({ eyebrow: "Engagement", title: "Leaderboard", text: "Points motivate students: they earn them from correct video answers and when you reward them. Students see their rank (with first names only)." })}
    ${centers.length > 1 ? html`<div class="toolbar"><select class="select-sm" id="lb-center" aria-label="Center"><option value="">All centers</option>${centers.map((name) => html`<option>${name}</option>`)}</select></div>` : ""}
    <div id="lb-body">${body()}</div>`,
  );

  on(root, "change", "#lb-center", (event, select) => {
    center = select.value;
    mount($("#lb-body", root), body());
  });
  on(root, "click", "[data-action=points]", async (event, button) => {
    const saved = await formDialog({
      title: "Add points",
      fields: [
        { name: "points", label: "Points (negative to remove)", type: "number", required: true },
        { name: "reason", label: "Reason", full: true },
      ],
      onSubmit: (values) => api.teacher.addPoints(button.dataset.id, values),
    });
    if (saved) {
      rows = await api.teacher.leaderboard();
      mount($("#lb-body", root), body());
      toast("Points updated.");
    }
  });
}
