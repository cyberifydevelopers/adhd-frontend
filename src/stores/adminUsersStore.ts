import { create } from "zustand";
import { isAxiosError } from "axios";
import {
  adminUsersService,
  type UserCreateData,
  type UsersListFilters,
  type UsersListResponse,
} from "@/services";
import { toast } from "@/lib/toast";

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err) && err.response?.data) {
    const detail = err.response.data.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  }
  return err instanceof Error ? err.message : fallback;
}

export type AdminStats = {
  total_users: number;
  total_assignments: number;
  completed_assignments: number;
  total_sessions: number;
};

type AdminUsersState = {
  listData: UsersListResponse | null;
  statsData: AdminStats | null;
  listParams: { page: number; pageSize: number; filters?: UsersListFilters };
  isLoadingList: boolean;
  isLoadingStats: boolean;
  isCreating: boolean;
  sendingUserId: string | null;
  fetchList: (page?: number, pageSize?: number, filters?: UsersListFilters) => Promise<void>;
  fetchStats: () => Promise<void>;
  createUser: (data: UserCreateData) => Promise<Awaited<ReturnType<typeof adminUsersService.create>> | void>;
  sendCredentials: (userId: string) => Promise<Awaited<ReturnType<typeof adminUsersService.sendCredentials>> | void>;
};

export const adminUsersStore = create<AdminUsersState>((set, get) => ({
  listData: null,
  statsData: null,
  listParams: { page: 1, pageSize: 20, filters: undefined },
  isLoadingList: false,
  isLoadingStats: false,
  isCreating: false,
  sendingUserId: null,

  fetchList: async (page = 1, pageSize = 20, filters) => {
    set({ isLoadingList: true });
    try {
      const data = await adminUsersService.list(page, pageSize, filters);
      set({ listData: data, listParams: { page, pageSize, filters }, isLoadingList: false });
    } catch (err) {
      set({ isLoadingList: false });
      toast.error(getApiErrorMessage(err, "Failed to load users"));
    }
  },

  fetchStats: async () => {
    set({ isLoadingStats: true });
    try {
      const data = await adminUsersService.getStats();
      set({ statsData: data, isLoadingStats: false });
    } catch (err) {
      set({ isLoadingStats: false });
      toast.error(getApiErrorMessage(err, "Failed to load stats"));
    }
  },

  createUser: async (data) => {
    set({ isCreating: true });
    try {
      const res = await adminUsersService.create(data);
      toast.success("User created successfully");
      const { listParams } = get();
      await get().fetchList(listParams.page, listParams.pageSize, listParams.filters);
      return res;
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to create user"));
    } finally {
      set({ isCreating: false });
    }
  },

  sendCredentials: async (userId) => {
    set({ sendingUserId: userId });
    try {
      const res = await adminUsersService.sendCredentials(userId);
      if (res.sent) toast.success("Credentials sent by email");
      else if (res.temp_password) toast.info("Copy the password below to share manually");
      const { listParams } = get();
      await get().fetchList(listParams.page, listParams.pageSize, listParams.filters);
      return res;
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to send credentials"));
    } finally {
      set({ sendingUserId: null });
    }
  },
}));
