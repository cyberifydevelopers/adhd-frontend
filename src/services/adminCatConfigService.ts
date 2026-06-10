import API from "@/lib/apiClient";

export interface CATConfigData {
  config_id: string | null;
  mode: string;
  anchor_tasks: string[];
  optional_task_pool: string[];
  min_trials_per_task: Record<string, number>;
  max_trials_per_task: Record<string, number>;
  practice_config: Record<
    string,
    {
      min_trials?: number;
      max_trials?: number;
      evaluation_interval?: number;
      pass_threshold?: number;
      continue_threshold?: number;
      final_trial_count?: number;
    }
  > | null;
  domain_confidence_thresholds: Record<string, number>;
  /** Relative weights per master-list task (each 0.1–1); normalized per assigned battery to total 100% of session */
  task_weights: Record<string, number>;
  stop_battery_threshold: number;
  llm_model: string;
  llm_temperature: number;
  checkpoint_interval: number;
  system_prompt_template: string | null;
  created_by_admin_id: string | null;
  created_at: string | null;
  is_active: boolean;
}

export interface MasterTaskItem {
  task_name: string;
  display_name: string;
  domain: string;
  domain_label: string;
}

export interface CATDecisionItem {
  decision_id: string;
  session_id: string;
  decision_trigger: string;
  task_completed: string | null;
  llm_model: string | null;
  llm_input_json: Record<string, unknown> | null;
  llm_raw_response: string | null;
  parsed_decision_json: Record<string, unknown> | null;
  used_fallback: boolean;
  fallback_reason: string | null;
  created_at: string | null;
}

export const adminCatConfigService = {
  getConfig: async (mode: string): Promise<CATConfigData> => {
    const res = await API.get<CATConfigData>(`/admin/cat/config/${mode}`);
    return res.data;
  },

  saveConfig: async (data: Omit<CATConfigData, "config_id" | "created_by_admin_id" | "created_at" | "is_active">): Promise<CATConfigData> => {
    const res = await API.post<CATConfigData>("/admin/cat/config", data);
    return res.data;
  },

  getConfigHistory: async (mode: string): Promise<{ configs: CATConfigData[] }> => {
    const res = await API.get<{ configs: CATConfigData[] }>(`/admin/cat/config/history/${mode}`);
    return res.data;
  },

  activateConfig: async (configId: string): Promise<CATConfigData> => {
    const res = await API.post<CATConfigData>(`/admin/cat/config/${configId}/activate`);
    return res.data;
  },

  getMasterTaskList: async (): Promise<MasterTaskItem[]> => {
    const res = await API.get<MasterTaskItem[]>("/admin/cat/tasks/master-list");
    return res.data;
  },

  getSessionDecisions: async (sessionId: string): Promise<CATDecisionItem[]> => {
    const res = await API.get<CATDecisionItem[]>(`/admin/sessions/${sessionId}/cat/decisions`);
    return res.data;
  },
};
