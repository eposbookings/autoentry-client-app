import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Also support Authorization header fallback (useful if cookies blocked)
let bearerToken = null;
try {
  bearerToken = localStorage.getItem("access_token");
} catch (_) {}

if (bearerToken) {
  api.defaults.headers.common["Authorization"] = `Bearer ${bearerToken}`;
}

export function setAuthToken(token) {
  bearerToken = token;
  if (token) {
    localStorage.setItem("access_token", token);
    api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  } else {
    localStorage.removeItem("access_token");
    delete api.defaults.headers.common["Authorization"];
  }
}

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return err?.message || "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" · ");
  if (detail?.msg) return String(detail.msg);
  return String(detail);
}
