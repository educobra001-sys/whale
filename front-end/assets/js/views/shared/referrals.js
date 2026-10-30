import { date, fullName, html, money, mount, pageHeader, statTile, table, toast, on, badge } from "../../core/ui.js";

export default async function referrals(ctx) {
  const { root, api, role } = ctx;
  const [data, telegram] = await Promise.all([
    api.me.referral(),
    ["student", "parent"].includes(role) ? api.me.telegram().catch(() => []) : [],
  ]);

  mount(
    root,
    html`${pageHeader({
      eyebrow: "Marketing",
      title: "Your EduCobra ID",
      text: "Share this ID with EduCobra when you bring a teacher to the platform. You earn an agreed amount for every active student of that teacher, every month.",
    })}
    <section class="card card-accent mb">
      <div class="row-between"><div><p class="eyebrow">Marketing ID</p><p class="code">${data.referralId}</p></div>
      <button class="btn btn-secondary" data-action="copy">Copy</button></div>
    </section>
    <section class="stats">
      ${statTile("Earned", money(data.totals.earned), { tone: "accent" })}
      ${statTile("Waiting for payment", money(data.totals.due))}
      ${statTile("Paid to you", money(data.totals.paid))}
      ${statTile("Teachers", data.deals.length)}
    </section>
    <div class="stack">
      <section class="card card-flush"><div class="card-head"><h3>Your teachers</h3></div>${table(
        [
          { label: "Teacher", render: (row) => fullName(row.teacher) },
          { label: "Per active student", className: "num", render: (row) => money(row.ratePerStudent) },
          { label: "Since", render: (row) => date(row.since) },
        ],
        data.deals,
        { empty: "No teacher is linked to your ID yet." },
      )}</section>
      <section class="card card-flush"><div class="card-head"><h3>Monthly earnings</h3></div>${table(
        [
          { label: "Month", render: (row) => row.month },
          { label: "Teacher", render: (row) => fullName(row.teacher) },
          { label: "Active students", className: "num", render: (row) => row.activeStudents },
          { label: "Amount", className: "num", render: (row) => money(row.amount) },
          { label: "Status", render: (row) => badge(row.status === "paid" ? "Paid" : "Due", row.status === "paid" ? "success" : "warn") },
        ],
        data.earnings,
        { empty: "Earnings appear after the first month closes." },
      )}</section>
      ${telegram.length
        ? html`<section class="card"><div class="card-head"><h3>Telegram notifications</h3></div>
            <p class="muted small mb">Link Telegram to receive attendance and absence messages.</p>
            <ul class="list">${telegram.map((row) => html`<li class="list-item"><span class="grow strong">${fullName(row.student)}</span>
              ${row.linked ? badge("Linked", "success") : row.url ? html`<a class="btn btn-sm btn-primary" href="${row.url}" target="_blank" rel="noopener">Link Telegram</a>` : html`<span class="muted small">Bot not configured yet</span>`}</li>`)}</ul></section>`
        : ""}
    </div>`,
  );
  on(root, "click", "[data-action=copy]", async () => {
    await navigator.clipboard?.writeText(data.referralId).catch(() => undefined);
    toast("Copied.");
  });
}

