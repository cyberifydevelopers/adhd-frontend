import { create } from "zustand";
import { adminUsersService, type UserListItem } from "@/services";

export type IntakeData = Awaited<ReturnType<typeof adminUsersService.getIntake>>;
export type Assignment = Awaited<ReturnType<typeof adminUsersService.getAssignments>>[number];
export type SessionItem = Awaited<ReturnType<typeof adminUsersService.getSessions>>["sessions"][number];

type AdminUserDetailState = {
  userId: string | null;
  user: UserListItem | null;
  intake: IntakeData | null;
  assignments: Assignment[];
  sessions: SessionItem[];
  sessionsTotal: number;
  sessionsPage: number;
  sessionsPageSize: number;
  showDeletedSessions: boolean;
  isLoading: boolean;
  fetchUserDetail: (userId: string | null) => Promise<void>;
  fetchSessions: (page?: number, pageSize?: number, includeDeleted?: boolean) => Promise<void>;
  setShowDeletedSessions: (show: boolean) => void;
  refetch: () => Promise<void>;
};

export const adminUserDetailStore = create<AdminUserDetailState>((set, get) => ({
  userId: null,
  user: null,
  intake: null,
  assignments: [],
  sessions: [],
  sessionsTotal: 0,
  sessionsPage: 1,
  sessionsPageSize: 10,
  showDeletedSessions: false,
  isLoading: false,

  fetchUserDetail: async (userId) => {
    if (!userId) {
      set({ userId: null, user: null, intake: null, assignments: [], sessions: [], sessionsTotal: 0, sessionsPage: 1, isLoading: false });
      return;
    }
    set({ userId, isLoading: true });
    try {
      const [user, intake, assignments, sessionsData] = await Promise.all([
        adminUsersService.get(userId),
        adminUsersService.getIntake(userId),
        adminUsersService.getAssignments(userId),
        adminUsersService.getSessions(userId, 1, get().sessionsPageSize, get().showDeletedSessions),
      ]);
      set({
        user,
        intake,
        assignments: assignments ?? [],
        sessions: sessionsData.sessions ?? [],
        sessionsTotal: sessionsData.total,
        sessionsPage: sessionsData.page,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
    }
  },

  fetchSessions: async (page, pageSize, includeDeleted) => {
    const { userId } = get();
    if (!userId) return;
    const p = page ?? get().sessionsPage;
    const ps = pageSize ?? get().sessionsPageSize;
    const del = includeDeleted ?? get().showDeletedSessions;
    try {
      const data = await adminUsersService.getSessions(userId, p, ps, del);
      set({
        sessions: data.sessions ?? [],
        sessionsTotal: data.total,
        sessionsPage: data.page,
        sessionsPageSize: ps,
      });
    } catch {}
  },

  setShowDeletedSessions: (show) => {
    set({ showDeletedSessions: show });
    get().fetchSessions(1, undefined, show);
  },

  refetch: async () => {
    const { userId } = get();
    if (userId) await get().fetchUserDetail(userId);
  },
}));
