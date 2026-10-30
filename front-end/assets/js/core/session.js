// Token storage, role tracking and access-token refresh.
// Tokens live in sessionStorage by default, or localStorage when the user ticks "Keep me signed in".
import { API_BASE, ROLES, STORAGE_KEYS as K } from "./config.js";

const REFRESH_MARGIN_MS = 60_000;
let refreshPromise = null;
let refreshTimer = null;

function store() {
  return localStorage.getItem(K.accessToken) ? localStorage : sessionStorage;
}

function read(key) {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

export function getRole() {
  return read(K.role);
}

export function isDemo() {
  return read(K.demo) === "1";
}

export function getAccessToken() {
  return read(K.accessToken);
}

export function saveSession({ accessToken, refreshToken, role, remember = false, demo = false }) {
  clearSession();
  const target = remember ? localStorage : sessionStorage;
  target.setItem(K.accessToken, accessToken);
  target.setItem(K.refreshToken, refreshToken || "");
  target.setItem(K.role, role);
  if (demo) target.setItem(K.demo, "1");
}

export function clearSession() {
  for (const storage of [sessionStorage, localStorage]) {
    for (const key of [K.accessToken, K.refreshToken, K.role, K.demo]) storage.removeItem(key);
  }
  window.clearTimeout(refreshTimer);
}

export function loginUrl(role = getRole()) {
  return `login.html${role && ROLES[role] ? `?role=${role}` : ""}`;
}

export function logout() {
  const role = getRole();
  clearSession();
  window.location.replace(loginUrl(role));
}

export function tokenExpiry(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    return JSON.parse(decoded).exp * 1000 || 0;
  } catch {
    return 0;
  }
}

export async function refreshAccessToken() {
  if (isDemo()) return getAccessToken();
  if (refreshPromise) return refreshPromise;
  const refreshToken = read(K.refreshToken);
  if (!refreshToken) {
    logout();
    throw new Error("Your session expired. Please sign in again.");
  }
  refreshPromise = (async () => {
    const response = await fetch(`${API_BASE}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    let result = {};
    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an unreadable refresh response.");
    }
    if (!response.ok || typeof result.data?.accessToken !== "string") {
      if ([400, 401, 403].includes(response.status)) logout();
      throw new Error(result.message || "Could not refresh your session.");
    }
    store().setItem(K.accessToken, result.data.accessToken);
    scheduleRefresh();
    return result.data.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function validAccessToken() {
  const token = getAccessToken();
  if (isDemo()) return token;
  if (!token || tokenExpiry(token) <= Date.now() + REFRESH_MARGIN_MS) return refreshAccessToken();
  return token;
}

export function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  const token = getAccessToken();
  if (!token || isDemo() || !read(K.refreshToken)) return;
  const expiresAt = tokenExpiry(token);
  if (!expiresAt) return;
  const delay = Math.max(0, expiresAt - Date.now() - REFRESH_MARGIN_MS);
  refreshTimer = window.setTimeout(() => {
    refreshAccessToken().catch(() => {
      refreshTimer = window.setTimeout(scheduleRefresh, 30_000);
    });
  }, delay);
}
