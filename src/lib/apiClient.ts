import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse } from "axios";
import { getUserData, clearAuthData, setAuthTokens } from "./authHelpers";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";

/** Seconds before expiry to trigger proactive refresh */
const REFRESH_BEFORE_EXPIRY_SEC = 5 * 60;

/** Decode JWT payload (no verification; used only for exp heuristic). */
function getJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const exp = payload?.exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** Only one refresh in flight; others wait and reuse result. */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${baseURL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token: string; refresh_token?: string };
      const newAccess = data.access_token;
      const newRefresh = data.refresh_token ?? refreshToken;
      setAuthTokens(newAccess, newRefresh);
      return newAccess;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Returns true if access token should be refreshed (expired or expiring soon). */
function shouldRefreshToken(accessToken: string): boolean {
  const exp = getJwtExp(accessToken);
  if (exp == null) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp - nowSec < REFRESH_BEFORE_EXPIRY_SEC;
}

const createApiClient = (): AxiosInstance => {
  const API = axios.create({
    baseURL,
    headers: {
      "Content-Type": "application/json",
    },
  });

  API.interceptors.request.use(
    async (config) => {
      const userData = getUserData();
      if (!userData?.token) return config;

      let token = userData.token;
      if (shouldRefreshToken(token) && userData.refreshToken) {
        const newToken = await refreshAccessToken(userData.refreshToken);
        if (newToken) token = newToken;
      }
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    },
    (error) => Promise.reject(error)
  );

  API.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
      if (error.response?.status === 401 && !originalRequest._retry) {
        const path = window.location.pathname;
        if (path === "/login" || path === "/") {
          return Promise.reject(error);
        }
        const userData = getUserData();
        const refresh = userData?.refreshToken;
        if (refresh) {
          originalRequest._retry = true;
          const newToken = await refreshAccessToken(refresh);
          if (newToken) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return API(originalRequest);
          }
        }
        clearAuthData();
        window.location.href = "/login";
      }
      if (!error.response) {
        console.error("Network error:", error.message);
      }
      return Promise.reject(error);
    }
  );

  return API;
};

const API = createApiClient();
export default API;
