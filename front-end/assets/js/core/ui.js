// UI toolkit: safe HTML templating, formatting, dialogs, forms, toasts, tables, charts, CSV and QR.
import { CURRENCY, GRADES, LANGUAGES, HOMEWORK_STATUS } from "./config.js";

// ---------- Safe templating ----------
// html`...` escapes every interpolated value unless it is itself the result of html`` or raw().
export class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}
export const raw = (value) => new Raw(String(value ?? ""));

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function part(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  if (value === false || value === null || value === undefined) return "";
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += part(value) + strings[index + 1];
  });
  return new Raw(out);
}

export function mount(element, content) {
  element.innerHTML = String(content);
  return element;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Event delegation: on(root, "click", "[data-action=save]", handler)
export function on(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

// ---------- Formatting ----------
export function fullName(person) {
  if (!person) return "—";
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") ||
    person.name ||
    person.userName ||
    person.userID ||
    "—"
  );
}

export function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function enumLabel(value, labels) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number" || /^\d+$/.test(String(value))) return labels[Number(value)] ?? String(value);
  return String(value);
}
export const gradeLabel = (value) => enumLabel(value, GRADES);
export const languageLabel = (value) => enumLabel(value, LANGUAGES);

export function enumIndex(value, labels) {
  if (value === null || value === undefined || value === "") return "";
  if (/^\d+$/.test(String(value))) return String(value);
  const index = labels.indexOf(value);
  return index < 0 ? "" : String(index);
}

export function money(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${CURRENCY}`;
}

export function date(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString(undefined, options);
}

export function dateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function time(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function relative(value) {
  if (!value) return "—";
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diff) >= seconds) return formatter.format(Math.round(diff / seconds), unit);
  }
  return "just now";
}

export const isoDate = (value = new Date()) => {
  const parsed = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
};

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

export const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);

export function whatsappLink(phone, text = "") {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = `20${digits.slice(1)}`; // Egyptian local numbers
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

// ---------- Small components ----------
export function badge(label, tone = "muted") {
  return html`<span class="badge badge-${tone}">${label}</span>`;
}

export function homeworkBadge(status) {
  if (!status) return badge("Not checked", "muted");
  const info = HOMEWORK_STATUS[status] || { label: status, tone: "muted" };
  return badge(info.label, info.tone);
}

export function avatar(person, size = "md") {
  const name = fullName(person);
  const url = person?.profilepic || person?.profilePhoto;
  return url
    ? html`<img class="avatar avatar-${size}" src="${url}" alt="" loading="lazy">`
    : html`<span class="avatar avatar-${size}" aria-hidden="true">${initials(name)}</span>`;
}

export function emptyState(title, text = "", action = "") {
  return html`<div class="empty">
    <div class="empty-mark" aria-hidden="true">✦</div>
    <p class="empty-title">${title}</p>
    ${text ? html`<p class="empty-text">${text}</p>` : ""}
    ${action}
  </div>`;
}

export function errorState(error, retryAction = "retry") {
  const missing = error?.missing;
  return html`<div class="empty ${missing ? "empty-pending" : "empty-error"}">
    <div class="empty-mark" aria-hidden="true">${missing ? "⋯" : "!"}</div>
    <p class="empty-title">${missing ? "Coming soon" : "Something went wrong"}</p>
    <p class="empty-text">${error?.message || "Please try again."}</p>
    ${retryAction ? html`<button class="btn btn-secondary btn-sm" data-action="${retryAction}" type="button">Try again</button>` : ""}
  </div>`;
}

export function skeleton(lines = 4) {
  return html`<div class="skeleton-block" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: lines }, (_, index) => html`<span class="skeleton" style="width:${90 - index * 12}%"></span>`)}
  </div>`;
}

export function statTile(label, value, { hint = "", tone = "", icon = "" } = {}) {
  return html`<div class="stat ${tone ? `stat-${tone}` : ""}">
    <span class="stat-label">${icon ? html`<span class="stat-icon" aria-hidden="true">${icon}</span>` : ""}${label}</span>
    <strong class="stat-value">${value}</strong>
    ${hint ? html`<span class="stat-hint">${hint}</span>` : ""}
  </div>`;
}

export function pageHeader({ eyebrow = "", title, text = "", actions = "" }) {
  return html`<header class="page-header">
    <div>
      ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ""}
      <h1>${title}</h1>
      ${text ? html`<p class="page-text">${text}</p>` : ""}
    </div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ""}
  </header>`;
}

// columns: [{ label, render(row) => html | string, className, sortValue }]
export function table(columns, rows, { empty = "Nothing to show yet.", rowAttrs } = {}) {
  if (!rows.length) return emptyState(empty);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>${columns.map((column) => html`<th class="${column.className || ""}" scope="col">${column.label}</th>`)}</tr></thead>
    <tbody>${rows.map(
      (row) => html`<tr ${raw(rowAttrs ? rowAttrs(row) : "")}>${columns.map(
        (column) => html`<td class="${column.className || ""}" data-label="${column.label}">${column.render(row)}</td>`,
      )}</tr>`,
    )}</tbody>
  </table></div>`;
}

export function tabs(items, active, { param = "tab" } = {}) {
  return html`<nav class="tabs" role="tablist">${items.map(
    (item) => html`<button type="button" role="tab" class="tab ${item.key === active ? "is-active" : ""}"
      aria-selected="${item.key === active}" data-tab="${item.key}" data-param="${param}">${item.label}${
      item.count !== undefined ? html` <span class="tab-count">${item.count}</span>` : ""
    }</button>`,
  )}</nav>`;
}

// ---------- Toasts ----------
export function toast(message, tone = "success", timeout = 4200) {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.append(stack);
  }
  const item = document.createElement("div");
  item.className = `toast toast-${tone}`;
  item.textContent = message;
  stack.append(item);
  window.setTimeout(() => {
    item.classList.add("is-leaving");
    window.setTimeout(() => item.remove(), 260);
  }, timeout);
}

export const toastError = (error) =>
  toast(error instanceof Error ? error.message : String(error || "Something went wrong."), "error", 6000);

// ---------- Dialogs ----------
export function openDialog({ title, eyebrow = "", body = "", actions = "", size = "md", onClose } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog dialog-${size}`;
  mount(
    dialog,
    html`<div class="dialog-head">
        <div>${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ""}<h2>${title}</h2></div>
        <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
      </div>
      <div class="dialog-body">${body}</div>
      ${actions ? html`<div class="dialog-actions">${actions}</div>` : ""}`,
  );
  document.body.append(dialog);
  const close = () => {
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener("close", () => {
    onClose?.();
    dialog.remove();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) close();
  });
  dialog.showModal();
  return { dialog, close };
}

export function confirmDialog(message, { title = "Are you sure?", confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { dialog, close } = openDialog({
      title,
      size: "sm",
      body: html`<p class="dialog-text">${message}</p>`,
      actions: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-confirm>${confirmLabel}</button>`,
      onClose: () => resolve(answered),
    });
    $("[data-confirm]", dialog).addEventListener("click", () => {
      answered = true;
      close();
    });
    $("[data-confirm]", dialog).focus();
  });
}

// fields: [{ name, label, type, value, options:[{value,label}]|string[], required, hint, min, max, step,
//            placeholder, multiple, rows, accept, full, help, checked }]
export function fieldHtml(field) {
  const fieldId = `f-${field.name}-${Math.random().toString(36).slice(2, 7)}`;
  const common = html`id="${fieldId}" name="${field.name}" ${field.required ? raw("required") : ""} ${
    field.placeholder ? html`placeholder="${field.placeholder}"` : ""
  } ${field.disabled ? raw("disabled") : ""}`;
  const value = field.value ?? "";
  let control;
  if (field.type === "select") {
    const options = (field.options || []).map((option) =>
      typeof option === "object" ? option : { value: option, label: option },
    );
    const selected = new Set([].concat(value).map(String));
    control = html`<select ${common} ${field.multiple ? raw("multiple") : ""}>
      ${field.multiple ? "" : html`<option value="">${field.emptyLabel || "Select…"}</option>`}
      ${options.map(
        (option) => html`<option value="${option.value}" ${selected.has(String(option.value)) ? raw("selected") : ""}>${option.label}</option>`,
      )}
    </select>`;
  } else if (field.type === "textarea") {
    control = html`<textarea ${common} rows="${field.rows || 3}">${value}</textarea>`;
  } else if (field.type === "checkbox") {
    return html`<label class="check ${field.full ? "field-full" : ""}"><input type="checkbox" name="${field.name}" ${
      field.checked || value === true ? raw("checked") : ""
    }> <span>${field.label}</span></label>`;
  } else if (field.type === "checkboxes") {
    const selected = new Set([].concat(value).map(String));
    return html`<fieldset class="field field-full checks">
      <legend>${field.label}</legend>
      <div class="checks-grid">${(field.options || []).map((option) => {
        const opt = typeof option === "object" ? option : { value: option, label: option };
        return html`<label class="check"><input type="checkbox" name="${field.name}" value="${opt.value}" ${
          selected.has(String(opt.value)) ? raw("checked") : ""
        }> <span>${opt.label}</span></label>`;
      })}</div>
    </fieldset>`;
  } else {
    control = html`<input ${common} type="${field.type || "text"}" value="${value}" ${
      field.min !== undefined ? html`min="${field.min}"` : ""
    } ${field.max !== undefined ? html`max="${field.max}"` : ""} ${field.step ? html`step="${field.step}"` : ""} ${
      field.accept ? html`accept="${field.accept}"` : ""
    } ${field.maxlength ? html`maxlength="${field.maxlength}"` : ""} ${field.autocomplete ? html`autocomplete="${field.autocomplete}"` : ""}>`;
  }
  return html`<div class="field ${field.full ? "field-full" : ""}">
    <label for="${fieldId}">${field.label}${field.required ? "" : html` <span class="optional">optional</span>`}</label>
    ${control}
    ${field.hint ? html`<span class="field-hint">${field.hint}</span>` : ""}
  </div>`;
}

export function readForm(form, fields) {
  const data = new FormData(form);
  const values = {};
  for (const field of fields) {
    if (field.type === "checkbox") values[field.name] = form.elements[field.name]?.checked ?? false;
    else if (field.type === "checkboxes" || field.multiple) values[field.name] = data.getAll(field.name).map(String);
    else if (field.type === "file") values[field.name] = data.get(field.name);
    else {
      const value = data.get(field.name);
      const text = typeof value === "string" ? value.trim() : value;
      values[field.name] = field.type === "number" ? (text === "" ? null : Number(text)) : text;
    }
  }
  return values;
}

export function formDialog({ title, eyebrow = "", intro = "", fields, submitLabel = "Save", size = "md", onSubmit, danger }) {
  return new Promise((resolve) => {
    let result = null;
    const { dialog, close } = openDialog({
      title,
      eyebrow,
      size,
      body: html`${intro ? html`<p class="dialog-text">${intro}</p>` : ""}
        <p class="form-error" hidden></p>
        <form class="form-grid" novalidate>${fields.map(fieldHtml)}<button hidden type="submit"></button></form>`,
      actions: html`<button class="btn btn-secondary" type="button" data-close>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" type="button" data-submit>${submitLabel}</button>`,
      onClose: () => resolve(result),
    });
    const form = $("form", dialog);
    const error = $(".form-error", dialog);
    const submitButton = $("[data-submit]", dialog);
    const submit = async () => {
      if (!form.reportValidity()) return;
      const values = readForm(form, fields);
      submitButton.disabled = true;
      submitButton.classList.add("is-loading");
      error.hidden = true;
      try {
        result = onSubmit ? (await onSubmit(values)) ?? values : values;
        close();
      } catch (problem) {
        error.textContent = problem instanceof Error ? problem.message : String(problem);
        error.hidden = false;
      } finally {
        submitButton.disabled = false;
        submitButton.classList.remove("is-loading");
      }
    };
    submitButton.addEventListener("click", submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    form.querySelector("input:not([type=hidden]),select,textarea")?.focus();
  });
}

// Runs an async action while showing a busy state on a button; reports errors as toasts.
// Resolves to the action's result (or true) on success and to undefined on failure.
export async function withBusy(button, action, successMessage) {
  if (button) {
    button.disabled = true;
    button.classList.add("is-loading");
  }
  try {
    const result = await action();
    if (successMessage) toast(successMessage);
    return result ?? true;
  } catch (error) {
    toastError(error);
    return undefined;
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }
}

// ---------- CSV ----------
export function downloadCSV(filename, columns, rows) {
  const cell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((column) => cell(column.label)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => cell(column.value(row))).join(","));
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const cleaned = rows.filter((cells) => cells.some((value) => value.trim()));
  if (!cleaned.length) return [];
  const headers = cleaned[0].map((header) => header.replace(/^﻿/, "").trim());
  return cleaned.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || "").trim()])));
}

// ---------- Charts (inline SVG, themed through CSS variables) ----------
export function barChart(points, { height = 180, format = (value) => value, empty = "No data yet." } = {}) {
  if (!points.length) return emptyState(empty);
  const max = Math.max(1, ...points.map((point) => Number(point.value) || 0));
  const width = Math.max(320, points.length * 56);
  const barWidth = Math.min(38, (width / points.length) * 0.55);
  const chartHeight = height - 38;
  return html`<figure class="chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart" preserveAspectRatio="xMidYMid meet">
      ${[0.25, 0.5, 0.75, 1].map((ratio) => html`<line class="chart-grid" x1="0" x2="${width}" y1="${chartHeight - chartHeight * ratio + 14}" y2="${chartHeight - chartHeight * ratio + 14}"></line>`)}
      ${points.map((point, index) => {
        const slot = width / points.length;
        const value = Number(point.value) || 0;
        const barHeight = Math.max(value ? 3 : 0, (value / max) * (chartHeight - 4));
        const x = slot * index + (slot - barWidth) / 2;
        const y = chartHeight - barHeight + 14;
        return html`<g>
          <rect class="chart-bar ${point.tone ? `chart-bar-${point.tone}` : ""}" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"><title>${point.label}: ${format(value)}</title></rect>
          <text class="chart-value" x="${x + barWidth / 2}" y="${y - 5}" text-anchor="middle">${value ? format(value) : ""}</text>
          <text class="chart-label" x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle">${point.label}</text>
        </g>`;
      })}
    </svg>
  </figure>`;
}

export function lineChart(series, { height = 200, max = 100, empty = "No data yet." } = {}) {
  const points = series[0]?.points || [];
  if (!points.length) return emptyState(empty);
  const width = Math.max(560, points.length * 110);
  const pad = 26;
  const toX = (index) => pad + (index * (width - pad * 2)) / Math.max(1, points.length - 1);
  const toY = (value) => height - pad - ((Number(value) || 0) / max) * (height - pad * 2);
  return html`<figure class="chart">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Line chart">
      ${[0, 0.5, 1].map((ratio) => html`<line class="chart-grid" x1="${pad}" x2="${width - pad}" y1="${toY(max * ratio)}" y2="${toY(max * ratio)}"></line>
        <text class="chart-label" x="2" y="${toY(max * ratio) + 4}">${Math.round(max * ratio)}</text>`)}
      ${series.map((line, lineIndex) => html`<polyline class="chart-line chart-line-${lineIndex}" fill="none" points="${line.points
        .map((point, index) => `${toX(index)},${toY(point.value)}`)
        .join(" ")}"></polyline>
        ${line.points.map((point, index) => html`<circle class="chart-dot chart-line-${lineIndex}" cx="${toX(index)}" cy="${toY(point.value)}" r="4"><title>${line.name} · ${point.label}: ${Math.round(point.value)}</title></circle>`)}`)}
      ${points.map((point, index) => html`<text class="chart-label" x="${toX(index)}" y="${height - 6}" text-anchor="middle">${point.label}</text>`)}
    </svg>
    ${series.length > 1 ? html`<figcaption class="chart-legend">${series.map((line, index) => html`<span><i class="legend-dot chart-line-${index}"></i>${line.name}</span>`)}</figcaption>` : ""}
  </figure>`;
}

// ---------- QR ----------
let qrLibrary;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

export async function qrDataUrl(text, cellSize = 6) {
  if (!qrLibrary) {
    qrLibrary = window.qrcode
      ? Promise.resolve()
      : loadScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js");
  }
  await qrLibrary;
  const qr = window.qrcode(0, "M");
  qr.addData(String(text));
  qr.make();
  return qr.createDataURL(cellSize, 8);
}

export { loadScript };

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
