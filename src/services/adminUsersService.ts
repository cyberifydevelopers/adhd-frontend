import API from "@/lib/apiClient";

export interface UserListItem {
  user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  mode: string | null;
  pending_count: number;
  completed_count: number;
}

export interface UsersListResponse {
  users: UserListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserCreateData {
  name: string;
  email: string;
  mode?: string;
  date_of_birth?: string;
  adhd_history?: boolean;
  medication_status?: boolean;
  took_medication_today?: boolean;
}

export interface UserCreateResponse extends UserListItem {
  temp_password?: string;
}

export interface Assignment {
  assignment_id: string;
  battery_id?: string | null;
  battery_item_id?: string | null;
  test_name: string;
  test_order: number;
  weight?: number;
  status: string;
  assigned_at: string;
  completed_at: string | null;
}

export interface BatteryItem {
  battery_item_id: string;
  test_name: string;
  item_order: number;
  weight: number;
  status: string;
  completed_at: string | null;
}

export interface BatteryValiditySummary {
  overall_confidence_score?: number | null;
  validity_classification?: string | null;
  assessment_interpretable?: boolean | null;
  practice_passed?: boolean | null;
  low_confidence_flag?: boolean | null;
  technical_issue_flag?: boolean | null;
}

export interface Battery {
  battery_id: string;
  user_id: string;
  title: string;
  status: string;
  created_at: string;
  total_tests?: number;
  completed_tests?: number;
  pending_tests?: number;
  items: BatteryItem[];
  validity_summary?: BatteryValiditySummary | null;
}

export interface UsersListFilters {
  search?: string;
  mode?: string;
  is_active?: boolean;
  created_after?: string;
  created_before?: string;
}

export const adminUsersService = {
  list: async (
    page = 1,
    pageSize = 20,
    filters?: UsersListFilters
  ): Promise<UsersListResponse> => {
    const params: Record<string, unknown> = { page, page_size: pageSize };
    if (filters?.search) params.search = filters.search;
    if (filters?.mode !== undefined && filters.mode !== "") params.mode = filters.mode;
    if (filters?.is_active !== undefined) params.is_active = filters.is_active;
    if (filters?.created_after) params.created_after = filters.created_after;
    if (filters?.created_before) params.created_before = filters.created_before;
    const response = await API.get<UsersListResponse>(`/admin/users`, { params });
    return response.data;
  },

  getStats: async (): Promise<{
    total_users: number;
    total_assignments: number;
    completed_assignments: number;
    total_sessions: number;
  }> => {
    const response = await API.get("/admin/stats");
    return response.data;
  },

  create: async (data: UserCreateData): Promise<UserCreateResponse> => {
    const response = await API.post<UserCreateResponse>("/admin/users", data);
    return response.data;
  },

  sendCredentials: async (
    userId: string
  ): Promise<{ sent: boolean; message?: string; temp_password?: string; email?: string }> => {
    const response = await API.post<{ sent: boolean; message?: string; temp_password?: string; email?: string }>(
      `/admin/users/${userId}/send-credentials`
    );
    return response.data;
  },

  get: async (userId: string) => {
    const response = await API.get<UserListItem>(`/admin/users/${userId}`);
    return response.data;
  },

  updateUser: async (
    userId: string,
    data: { name?: string; email?: string; is_active?: boolean; mode?: string }
  ): Promise<UserListItem> => {
    const response = await API.put<UserListItem>(`/admin/users/${userId}`, data);
    return response.data;
  },

  setMode: async (userId: string, mode: string): Promise<{ mode: string }> => {
    const response = await API.post<{ mode: string }>(`/admin/users/${userId}/mode`, { mode });
    return response.data;
  },

  deleteUser: async (userId: string): Promise<void> => {
    await API.delete(`/admin/users/${userId}`);
  },

  createAssignments: async (
    userId: string,
    assignments: { test: string; order: number; weight?: number }[],
    batteryTitle?: string
  ): Promise<{ message: string }> => {
    const response = await API.post<{ message: string }>(`/admin/users/${userId}/assignments`, {
      battery_title: batteryTitle,
      assignments,
    });
    return response.data;
  },

  deleteAssignment: async (userId: string, assignmentId: string): Promise<void> => {
    await API.delete(`/admin/users/${userId}/assignments/${assignmentId}`);
  },

  reassignAssignment: async (userId: string, assignmentId: string): Promise<void> => {
    await API.post(`/admin/users/${userId}/assignments/${assignmentId}/reassign`);
  },

  getFormulary: async (
    q = "",
    limit = 20,
    page = 1
  ): Promise<{ items: { id: string; name: string; common_strengths: string[]; common_forms: string[] }[]; total: number; page: number; page_size: number }> => {
    const response = await API.get("/admin/formulary", { params: { q, limit, page } });
    return response.data;
  },

  createFormularyItem: async (data: {
    name: string;
    common_strengths?: string[];
    common_forms?: string[];
  }): Promise<{ id: string; name: string; common_strengths: string[]; common_forms: string[] }> => {
    const response = await API.post("/admin/formulary", data);
    return response.data;
  },

  updateFormularyItem: async (
    id: string,
    data: { name?: string; common_strengths?: string[]; common_forms?: string[] }
  ): Promise<{ id: string; name: string; common_strengths: string[]; common_forms: string[] }> => {
    const response = await API.put(`/admin/formulary/${id}`, data);
    return response.data;
  },

  deleteFormularyItem: async (id: string): Promise<void> => {
    await API.delete(`/admin/formulary/${id}`);
  },

  getIntake: async (
    userId: string
  ): Promise<{
    intake_data: Record<string, unknown> | null;
    medication_status?: boolean;
    on_med_flag?: boolean;
    medications?: {
      id: string;
      name: string;
      strength: string | null;
      form: string | null;
      quantity: number | null;
      time_last_taken: string | null;
      schedule_time: string | null;
      duration_days: number | null;
      is_stopped: boolean;
    }[];
  }> => {
    const response = await API.get(`/admin/users/${userId}/intake`);
    return response.data;
  },

  updateIntake: async (
    userId: string,
    data: {
      date_of_birth?: string;
      adhd_history?: boolean;
      medication_history?: string;
      medication_status?: boolean;
      took_medication_today?: boolean;
      medications?: {
        name: string;
        strength?: string;
        form?: string;
        quantity?: number;
        time_last_taken?: string;
        schedule_time?: string;
        duration_days?: number;
        is_stopped?: boolean;
      }[];
    }
  ) => {
    const response = await API.put(`/admin/users/${userId}/intake`, data);
    return response.data;
  },

  getSessions: async (
    userId: string,
    page = 1,
    pageSize = 10,
    includeDeleted = false
  ): Promise<{
    sessions: {
      session_id: string;
      created_at: string | null;
      is_deleted: boolean;
      validity_summary?: {
        overall_confidence_score?: number | null;
        validity_classification?: string | null;
        assessment_interpretable?: boolean | null;
      } | null;
    }[];
    total: number;
    page: number;
    page_size: number;
  }> => {
    const response = await API.get(`/admin/users/${userId}/sessions`, {
      params: { page, page_size: pageSize, include_deleted: includeDeleted },
    });
    return response.data;
  },

  getAssignments: async (userId: string): Promise<Assignment[]> => {
    const response = await API.get<Assignment[]>(`/admin/users/${userId}/assignments`);
    return response.data;
  },

  updateAssignments: async (
    userId: string,
    assignments: { test: string; order: number; weight?: number }[],
    batteryTitle?: string,
    batteryId?: string
  ): Promise<{ message: string }> => {
    const response = await API.put<{ message: string }>(`/admin/users/${userId}/assignments`, {
      battery_id: batteryId,
      battery_title: batteryTitle,
      assignments,
    });
    return response.data;
  },

  getBatteries: async (userId: string): Promise<Battery[]> => {
    const response = await API.get<Battery[]>(`/admin/users/${userId}/batteries`);
    return response.data;
  },

  activateBattery: async (userId: string, batteryId: string): Promise<{ message: string }> => {
    const response = await API.post<{ message: string }>(
      `/admin/users/${userId}/batteries/${batteryId}/activate`
    );
    return response.data;
  },

  deleteBattery: async (userId: string, batteryId: string): Promise<void> => {
    await API.delete(`/admin/users/${userId}/batteries/${batteryId}`);
  },
};
