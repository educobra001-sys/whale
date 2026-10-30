import { badge, date, html, lineChart, mount, pageHeader, statTile, table } from "../../core/ui.js";
import { requireTeacher } from "./common.js";

export function examsChart(rows) {
  const scored = rows.filter((row) => row.score !== null).slice(0, 10).reverse();
  return lineChart(
    [
      { name: "You", points: scored.map((row) => ({ label: row.exam.name.slice(0, 12), value: (row.score / row.exam.maxScore) * 100 })) },
      { name: "Class average", points: scored.map((row) => ({ label: row.exam.name.slice(0, 12), value: (row.stats.avg / row.exam.maxScore) * 100 })) },
    ],
    { empty: "Your exam results will appear here." },
  );
}

export function examsTable(rows) {
  return table(
    [
      { label: "Exam", render: (row) => html`<strong>${row.exam.name}</strong>` },
      { label: "Date", render: (row) => date(row.exam.date) },
      { label: "Score", className: "num", render: (row) => (row.score === null ? badge("Absent", "danger") : html`<strong>${row.score}</strong> / ${row.exam.maxScore}`) },
      { label: "%", className: "num", render: (row) => (row.score === null ? "—" : `${Math.round((row.score / row.exam.maxScore) * 100)}%`) },
      { label: "Rank", className: "num", render: (row) => (row.rank ? `${row.rank} / ${row.participants}` : "—") },
      { label: "Highest · Average", className: "num", render: (row) => `${row.stats.max} · ${row.stats.avg}` },
    ],
    rows,
    { empty: "No exams yet." },
  );
}

export default async function studentExams(ctx) {
  if (!requireTeacher(ctx)) return;
  const { root, api } = ctx;
  const rows = (await api.student.exams(ctx.teacherId)) || [];
  const scored = rows.filter((row) => row.score !== null);
  const average = scored.length ? Math.round(scored.reduce((total, row) => total + (row.score / row.exam.maxScore) * 100, 0) / scored.length) : 0;
  const best = scored.reduce((top, row) => (!top || row.score / row.exam.maxScore > top.score / top.exam.maxScore ? row : top), null);

  mount(
    root,
    html`${pageHeader({ eyebrow: "Learning", title: "Exams", text: "Your scores, your rank in the class and how you compare to the class average." })}
    <section class="stats">
      ${statTile("Your average", `${average}%`, { tone: "accent" })}
      ${statTile("Exams taken", scored.length)}
      ${statTile("Best result", best ? `${Math.round((best.score / best.exam.maxScore) * 100)}%` : "—", { hint: best?.exam.name || "" })}
    </section>
    <section class="card mb"><div class="card-head"><h3>Progress</h3></div>${examsChart(rows)}</section>
    <div class="card card-flush">${examsTable(rows)}</div>`,
  );
}
