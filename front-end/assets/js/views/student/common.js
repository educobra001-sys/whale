import { emptyState, fullName, html, mount } from "../../core/ui.js";

// Student pages are scoped to the teacher picked in the top bar. Returns false (and shows a prompt) when
// the student isn't subscribed to anyone yet.
export function requireTeacher(ctx) {
  if (ctx.teacherId) return true;
  const pending = (ctx.me.teachers || []).filter((entry) => entry.status === "pending");
  mount(
    ctx.root,
    html`<div class="card">${emptyState(
      pending.length ? "Waiting for approval" : "Join your first teacher",
      pending.length
        ? `Your request to ${pending.map((entry) => fullName(entry.teacher)).join(", ")} is waiting for approval. You'll see everything here once accepted.`
        : "Find your teacher in the directory and send a join request. Your sessions, lessons, homework and wallet appear here once they accept.",
      html`<a class="btn btn-primary" href="#/teachers">Find teachers</a>`,
    )}</div>`,
  );
  return false;
}

export function activeTeacher(ctx) {
  return (ctx.me.teachers || []).find((entry) => String(entry.teacher._id) === String(ctx.teacherId))?.teacher;
}
