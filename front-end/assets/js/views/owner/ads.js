import { badge, date, fullName, html, mount, on, pageHeader, tabs, emptyState, withBusy, formDialog } from "../../core/ui.js";

export default async function ownerAds(ctx) {
  const { root, api } = ctx;
  let status = "pending";

  async function render() {
    const ads = await api.owner.ads({ status });
    mount(root, html`${pageHeader({ eyebrow: "EduCobra", title: "Ads", text: "Ads stay inside the teacher's own course. Only the ones you accept appear outside it." })}
      ${tabs([{ key: "pending", label: "Waiting" }, { key: "approved", label: "Accepted" }, { key: "rejected", label: "Refused" }], status)}
      <div class="grid mt">${ads.length
        ? ads.map((ad) => html`<article class="tile">
            ${ad.imageUrl ? html`<div class="tile-media"><img src="${ad.imageUrl}" alt=""></div>` : ""}
            <div class="row-between"><h3>${ad.title}</h3>${badge(fullName(ad.teacher), "accent")}</div>
            ${ad.body ? html`<p style="white-space:pre-line">${ad.body}</p>` : ""}
            ${ad.platformNote ? html`<p class="muted small">Note: ${ad.platformNote}</p>` : ""}
            <div class="tile-foot"><span class="muted small">${date(ad.updatedAt)}</span>
              <span class="row">${ad.platformStatus !== "approved" ? html`<button class="btn btn-primary btn-sm" data-ad="${ad._id}" data-status="approved">Accept</button>` : ""}
              ${ad.platformStatus !== "rejected" ? html`<button class="btn btn-secondary btn-sm" data-ad="${ad._id}" data-status="rejected">Refuse</button>` : ""}</span></div>
          </article>`)
        : emptyState("Nothing here")}</div>`);
  }

  const stop = on(root, "click", "button", async (event, button) => {
    if (button.dataset.tab) {
      status = button.dataset.tab;
      await render();
    }
    if (button.dataset.ad) {
      if (button.dataset.status === "rejected") {
        const saved = await formDialog({
          title: "Refuse this ad",
          fields: [{ name: "note", label: "Reason shown to the teacher", type: "textarea", full: true }],
          submitLabel: "Refuse",
          onSubmit: (values) => api.owner.reviewAd(button.dataset.ad, { status: "rejected", note: values.note }),
        });
        if (saved) await render();
        return;
      }
      await withBusy(button, () => api.owner.reviewAd(button.dataset.ad, { status: "approved" }), "Ad accepted.");
      await render();
    }
  });
  await render();
  return stop;
}
