import API from "@/lib/apiClient";

export interface AuditLogItem {
  id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  target_id: string | null;
  target_type: string | null;
  timestamp: string;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export const adminAuditService = {
  list: async (page = 1, pageSize = 50): Promise<AuditLogResponse> => {
    const response = await API.get<AuditLogResponse>("/admin/audit-logs", {
      params: { page, page_size: pageSize },
    });
    return response.data;
  },
};
