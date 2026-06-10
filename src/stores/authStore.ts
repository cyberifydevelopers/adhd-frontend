import { useEffect } from "react"; // for useAuthTokensSync
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isAxiosError } from "axios";
import { authService } from "@/services";
import { AUTH_TOKENS_UPDATED, clearAuthData } from "@/lib/authHelpers";
import { toast } from "@/lib/toast";

function getLoginErrorMessage(e: unknown): string {
  if (isAxiosError(e) && e.response?.data) {
    const detail = e.response.data.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  }
  if (e instanceof Error) return e.message;
  return "Login failed";
}

export type Me = {
  role: string;
  name: string;
  email: string;
  user_id?: string;
  admin_id?: string;
  assignments?: {
    assignment_id?: string;
    test_name: string;
    status: string;
    test_order: number;
    is_anchor?: boolean;
  }[];
  dashboard_stats?: Record<string, unknown>;
  password_change_required?: boolean;
  has_intake?: boolean;
};

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  me: Me | null;
  loading: boolean;
  error: string | null;
  setToken: (token: string | null) => void;
  setTokens: (access: string | null, refresh: string | null) => void;
  setMe: (me: Me | null) => void;
  login: (email: string, password: string) => Promise<void>;
  fetchMe: () => Promise<void>;
  logout: () => void;
  clearError: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      refreshToken: null,
      me: null,
      loading: false,
      error: null,
      setToken: (token) => {
        set({ token });
        if (!token) clearAuthData();
      },
      setTokens: (access, refresh) => {
        set({ token: access, refreshToken: refresh });
        if (!access) clearAuthData();
      },
      setMe: (me) => set({ me }),
      login: async (email, password) => {
        set({ loading: true, error: null });
        try {
          const { access_token, refresh_token } = await authService.login({
            email,
            password,
          });
          get().setTokens(access_token, refresh_token ?? null);
          await get().fetchMe();
          const user = get().me;
          if (user) toast.success(`Welcome, ${user.name}`);
        } catch (e) {
          set({
            error: getLoginErrorMessage(e),
            loading: false,
          });
          throw e;
        } finally {
          set({ loading: false });
        }
      },
      fetchMe: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const me = await authService.getMe();
          set({ me });
        } catch {
          get().logout();
        }
      },
      logout: () => {
        get().setTokens(null, null);
        set({ me: null, error: null });
      },
      clearError: () => set({ error: null }),
    }),
    {
      name: "adhd-auth",
      partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken }),
    }
  )
);

/** Sync store when tokens are updated via refresh (e.g. in apiClient) */
export function useAuthTokensSync(): void {
  useEffect(() => {
    const handler = (e: CustomEvent<{ token: string; refreshToken: string }>) => {
      useAuthStore.setState({ token: e.detail.token, refreshToken: e.detail.refreshToken });
    };
    window.addEventListener(AUTH_TOKENS_UPDATED, handler as EventListener);
    return () => window.removeEventListener(AUTH_TOKENS_UPDATED, handler as EventListener);
  }, []);
}
