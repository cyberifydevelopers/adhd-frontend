import type { TaskResultItem } from "@/services";
import { canonicalTaskKey } from "@/utils/taskAttainmentPercent";

type SessionLite = { session_id: string; created_at?: string | null };

/**
 * Same idea as backend `_latest_task_performance_in_battery`: for each test, use the most recent
 * session in this battery (ordered newest-first) that actually has a saved `TaskResult` row.
 * This matches aggregated "Battery weights" outcomes when the latest battery visit did not repeat every test.
 */
export function flattenLatestTaskFeedForBattery(
  results: TaskResultItem[],
  batterySessionsNewestFirst: SessionLite[],
): { task_name: string; metrics: Record<string, unknown>; created_at: string | null }[] {
  const byKey = new Map<string, TaskResultItem>();
  for (const s of batterySessionsNewestFirst) {
    for (const r of results) {
      if (r.session_id !== s.session_id) continue;
      const k = canonicalTaskKey(r.task_name);
      if (byKey.has(k)) continue;
      byKey.set(k, r);
    }
  }
  return [...byKey.values()].map((r) => ({
    task_name: r.task_name,
    metrics: r.metrics,
    created_at: r.created_at,
  }));
}
