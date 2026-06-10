import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  usersMeService,
  type Assignment,
  type MyAssignmentsPayload,
} from "@/services/usersMeService";

/** Fetches /users/me/assignments with fallback to me.assignments from auth store. */
export function useMyAssignments(enabled = true) {
  const me = useAuthStore((s) => s.me);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [serverActiveBatteryId, setServerActiveBatteryId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  const applyPayload = useCallback((payload: MyAssignmentsPayload) => {
    setAssignments(payload.assignments);
    setServerActiveBatteryId(payload.active_battery_id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || me?.role !== "user") return;
    setLoading(true);
    try {
      const payload = await usersMeService.getAssignments();
      applyPayload(payload);
    } catch {
      setAssignments((me?.assignments as Assignment[] | undefined) ?? []);
      setServerActiveBatteryId(null);
    } finally {
      setLoading(false);
    }
  }, [applyPayload, enabled, me?.assignments, me?.role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    assignments,
    serverActiveBatteryId,
    loading,
    refresh,
  };
}
