import type { Assignment } from "@/services/usersMeService";

export type AssignmentRow = Pick<
  Assignment,
  "battery_id" | "battery_title" | "status" | "test_order" | "test_name"
>;

/** Resolve active battery id (server truth first, then client fallbacks). */
export function resolveActiveBatteryId(
  sortedAssignments: AssignmentRow[],
  serverActiveBatteryId: string | null,
): string | null {
  let activeBatteryId: string | null =
    serverActiveBatteryId &&
    sortedAssignments.some((a) => a.battery_id === serverActiveBatteryId)
      ? serverActiveBatteryId
      : null;

  if (!activeBatteryId) {
    activeBatteryId =
      sortedAssignments.find(
        (a) =>
          a.battery_id &&
          (a.status === "pending" || a.status === "in_progress"),
      )?.battery_id ?? null;
  }

  const minOrderByBattery = new Map<string, number>();
  for (const a of sortedAssignments) {
    if (!a.battery_id) continue;
    const prev = minOrderByBattery.get(a.battery_id);
    if (prev === undefined || a.test_order < prev) {
      minOrderByBattery.set(a.battery_id, a.test_order);
    }
  }
  const batteryIdsInOrder = [...minOrderByBattery.entries()]
    .sort(([, oa], [, ob]) => oa - ob)
    .map(([bid]) => bid);

  if (!activeBatteryId && batteryIdsInOrder.length > 0) {
    for (const bid of batteryIdsInOrder) {
      const rows = sortedAssignments.filter((a) => a.battery_id === bid);
      const hasCompleted = rows.some((a) => a.status === "completed");
      const hasOpen = rows.some(
        (a) => a.status === "pending" || a.status === "in_progress",
      );
      const hasQueued = rows.some((a) => a.status === "upcoming");
      if (hasCompleted && (hasOpen || hasQueued)) {
        activeBatteryId = bid;
        break;
      }
    }
  }
  if (!activeBatteryId && batteryIdsInOrder.length === 1) {
    activeBatteryId = batteryIdsInOrder[0];
  }
  return activeBatteryId;
}

/** First pending / in-progress task in the active battery. */
export function findNextPendingTaskInActiveBattery(
  rows: AssignmentRow[],
  serverActiveBatteryId: string | null,
): string | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.test_order - b.test_order);
  const activeCandidates = sorted.filter(
    (a) => (a.status || "").toLowerCase() !== "upcoming",
  );
  const activeBatteryId = resolveActiveBatteryId(activeCandidates, serverActiveBatteryId);
  const visible = activeBatteryId
    ? activeCandidates.filter((a) => a.battery_id === activeBatteryId)
    : activeCandidates;
  const next = visible.find((a) => {
    const st = (a.status || "").toLowerCase();
    return st === "pending" || st === "in_progress";
  });
  return next?.test_name ?? null;
}
