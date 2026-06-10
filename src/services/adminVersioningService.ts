import API from "@/lib/apiClient";

export const adminVersioningService = {
  getProtocolHistory: async () => {
    const response = await API.get<{ timestamp: string | null; target_type: string | null }[]>(
      "/admin/protocol/history"
    );
    return response.data;
  },

  getProtocol: async () => {
    const response = await API.get<{ version: string; config: Record<string, unknown>; active: boolean }[]>(
      "/admin/protocol"
    );
    return response.data;
  },

  updateProtocol: async (data: { version: string; config?: Record<string, unknown>; active?: boolean }) => {
    const response = await API.put<{ version: string; active: boolean }>("/admin/protocol", data);
    return response.data;
  },

  getNorms: async () => {
    const response = await API.get<{ version: string; keys: string[] }[]>("/admin/norms");
    return response.data;
  },

  uploadNorms: async (data: { version: string; population_data: Record<string, unknown> }) => {
    const response = await API.post<{ version: string; status: string }>("/admin/norms", data);
    return response.data;
  },

  rescoreSession: async (sessionId: string) => {
    const response = await API.post<{ session_id: string; tasks_scored: string[] }>(
      `/admin/rescore/${sessionId}`
    );
    return response.data;
  },
};
