// Helpers shared by several views.
import { api } from "../../core/api.js";
import { GRADES } from "../../core/config.js";
import { avatar, badge, fullName, html, money } from "../../core/ui.js";

export const gradeOptions = GRADES.map((label, index) => ({ value: String(index), label }));

export function personCell(person, { href = "", sub = "", size = "sm" } = {}) {
  const body = html`${avatar(person, size)}<div><strong>${fullName(person)}</strong>${sub ? html`<span>${sub}</span>` : ""}</div>`;
  return href ? html`<a class="person" href="${href}">${body}</a>` : html`<div class="person">${body}</div>`;
}

export const studentHref = (student) => `#/students/${student?._id ?? student}`;

export function studentCell(student, sub) {
  return personCell(student, { href: studentHref(student), sub: sub ?? student?.userID ?? "" });
}

export function balanceText(value) {
  const number = Number(value || 0);
  return html`<span class="${number < 0 ? "text-danger strong" : number === 0 ? "muted" : "strong"}">${money(number)}</span>`;
}

const TX_TYPES = {
  attendance: ["Session", "muted"],
  payment: ["Payment", "success"],
  recharge: ["Recharge code", "success"],
  topup: ["Transfer", "success"],
  refund: ["Refund", "info"],
  adjustment: ["Adjustment", "warn"],
  lesson: ["Lesson", "accent"],
  booklet: ["Booklet", "accent"],
};
export function txBadge(type) {
  const [label, tone] = TX_TYPES[type] || [type, "muted"];
  return badge(label, tone);
}

export function accessBadge(access) {
  const map = {
    free: ["Free", "success"],
    granted: ["Unlocked", "success"],
    available: ["Free for attendees", "info"],
    locked: ["Locked", "muted"],
    expired: ["Expired", "danger"],
    exhausted: ["No views left", "danger"],
  };
  const [label, tone] = map[access?.state] || ["—", "muted"];
  return badge(label, tone);
}

export function statusBadge(status) {
  const map = {
    present: ["Present", "success"],
    absent: ["Absent", "danger"],
    cancelled: ["Cancelled", "muted"],
    pending: ["Pending", "warn"],
    active: ["Active", "success"],
    approved: ["Approved", "success"],
    verified: ["Verified", "success"],
    rejected: ["Rejected", "danger"],
    accepted: ["Accepted", "success"],
  };
  const [label, tone] = map[status] || [status || "—", "muted"];
  return badge(label, tone);
}

let centersPromise = null;
export function teacherCenters({ fresh = false } = {}) {
  if (!centersPromise || fresh) {
    centersPromise = api.teacher
      .centers()
      .then((links) => (links || []).filter((link) => link.status === "active").map((link) => link.center))
      .catch(() => []);
  }
  return centersPromise;
}

export async function centerOptions() {
  const centers = await teacherCenters();
  return centers.map((center) => ({ value: center._id, label: center.name }));
}

export function studentOptions(students) {
  return students
    .slice()
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((student) => ({ value: student._id, label: `${fullName(student)} · ${student.userID || ""}` }));
}

export function matches(query, ...values) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

export function durationText(seconds) {
  const total = Math.round(Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
}

// Turns YouTube / Vimeo / Google Drive share links into embeddable URLs; leaves other URLs untouched.
export function embedUrl(url) {
  const text = String(url || "").trim();
  const youtube = text.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/);
  if (youtube) return `https://www.youtube.com/embed/${youtube[1]}?rel=0&modestbranding=1`;
  const vimeo = text.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const drive = text.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return text;
}

export const isDirectVideo = (url) => /\.(mp4|webm|ogg)(\?|$)/i.test(String(url || "")) || String(url || "").startsWith("blob:");

export function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}
