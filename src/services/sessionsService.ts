import API from "@/lib/apiClient";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { takeMainAdaptiveDebugPayload } from "@/lib/mainAdaptiveDebugSnapshot";

export interface SessionCreateResponse {
  session_id: string;
  user_id: string;
  mode: string;
  protocol_version: string;
  norm_version: string;
}

export interface StoppingCheckResponse {
  should_stop: boolean;
  ci_width: number;
  met_floor: boolean;
  time_on_task_slope_ms_per_quarter?: number | null;
}

export const sessionsService = {
  create: async (taskName: string, deviceInfo?: Record<string, unknown>): Promise<SessionCreateResponse> => {
    const response = await API.post<SessionCreateResponse>("/sessions/me", {
      task_name: taskName,
      device_info: deviceInfo ?? null,
    });
    return response.data;
  },

  postEvents: async (sessionId: string, events: Record<string, unknown>[]): Promise<{ accepted: number }> => {
    const response = await API.post<{ accepted: number }>(`/sessions/${sessionId}/events`, { events });
    return response.data;
  },

  postBlocks: async (
    sessionId: string,
    data: {
      task_name: string;
      block_index: number;
      practice_pass?: boolean;
      practice_accuracy?: number;
      practice_trial_count?: number;
      low_confidence_flag?: boolean;
      practice_blocks_completed?: number;
      practice_error_pattern?: string;
      dropped_frame_count?: number;
      block_start_ts: number;
      block_end_ts: number;
    }
  ): Promise<{ accepted: boolean }> => {
    const response = await API.post<{ accepted: boolean }>(`/sessions/${sessionId}/blocks`, data);
    return response.data;
  },

  postDroppedFrames: async (
    sessionId: string,
    data: {
      task_name: string;
      block_index: number;
      dropped_frame_count: number;
      block_start_ts?: number;
      block_end_ts?: number;
    }
  ): Promise<{ accepted: boolean }> => {
    const response = await API.post<{ accepted: boolean }>(`/sessions/${sessionId}/dropped-frames`, data);
    return response.data;
  },

  getCptStoppingCheck: async (sessionId: string): Promise<StoppingCheckResponse> => {
    const response = await API.get<StoppingCheckResponse>(`/sessions/${sessionId}/tasks/cpt/stopping-check`);
    return response.data;
  },

  getSstStoppingCheck: async (sessionId: string): Promise<StoppingCheckResponse> => {
    const response = await API.get<StoppingCheckResponse>(`/sessions/${sessionId}/tasks/sst/stopping-check`);
    return response.data;
  },

  scoreCpt: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("cpt");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/cpt/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreSst: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("sst");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/sst/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreDigitSpan: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("digit_span");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/digit-span/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreTimeEstimation: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("time_estimation");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/time-estimation/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreSimpleRt: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("simple_rt");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/simple-rt/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreChoiceRt: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("choice_rt");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/choice-rt/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreFlanker: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("flanker");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/flanker/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreTaskSwitching: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("task_switching");
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/task-switching/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  scoreDelayDiscounting: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("delay_discounting");
    const response = await API.post<Record<string, unknown>>(
      `/sessions/${sessionId}/tasks/delay-discounting/score`,
      { main_adaptive_debug: dbg ?? undefined },
    );
    return response.data;
  },

  scorePsychomotorSpeed: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("psychomotor_speed");
    const response = await API.post<Record<string, unknown>>(
      `/sessions/${sessionId}/tasks/psychomotor-speed/score`,
      { main_adaptive_debug: dbg ?? undefined },
    );
    return response.data;
  },

  scoreWmDistraction: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("wm_distraction");
    const response = await API.post<Record<string, unknown>>(
      `/sessions/${sessionId}/tasks/wm-distraction/score`,
      { main_adaptive_debug: dbg ?? undefined },
    );
    return response.data;
  },

  scoreSetShiftingMini: async (sessionId: string) => {
    const dbg = takeMainAdaptiveDebugPayload("set_shifting_mini");
    const response = await API.post<Record<string, unknown>>(
      `/sessions/${sessionId}/tasks/set-shifting-mini/score`,
      { main_adaptive_debug: dbg ?? undefined },
    );
    return response.data;
  },

  scoreSubstanceModule: async (sessionId: string, taskName: string) => {
    const dbg = takeMainAdaptiveDebugPayload(taskName as MainAdaptiveTrialTaskKey);
    const response = await API.post<Record<string, unknown>>(`/sessions/${sessionId}/tasks/${taskName}/score`, {
      main_adaptive_debug: dbg ?? undefined,
    });
    return response.data;
  },

  getQc: async (
    sessionId: string
  ): Promise<{
    validity_score: number;
    flags: Record<string, unknown>;
    confidence_tier?: string | null;
    overall_confidence_score?: number | null;
    validity_classification?: string | null;
    task_confidence_score?: Record<string, number> | null;
    task_validity_flags?: Record<string, string[]> | null;
    cross_test_flags?: string[] | null;
    practice_passed?: boolean | null;
    low_confidence_flag?: boolean | null;
    technical_issue_flag?: boolean | null;
    assessment_interpretable?: boolean | null;
    generated_at?: string | null;
  }> => {
    const response = await API.get(`/sessions/${sessionId}/qc`);
    return response.data;
  },

  validateQc: async (
    sessionId: string
  ): Promise<{
    validity_score: number;
    flags: Record<string, unknown>;
    confidence_tier?: string | null;
    overall_confidence_score?: number | null;
    validity_classification?: string | null;
    task_confidence_score?: Record<string, number> | null;
    task_validity_flags?: Record<string, string[]> | null;
    cross_test_flags?: string[] | null;
    practice_passed?: boolean | null;
    low_confidence_flag?: boolean | null;
    technical_issue_flag?: boolean | null;
    assessment_interpretable?: boolean | null;
    generated_at?: string | null;
  }> => {
    const response = await API.post(`/sessions/${sessionId}/qc/validate`);
    return response.data;
  },

  generateReport: async (sessionId: string) => {
    const response = await API.post(`/sessions/${sessionId}/report/generate`);
    return response.data;
  },

  getReport: async (
    sessionId: string
  ): Promise<{
    per_task: { task_name: string; metrics: Record<string, unknown> }[];
    domain_summary: { domain: string; label: string; tasks: { task_name: string; metrics: Record<string, unknown> }[] }[];
    caveats: { caveat_type: string; message: string }[];
    footer?: string;
    generated_at?: string;
    narrative?: {
      summary_paragraph?: string;
      domain_narratives?: Record<string, string>;
      caveat_statements?: string[];
      footer?: string;
      narrative_fallback?: boolean;
    };
  }> => {
    const response = await API.get(`/sessions/${sessionId}/report`);
    return response.data;
  },

  getLongitudinal: async (sessionId: string): Promise<
    | { status: "no_baseline"; message: string }
    | {
        domains: { domain: string; delta_z: number; ci_low?: number; ci_high?: number }[];
        baseline_session_id?: string;
      }
  > => {
    const response = await API.get(`/sessions/${sessionId}/report/longitudinal`);
    return response.data;
  },

  getTreatmentPlan: async (
    sessionId: string,
    topN = 3
  ): Promise<{
    anchor_task?: string;
    domains_to_retest?: { domain: string; z_score: number; abnormality: string }[];
    precision_reached?: boolean;
  }> => {
    const response = await API.get(`/sessions/${sessionId}/report/treatment-plan`, {
      params: { top_n: topN },
    });
    return response.data;
  },

  getDomainRanking: async (
    sessionId: string
  ): Promise<{ domain: string; z_score: number; abnormality: string }[]> => {
    const response = await API.get(`/sessions/${sessionId}/report/domain-ranking`);
    return response.data;
  },

  getCptQc: async (sessionId: string): Promise<{
    anticipatory_responses?: boolean;
    low_variance?: boolean;
    disengagement_run?: boolean;
  }> => {
    const response = await API.post(`/sessions/${sessionId}/tasks/cpt/qc`);
    return response.data;
  },
};
