import API from "@/lib/apiClient";

export interface SessionDetail {
  session_id: string;
  user_id: string;
  user_name: string | null;
  battery_id: string | null;
  battery_title: string | null;
  mode: string;
  protocol_version: string;
  created_at: string | null;
  task_results: { task_name: string; metrics: Record<string, unknown> }[];
}

export interface TrialEventItem {
  trial_index: number;
  reaction_time_ms?: number | null;
  task_name: string;
  stimulus_onset_ms?: number;
  keypress_ms?: number | null;
  response_key?: string | null;
  correct_key?: string | null;
  is_correct?: boolean | null;
  event_type?: string;
  isi_ms?: number | null;
}

export interface TrialEventFull extends TrialEventItem {
  stimulus_onset_ms: number;
  keypress_ms: number | null;
  reaction_time_ms: number | null;
  response_key: string | null;
  correct_key: string | null;
  is_correct: boolean | null;
  event_type: string;
}

export interface ValidityPointBreakdown {
  anticipatory?: number;
  omissions?: number;
  side_bias?: number;
  random_responding?: number;
  practice_not_passed?: number;
  device_timing?: number;
  unstable_at_max?: number;
  cross_test_inconsistency?: number;
  total_points?: number;
}

export interface SessionQcResult {
  validity_score: number;
  flags: {
    anticipatory_rt_count?: number;
    rt_rounding?: {
      flagged: boolean;
      round_10_pct?: number;
      round_50_pct?: number;
      round_100_pct?: number;
      n_rt?: number;
    };
    random_responding?: { flagged: boolean; sd_rt?: number };
    isi_check?: { flagged: boolean; n?: number; mean_isi?: number; out_of_range?: number };
    extreme_values?: { trial_index: number; rt_ms: number; z_score: number }[];
    validity_contributions?: { flag: string; penalty: number }[];
    per_task?: Record<string, { n: number; mean_rt: number; extreme_count: number }>;
    confidence_tier?: string;
    validity_point_breakdown?: ValidityPointBreakdown;
    per_task_validity_points?: Record<
      string,
      { points: ValidityPointBreakdown; matched_flags: string[] }
    >;
  };
  generated_at?: string | null;
  overall_confidence_score?: number | null;
  validity_classification?: string | null;
  confidence_tier?: string | null;
  task_confidence_score?: Record<string, number> | null;
  task_validity_flags?: Record<string, string[]> | null;
  cross_test_flags?: string[] | null;
  practice_passed?: boolean | null;
  low_confidence_flag?: boolean | null;
  technical_issue_flag?: boolean | null;
  assessment_interpretable?: boolean | null;
}

export const adminSessionsService = {
  getDetail: async (sessionId: string): Promise<SessionDetail> => {
    const response = await API.get<SessionDetail>(`/admin/sessions/${sessionId}`);
    return response.data;
  },

  getSstConvergence: async (
    sessionId: string
  ): Promise<{
    converged: boolean | null;
    stuck_at_floor: boolean;
    stuck_at_ceiling: boolean;
    message: string;
  }> => {
    const response = await API.get(`/admin/sessions/${sessionId}/tasks/sst/convergence`);
    return response.data;
  },

  getTrialEvents: async (
    sessionId: string,
    taskName?: string,
    full = false
  ): Promise<TrialEventItem[]> => {
    const params: Record<string, unknown> = full ? { full: true } : {};
    if (taskName) params.task_name = taskName;
    const response = await API.get<TrialEventItem[]>(
      `/admin/sessions/${sessionId}/trial-events`,
      { params }
    );
    return response.data;
  },

  getQc: async (sessionId: string): Promise<SessionQcResult> => {
    const response = await API.get<SessionQcResult>(`/admin/sessions/${sessionId}/qc`);
    return response.data;
  },

  validateQc: async (sessionId: string): Promise<SessionQcResult> => {
    const response = await API.post<SessionQcResult>(`/admin/sessions/${sessionId}/qc/validate`);
    return response.data;
  },

  softDeleteSession: async (
    sessionId: string
  ): Promise<{ status: string; session_id: string }> => {
    const response = await API.delete<{ status: string; session_id: string }>(
      `/admin/sessions/${sessionId}`
    );
    return response.data;
  },

  hardDeleteSession: async (
    sessionId: string
  ): Promise<{ status: string; session_id: string }> => {
    const response = await API.delete<{ status: string; session_id: string }>(
      `/admin/sessions/${sessionId}/permanent`
    );
    return response.data;
  },
};
