import API from "@/lib/apiClient";
import { clearAuthData } from "@/lib/authHelpers";

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
}

export interface MeResponse {
  role: string;
  name: string;
  email: string;
  user_id?: string;
  admin_id?: string;
  assignments?: { test_name: string; status: string; test_order: number; is_anchor?: boolean }[];
  dashboard_stats?: Record<string, unknown>;
}

export const authService = {
  login: async (data: LoginData): Promise<AuthResponse> => {
    const response = await API.post<AuthResponse>("/auth/login", data);
    return response.data;
  },

  getMe: async (): Promise<MeResponse> => {
    const response = await API.get<MeResponse>("/auth/me");
    return response.data;
  },

  refresh: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await API.post<AuthResponse>("/auth/refresh", {
      refresh_token: refreshToken,
    });
    return response.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await API.post<{ message: string }>("/auth/forgot-password", { email });
    return response.data;
  },

  verifyOtp: async (email: string, otp: string): Promise<{ message: string }> => {
    const response = await API.post<{ message: string }>("/auth/verify-otp", { email, otp });
    return response.data;
  },

  resetPassword: async (email: string, otp: string, newPassword: string): Promise<{ message: string }> => {
    const response = await API.post<{ message: string }>("/auth/reset-password", {
      email,
      otp,
      new_password: newPassword,
    });
    return response.data;
  },

  logout: () => {
    clearAuthData();
  },
};
