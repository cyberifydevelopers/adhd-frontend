import API from "@/lib/apiClient";
import type { BatteryQcResult } from "./adminBatteriesService";

export interface Assignment {
  assignment_id: string;
  battery_id?: string | null;
  battery_title?: string | null;
  battery_item_id?: string | null;
  test_name: string;
  test_order: number;
  /** Relative weight within the battery; normalized to shares that sum to 100% across that battery. */
  weight?: number;
  status: string;
  assigned_at: string;
  completed_at: string | null;
}

/** GET /users/me/assignments — aligns "active" battery with server (admin in_progress). */
export interface MyAssignmentsPayload {
  active_battery_id: string | null;
  assignments: Assignment[];
}

export interface TaskResultItem {
  session_id: string;
  created_at: string | null;
  task_name: string;
  metrics: Record<string, unknown>;
}

export interface AggregatedDomain {
  domain: string;
  label: string;
  domain_z_score: number | null;
  abnormality_probability: number | null;
  severity_band: string;
  signal: "normal" | "mild_flag" | "strong_flag";
  signal_severity: number;
  session_count: number;
}

export interface ValiditySummary {
  overall_confidence_score?: number | null;
  validity_classification?: string | null;
  assessment_interpretable?: boolean | null;
  practice_passed?: boolean | null;
  low_confidence_flag?: boolean | null;
  technical_issue_flag?: boolean | null;
  cross_test_flags?: string[];
  battery_id?: string;
}

export interface AggregatedReport {
  session_count: number;
  method: string;
  half_life_days: number;
  domain_summary: AggregatedDomain[];
  adhd_severity_index: number | null;
  overall_interpretation: "typical" | "possible_adhd" | "strongly_consistent";
  overall_interpretation_detail: {
    label: string;
    strong_count: number;
    mild_count: number;
    normal_count: number;
  };
  session_breakdown: {
    session_id: string;
    created_at: string | null;
    battery_id?: string | null;
    battery_title?: string | null;
    weight: number;
    domain_z_scores: Record<string, number>;
    validity_summary?: ValiditySummary | null;
  }[];
  /** Each battery is 100%; items are test shares from clinical assignment */
  battery_composition?: {
    battery_id: string;
    battery_title: string;
    battery_status?: string;
    items: {
      test_name: string;
      weight: number;
      weight_percent: number;
      /** Latest normed outcome for this task within sessions tied to this battery */
      performance?: {
        mean_z: number | null;
        /** 0–100 trial attainment (higher=better); from stored metrics when available */
        performance_percent?: number | null;
        /** 0–100 clinical severity from mean z (same as domain signal severity) */
        severity_index?: number | null;
        severity_band: string;
        signal: string;
        session_date: string | null;
        summary: string;
      } | null;
    }[];
  }[];
  error?: string;
  validity_summary?: ValiditySummary | null;
}

export const usersMeService = {
  getAssignments: async (): Promise<MyAssignmentsPayload> => {
    const response = await API.get<MyAssignmentsPayload>("/users/me/assignments");
    return response.data;
  },

  getMode: async (): Promise<{ mode: string }> => {
    const response = await API.get<{ mode: string }>("/users/me/mode");
    return response.data;
  },

  getSessions: async (): Promise<
    {
      session_id: string;
      created_at: string | null;
      mode: string;
      battery_id?: string | null;
      battery_title?: string | null;
      validity_summary?: ValiditySummary | null;
    }[]
  > => {
    const response = await API.get("/users/me/sessions");
    return response.data;
  },

  getTaskResults: async (): Promise<TaskResultItem[]> => {
    const response = await API.get<TaskResultItem[]>("/users/me/task-results");
    return response.data;
  },

  getAggregatedReport: async (): Promise<AggregatedReport> => {
    const response = await API.get<AggregatedReport>("/users/me/report/aggregated");
    return response.data;
  },

  getIntake: async (): Promise<{
    intake_data?: Record<string, unknown> | null;
    medication_status?: boolean | null;
    on_med_flag?: boolean | null;
    medications?: {
      name: string;
      strength: string | null;
      form: string | null;
      quantity: number | null;
      time_last_taken: string | null;
      schedule_time?: string | null;
      duration_days?: number | null;
      is_stopped?: boolean;
    }[];
  }> => {
    const response = await API.get("/users/me/intake");
    return response.data;
  },

  updateIntake: async (data: {
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
  }): Promise<void> => {
    await API.put("/users/me/intake", data);
  },

  getFormulary: async (q = "", limit = 20): Promise<{
    items: { id: string; name: string; common_strengths: string[]; common_forms: string[] }[];
    total: number;
    page: number;
    page_size: number;
  }> => {
    const response = await API.get("/users/me/formulary", { params: { q, limit } });
    return response.data;
  },

  updateProfile: async (data: { name?: string }): Promise<void> => {
    await API.patch("/users/me/profile", data);
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    await API.post("/users/me/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  getBatteryQc: async (batteryId: string): Promise<BatteryQcResult> => {
    const response = await API.get<BatteryQcResult>(`/users/me/batteries/${batteryId}/qc`);
    return response.data;
  },

  validateBatteryQc: async (batteryId: string): Promise<BatteryQcResult> => {
    const response = await API.post<BatteryQcResult>(`/users/me/batteries/${batteryId}/qc/validate`);
    return response.data;
  },
};
