import API from "@/lib/apiClient";
import type {
  CATRoutingDecision,
  CheckpointRequest,
  CheckpointResponse,
  RoutingDecisionRequest,
  TaskTrialConfig,
} from "@/types/cat";

export const catService = {
  requestRoutingDecision: async (
    sessionId: string,
    data: RoutingDecisionRequest,
  ): Promise<CATRoutingDecision> => {
    const response = await API.post<CATRoutingDecision>(
      `/sessions/${sessionId}/cat/routing-decision`,
      data,
    );
    return response.data;
  },

  getTaskConfig: async (
    sessionId: string,
    taskName: string,
  ): Promise<TaskTrialConfig> => {
    const response = await API.get<TaskTrialConfig>(
      `/sessions/${sessionId}/cat/task-config/${taskName}`,
    );
    return response.data;
  },

  requestCheckpoint: async (
    sessionId: string,
    data: CheckpointRequest,
  ): Promise<CheckpointResponse> => {
    const response = await API.post<CheckpointResponse>(
      `/sessions/${sessionId}/cat/checkpoint`,
      data,
    );
    return response.data;
  },
};
