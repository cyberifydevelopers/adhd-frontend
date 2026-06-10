const AUTH_STORAGE_KEY = "adhd-auth";

export const getUserData = (): {
  token?: string;
  refreshToken?: string;
} | null => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw) as {
        state?: { token?: string; refreshToken?: string };
      };
      return o.state ?? null;
    }
  } catch {
    // ignore
  }
  return null;
};

export const AUTH_TOKENS_UPDATED = "adhd-auth-tokens-updated";

export const setAuthTokens = (token: string, refreshToken: string): void => {
  try {
    const existing = getUserData();
    const state = { ...existing, token, refreshToken };
    const stored = JSON.stringify({ state, version: 1 });
    localStorage.setItem(AUTH_STORAGE_KEY, stored);
    window.dispatchEvent(new CustomEvent(AUTH_TOKENS_UPDATED, { detail: { token, refreshToken } }));
  } catch (e) {
    console.error("Error setting auth tokens:", e);
  }
};

export const clearAuthData = (): void => {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("access_token");
  } catch (e) {
    console.error("Error clearing auth data:", e);
  }
};
