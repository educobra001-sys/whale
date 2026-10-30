// Authenticated application shell: loads the signed-in account, builds the role's navigation,
// and renders views for the current hash route (#/path?query).
import { api } from "./core/api.js";
import { PERMISSIONS, ROLES, STORAGE_KEYS } from "./core/config.js";
import { icon } from "./core/icons.js";
import { ROUTES, matchRoute } from "./core/routes.js";
import { getAccessToken, getRole, isDemo, loginUrl, logout, scheduleRefresh } from "./core/session.js";
import { $, $$, errorState, fullName, html, mount, on, skeleton, avatar, sameId } from "./core/ui.js";

const role = getRole();
if (!getAccessToken() || !ROLES[role]) {
  window.location.replace(loginUrl(role));
  throw new Error("Not signed in");
}
scheduleRefresh();

const routes = ROUTES[role];
const shell = document.getElementById("app");
let me = null;
let cleanup = null;
let renderCount = 0;

// ---------- Theme ----------
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE_KEYS.theme, next);
  } catch {
    /* storage unavailable */
  }
  applyTheme(next);
  renderThemeButton();
}
function renderThemeButton() {
  const button = $("#theme-toggle");
  if (button) mount(button, html`${icon(currentTheme() === "dark" ? "sun" : "moon")}<span class="sr-only">Toggle theme</span>`);
}

// ---------- Account ----------
const ALL_PERMISSIONS = new Set(PERMISSIONS.map((permission) => permission.key));

async function loadMe() {
  if (role === "teacher") {
    const profile = await api.teacher.profile();
    return { role, id: profile._id, name: fullName(profile), person: profile, teacher: profile, permissions: ALL_PERMISSIONS };
  }
  if (role === "assistant") {
    const profile = await api.assistant.profile();
    const isAdmin = profile.role === "Admin" || profile.role === 0 || profile.role === "0";
    return {
      role,
      id: profile._id,
      name: fullName(profile),
      person: profile,
      teacher: profile.teacher,
      permissions: isAdmin ? ALL_PERMISSIONS : new Set(profile.permissions || []),
    };
  }
  if (role === "center") {
    const profile = await api.center.profile();
    return { role, id: profile._id, name: profile.name, person: profile };
  }
  if (role === "student") {
    const [profile, teachers] = await Promise.all([api.student.profile(), api.student.teachers()]);
    return { role, id: profile._id, name: fullName(profile), person: profile, teachers: teachers || [] };
  }
  const profile = await api.parent.profile();
  return { role, id: profile._id, name: profile.name || profile.phone, person: profile, children: profile.children || [] };
}

function can(route) {
  if (role !== "assistant" || !route.perm) return true;
  const needed = [].concat(route.perm);
  return needed.some((perm) => me.permissions.has(perm));
}

// Student: which subscribed teacher is in focus. Parent: which child is in focus.
function activeTeacherId() {
  const subscribed = (me.teachers || []).filter((entry) => entry.status === "active");
  const stored = localStorage.getItem(STORAGE_KEYS.activeTeacher);
  const found = subscribed.find((entry) => sameId(entry.teacher, stored));
  return found ? String(found.teacher._id) : subscribed[0] ? String(subscribed[0].teacher._id) : null;
}
function activeChildId() {
  const stored = localStorage.getItem(STORAGE_KEYS.activeChild);
  const found = (me.children || []).find((child) => sameId(child, stored));
  return found ? String(found._id) : me.children?.[0] ? String(me.children[0]._id) : null;
}

// ---------- Layout ----------
function navHtml() {
  const groups = new Map();
  for (const route of routes) {
    if (!route.nav || !can(route)) continue;
    if (!groups.has(route.nav.group)) groups.set(route.nav.group, []);
    groups.get(route.nav.group).push(route);
  }
  return html`${[...groups].map(
    ([group, items]) => html`<div class="nav-group">
      <p class="nav-heading">${group}</p>
      ${items.map((route) => html`<a class="nav-link" href="#${route.path}" data-path="${route.path}">${icon(route.nav.icon)}<span>${route.title}</span></a>`)}
    </div>`,
  )}`;
}

function switcherHtml() {
  if (role === "student") {
    const subscribed = (me.teachers || []).filter((entry) => entry.status === "active");
    if (!subscribed.length) return "";
    const active = activeTeacherId();
    return html`<label class="switcher"><span class="sr-only">Teacher</span>
      <select id="context-switcher" aria-label="Choose teacher">${subscribed.map(
        (entry) => html`<option value="${entry.teacher._id}" ${String(entry.teacher._id) === active ? html`selected` : ""}>${fullName(entry.teacher)}${entry.teacher.subject?.length ? ` · ${entry.teacher.subject.join(", ")}` : ""}</option>`,
      )}</select></label>`;
  }
  if (role === "parent" && (me.children || []).length > 1) {
    const active = activeChildId();
    return html`<label class="switcher"><span class="sr-only">Child</span>
      <select id="context-switcher" aria-label="Choose child">${me.children.map(
        (child) => html`<option value="${child._id}" ${String(child._id) === active ? html`selected` : ""}>${fullName(child)}</option>`,
      )}</select></label>`;
  }
  return "";
}

function roleSubtitle() {
  if (role === "assistant") return html`Assistant · ${fullName(me.teacher)}`;
  if (role === "teacher") return html`Teacher${me.person.subject?.length ? ` · ${me.person.subject.join(", ")}` : ""}`;
  if (role === "center") return "Learning center";
  if (role === "student") return html`Student · ${me.person.userID || ""}`;
  return "Parent";
}

function renderShell() {
  mount(
    shell,
    html`<div class="app">
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <a class="sidebar-brand" href="index.html"><span class="brand-mark">LC</span><span>Learning Center</span></a>
        <div class="sidebar-account">
          ${avatar(me.person)}
          <div><strong>${me.name}</strong><span>${roleSubtitle()}</span></div>
        </div>
        <nav class="sidebar-nav">${navHtml()}</nav>
        <div class="sidebar-foot">
          <button class="nav-link" type="button" data-action="logout">${icon("logout")}<span>Sign out</span></button>
        </div>
      </aside>
      <div class="sidebar-scrim" data-action="close-nav"></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" type="button" data-action="open-nav" aria-label="Open menu">${icon("menu")}</button>
          <p class="topbar-title" id="topbar-title"></p>
          <div class="topbar-tools">
            ${switcherHtml()}
            <button class="icon-btn" id="theme-toggle" type="button" data-action="theme"></button>
          </div>
        </header>
        ${isDemo() ? html`<div class="demo-banner">Demo mode — sample data stored only in this browser. <button type="button" class="link-btn" data-action="reset-demo">Reset demo data</button></div>` : ""}
        <main class="view" id="view" tabindex="-1"></main>
      </div>
    </div>`,
  );
  renderThemeButton();
}

// ---------- Routing ----------
function parseHash() {
  const hash = window.location.hash.replace(/^#/, "") || ROLES[role].home.replace(/^#/, "");
  const [path, search = ""] = hash.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(search)) };
}

export function navigate(hash) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}

function setQuery(patch) {
  const { path, query } = parseHash();
  const next = { ...query, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
  const search = new URLSearchParams(next).toString();
  history.replaceState(null, "", `#${path}${search ? `?${search}` : ""}`);
}

async function render() {
  const { path, query } = parseHash();
  const found = matchRoute(routes, path);
  if (!found) {
    navigate(ROLES[role].home);
    return;
  }
  const { route, params } = found;
  if (typeof cleanup === "function") {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
  }
  cleanup = null;
  document.body.classList.remove("nav-open");

  for (const link of $$(".nav-link[data-path]")) {
    const active = path === link.dataset.path || path.startsWith(`${link.dataset.path}/`);
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("#topbar-title").textContent = route.title;
  document.title = `${route.title} | Learning Center`;

  const host = $("#view");
  const root = document.createElement("div");
  root.className = "view-inner";
  host.replaceChildren(root);
  const thisRender = ++renderCount;

  if (!can(route)) {
    const fallback = routes.find((item) => item.nav && can(item));
    if (`#${route.path}` === ROLES[role].home && fallback && fallback !== route) {
      navigate(fallback.path);
      return;
    }
    mount(root, errorState({ message: "Your teacher hasn't given your account access to this page." }, ""));
    return;
  }
  mount(root, skeleton(6));

  const ctx = {
    root,
    params,
    query,
    me,
    role,
    api,
    navigate,
    setQuery,
    refresh: render,
    isCurrent: () => thisRender === renderCount,
    can: (perm) => role !== "assistant" || [].concat(perm).some((key) => me.permissions.has(key)),
    teacherId: role === "student" ? activeTeacherId() : null,
    childId: role === "parent" ? activeChildId() : null,
    reloadMe: async () => {
      me = await loadMe();
      ctx.me = me;
      renderShell();
      await render();
    },
  };
  try {
    const module = await import(`./views/${route.view}.js`);
    if (thisRender !== renderCount) return;
    const result = await module.default(ctx);
    if (thisRender === renderCount) cleanup = result;
    else if (typeof result === "function") result();
  } catch (error) {
    if (thisRender !== renderCount) return;
    console.error(error);
    mount(root, errorState(error));
    on(root, "click", "[data-action=retry]", () => render());
  }
}

// ---------- Boot ----------
on(document, "click", "[data-action]", async (event, target) => {
  const action = target.dataset.action;
  if (action === "logout") logout();
  if (action === "theme") toggleTheme();
  if (action === "open-nav") document.body.classList.add("nav-open");
  if (action === "close-nav") document.body.classList.remove("nav-open");
  if (action === "reset-demo") {
    const mock = await import("./mock/server.js");
    mock.resetDb();
    window.location.reload();
  }
});
on(document, "change", "#context-switcher", (event, select) => {
  localStorage.setItem(role === "student" ? STORAGE_KEYS.activeTeacher : STORAGE_KEYS.activeChild, select.value);
  render();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
    const search = $("#view input[type=search]");
    if (search) {
      event.preventDefault();
      search.focus();
    }
  }
  if (event.key === "Escape") document.body.classList.remove("nav-open");
});

(async () => {
  mount(shell, html`<div class="boot">${skeleton(3)}</div>`);
  try {
    me = await loadMe();
  } catch (error) {
    mount(
      shell,
      html`<div class="boot">${errorState(error, "")}
        <div class="boot-actions"><button class="btn btn-secondary" type="button" data-action="logout">Back to sign in</button></div></div>`,
    );
    return;
  }
  renderShell();
  window.addEventListener("hashchange", render);
  render();
})();
