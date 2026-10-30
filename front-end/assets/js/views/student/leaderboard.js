import { badge, html, mount, pageHeader, statTile, table } from "../../core/ui.js";
import { rankBadge } from "../teacher/leaderboard.js";
import { requireTeacher } from "./common.js";

export default async function studentLeaderboard(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  const rows = (await api.student.leaderboard(ctx.teacherId)) || [];
  const mine = rows.find((row) => row.isMe);

  mount(
    root,
    html`${pageHeader({ eyebrow: "Account", title: "Leaderboard", text: "Earn points by answering video questions correctly and when your teacher rewards you." })}
    ${mine ? html`<section class="stats">${statTile("Your rank", `${mine.rank} / ${rows.length}`, { tone: "accent" })}${statTile("Your points", mine.points)}</section>` : ""}
    <div class="card card-flush">${table(
      [
        { label: "Rank", render: (row) => rankBadge(row.rank) },
        { label: "Student", render: (row) => html`<strong>${row.name}</strong> ${row.isMe ? badge("You", "accent") : ""}` },
        { label: "Center", render: (row) => row.centerName || "—" },
        { label: "Points", className: "num", render: (row) => html`<strong>${row.points}</strong>` },
      ],
      rows,
      { empty: "No points yet.", rowAttrs: (row) => (row.isMe ? 'style="background:var(--accent-soft)"' : "") },
    )}</div>`,
  );
}
