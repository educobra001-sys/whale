import { icon } from "../../core/icons.js";
import { fullName, html, money, mount, pageHeader, statTile, table } from "../../core/ui.js";

export default async function ownerDashboard(ctx) {
  const { root, api } = ctx;
  const data = await api.owner.dashboard();
  const { counts } = data;

  mount(
    root,
    html`${pageHeader({
      eyebrow: "EduCobra",
      title: "Platform overview",
      text: `Everything happening on the platform in ${data.month}.`,
    })}
    ${counts.pendingTeachers ? html`<div class="notice mb row-between"><span><strong>${counts.pendingTeachers}</strong> teacher${counts.pendingTeachers > 1 ? "s" : ""} waiting for your approval.</span><a class="btn btn-sm btn-primary" href="#/teachers?status=pending_approval">Review</a></div>` : ""}
    ${counts.pendingCenters ? html`<div class="notice mb row-between"><span><strong>${counts.pendingCenters}</strong> center${counts.pendingCenters > 1 ? "s" : ""} waiting for your approval.</span><a class="btn btn-sm btn-primary" href="#/centers">Review</a></div>` : ""}
    ${counts.pendingAds ? html`<div class="notice mb row-between"><span><strong>${counts.pendingAds}</strong> ad${counts.pendingAds > 1 ? "s" : ""} asking to appear outside their course.</span><a class="btn btn-sm btn-primary" href="#/ads">Review</a></div>` : ""}
    <section class="stats">
      ${statTile("Active teachers", counts.teachers, { icon: icon("users", 15), hint: `${counts.pendingEmail} verifying email` })}
      ${statTile("Students", counts.students, { icon: icon("user", 15), hint: `${counts.enrollments} enrollments` })}
      ${statTile("Active this month", counts.activeStudents, { icon: icon("check", 15) })}
      ${statTile("Centers", counts.centers, { icon: icon("building", 15) })}
      ${statTile("Expected this month", money(data.estimate), { tone: "accent", icon: icon("chart", 15) })}
      ${statTile("Affiliates due", money(data.affiliatesDue), { icon: icon("link", 15) })}
    </section>
    <section class="card card-flush"><div class="card-head"><h3>Top teachers this month</h3><a class="btn btn-ghost btn-sm" href="#/teachers">All →</a></div>${table(
      [
        { label: "Teacher", render: (row) => html`<a href="#/teachers/${row._id}" class="strong">${fullName(row)}</a>` },
        { label: "Active", className: "num", render: (row) => row.activeStudents },
        { label: "Total students", className: "num", render: (row) => row.totalStudents },
        { label: "Per student", className: "num", render: (row) => money(row.pricePerStudent) },
        { label: "Expected", className: "num", render: (row) => money(row.estimate) },
      ],
      data.top,
      { empty: "No teachers yet." },
    )}</section>`,
  );
}
