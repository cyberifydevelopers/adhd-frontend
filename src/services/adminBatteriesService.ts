import API from "@/lib/apiClient";
import type { SessionQcResult, ValidityPointBreakdown } from "./adminSessionsService";

export interface BatterySessionQcSummary {
  session_id: string;
  task_name: string | null;
  created_at: string | null;
  overall_confidence_score: number | null;
  validity_classification: string | null;
  confidence_tier?: string | null;
  practice_passed: boolean | null;
  low_confidence_flag: boolean | null;
  technical_issue_flag: boolean | null;
  assessment_interpretable: boolean | null;
  cross_test_flags?: string[];
}

export interface BatteryQcResult extends Omit<SessionQcResult, "flags"> {
  battery_id: string;
  battery_title: string;
  user_id: string;
  battery_status?: string;
  session_summaries: BatterySessionQcSummary[];
  flags: SessionQcResult["flags"] & {
    session_count?: number;
    sessions_with_qc?: number;
    task_count?: number;
    validity_point_breakdown?: ValidityPointBreakdown;
  };
}

export const adminBatteriesService = {
  getQc: async (userId: string, batteryId: string): Promise<BatteryQcResult> => {
    const response = await API.get<BatteryQcResult>(`/admin/users/${userId}/batteries/${batteryId}/qc`);
    return response.data;
  },

  validateQc: async (userId: string, batteryId: string): Promise<BatteryQcResult> => {
    const response = await API.post<BatteryQcResult>(
      `/admin/users/${userId}/batteries/${batteryId}/qc/validate`,
    );
    return response.data;
  },
};
