import { icon } from "../../core/icons.js";
import { badge, debounce, emptyState, fullName, html, mount, on, pageHeader, table } from "../../core/ui.js";

const MESSAGING_FEATURES = ["whatsapp", "telegram"];
const CHANNELS = ["telegram", "whatsapp_api", "whatsapp_web", "whatsapp_link"];

// Why a teacher does or doesn't see "Messages" in their own account.
function teacherAccess(teacher) {
  const plan = (teacher.features || []).some((key) => MESSAGING_FEATURES.includes(key));
  const channel = CHANNELS.some((key) => teacher.channels?.[key]);
  if (plan && channel) return badge("Visible to the teacher", "success");
  if (!plan) return badge("Hidden: plan has no WhatsApp/Telegram", "warn");
  return badge("Hidden: no channel switched on", "warn");
}

// The owner's way into messages: pick a teacher, then write to their students.
export default async function ownerSendMessages(ctx) {
  const { root, api } = ctx;
  const teachers = await api.owner.teachers({ status: "active" });
  let search = "";

  function list() {
    const rows = teachers.filter((row) => !search || `${fullName(row)} ${row.email} ${row.phone}`.toLowerCase().includes(search));
    return table(
      [
        { label: "Teacher", render: (row) => html`<strong>${fullName(row)}</strong><br><span class="muted small">${row.email}</span>` },
        { label: "Students", className: "num", render: (row) => row.totalStudents ?? 0 },
        { label: "Teacher's own page", render: (row) => html`${teacherAccess(row)}<br><a class="small" href="#/teachers/${row._id}">Change plan or channels</a>` },
        { label: "", render: (row) => html`<a class="btn btn-primary btn-sm" href="#/teachers/${encodeURIComponent(row._id)}/messages">${icon("megaphone", 15)} Write messages</a>` },
      ],
      rows,
      { empty: "No teacher matches." },
    );
  }

  mount(root, html`${pageHeader({
    eyebrow: "Control",
    title: "Send messages",
    text: "Choose a teacher to write to their students or parents: attendance, absence or an announcement, by WhatsApp or Telegram.",
  })}
  ${teachers.length
    ? html`<section class="card card-flush">
        <div class="card-head"><h3>Active teachers</h3><input id="teacher-search" class="input-sm" type="search" placeholder="Search teachers" aria-label="Search teachers" style="max-width:240px"></div>
        <div id="teacher-list">${list()}</div>
      </section>
      <p class="muted small mt">A teacher sees Messages in their own account when their plan has the WhatsApp or Telegram section and you switched on a channel on their page. You can always write for them from here.</p>`
    : emptyState("No active teachers yet", "Approve a teacher first, then you can message their students from here.")}`);

  return on(root, "input", "#teacher-search", debounce((event) => {
    search = event.target.value.trim().toLowerCase();
    mount(root.querySelector("#teacher-list"), list());
  }, 200));
}
