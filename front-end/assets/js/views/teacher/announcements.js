import { icon } from "../../core/icons.js";
import { badge, confirmDialog, date, emptyState, formDialog, gradeLabel, html, mount, on, pageHeader, toast, withBusy } from "../../core/ui.js";
import { centerOptions, embedUrl, gradeOptions } from "../shared/common.js";

export function announcementCard(item, { actions = "" } = {}) {
  const video = item.videoUrl ? embedUrl(item.videoUrl) : "";
  return html`<article class="tile">
    ${item.imageUrl ? html`<div class="tile-media"><img src="${item.imageUrl}" alt=""></div>` : ""}
    <div class="row-between"><h3>${item.title}</h3><span class="status-chips">${item.pinned ? badge("Pinned", "accent") : ""}${item.isActive === false ? badge("Hidden", "muted") : ""}</span></div>
    ${item.body ? html`<p style="white-space:pre-line">${item.body}</p>` : ""}
    ${video ? html`<div class="video-frame"><iframe src="${video}" title="${item.title}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : ""}
    ${item.linkUrl ? html`<a href="${item.linkUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary">Open link ↗</a>` : ""}
    <div class="tile-foot"><span class="muted small">${date(item.createdAt)}</span>${actions}</div>
  </article>`;
}

export default async function announcements(ctx) {
  const { root, api } = ctx;
  const centers = await centerOptions();
  let list = [];

  const fields = (values = {}) => [
    { name: "title", label: "Title", required: true, full: true, value: values.title },
    { name: "body", label: "Message", type: "textarea", full: true, rows: 4, value: values.body },
    { name: "image", label: "Image", type: "file", accept: "image/*", hint: values.imageUrl ? "Leave empty to keep the current image." : "" },
    { name: "imageUrl", label: "…or image link", type: "url", value: values.imageUrl },
    { name: "videoUrl", label: "Video link", type: "url", value: values.videoUrl, hint: "YouTube, Vimeo or Drive" },
    { name: "linkUrl", label: "Button link", type: "url", value: values.linkUrl, hint: "e.g. a registration form" },
    { name: "grades", label: "Show to grades (none = everyone)", type: "checkboxes", options: gradeOptions, value: values.audience?.grades || [] },
    ...(centers.length ? [{ name: "centers", label: "Show to centers (none = everyone)", type: "checkboxes", options: centers, value: values.audience?.centers || [] }] : []),
    { name: "pinned", label: "Pin to the top", type: "checkbox", checked: values.pinned },
    { name: "isActive", label: "Visible to students", type: "checkbox", checked: values.isActive !== false },
  ];

  async function toBody(values) {
    let imageUrl = values.imageUrl;
    if (values.image && values.image.size) imageUrl = (await api.upload(values.image)).url;
    return {
      title: values.title,
      body: values.body,
      imageUrl,
      videoUrl: values.videoUrl,
      linkUrl: values.linkUrl,
      audience: { grades: values.grades || [], centers: values.centers || [] },
      pinned: values.pinned,
      isActive: values.isActive,
    };
  }

  async function load() {
    list = (await api.teacher.announcements()) || [];
  }

  function audienceText(item) {
    const grades = (item.audience?.grades || []).map(gradeLabel);
    const centerNames = (item.audience?.centers || []).map((id) => centers.find((center) => center.value === id)?.label).filter(Boolean);
    return [grades.join(", "), centerNames.join(", ")].filter(Boolean).join(" · ") || "Everyone";
  }

  function render() {
    mount(
      root,
      html`${pageHeader({
        eyebrow: "Engagement",
        title: "Announcements",
        text: "News, reminders, offers and videos for your students and their parents. Target specific grades or centers.",
        actions: html`<button class="btn btn-primary" data-action="create">${icon("plus")} New announcement</button>`,
      })}
      ${list.length
        ? html`<div class="tile-grid">${list.map((item) =>
            announcementCard(item, {
              actions: html`<span class="row"><span class="badge badge-muted">${audienceText(item)}</span>
                <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${item._id}">Edit</button>
                <button class="btn btn-sm btn-ghost" data-action="delete" data-id="${item._id}">Delete</button></span>`,
            }),
          )}</div>`
        : html`<div class="card">${emptyState("No announcements yet", "Post your first update — students see it on their home page.")}</div>`}`,
    );
  }

  on(root, "click", "[data-action]", async (event, button) => {
    const item = list.find((entry) => entry._id === button.dataset.id);
    const action = button.dataset.action;
    if (action === "create" || action === "edit") {
      const saved = await formDialog({
        title: item ? "Edit announcement" : "New announcement",
        size: "lg",
        fields: fields(item),
        submitLabel: item ? "Save" : "Publish",
        onSubmit: async (values) => {
          const body = await toBody(values);
          return item ? api.teacher.updateAnnouncement(item._id, body) : api.teacher.createAnnouncement(body);
        },
      });
      if (saved) {
        await load();
        render();
        toast(item ? "Announcement updated." : "Announcement published.");
      }
    }
    if (action === "delete") {
      if (!(await confirmDialog(`Delete “${item.title}”?`, { danger: true, confirmLabel: "Delete" }))) return;
      if (!(await withBusy(button, () => api.teacher.deleteAnnouncement(item._id)))) return;
      await load();
      render();
      toast("Announcement deleted.");
    }
  });

  await load();
  render();
}
