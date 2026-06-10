import { getTaskDisplayName } from "@/config/tasks";
import {
  canonicalTaskKey,
  taskPerformancePercent,
  type ReportPerTaskEntry,
} from "@/utils/taskAttainmentPercent";

/** Rows use the same grouping key as sessions (`battery_id` or `__unassigned__`). */
export function orderedAssignedTestNamesForBattery(
  assignments: { battery_id?: string | null; test_name: string; test_order: number }[],
  batteryGroupKey: string | null,
): string[] {
  if (!batteryGroupKey) return [];
  return assignments
    .filter((a) => (a.battery_id ?? "__unassigned__") === batteryGroupKey)
    .sort((a, b) => a.test_order - b.test_order)
    .map((a) => a.test_name);
}

/** Share of battery (0–100) from assignment weights, keyed by canonical task id — same basis as Battery composition strips. */
export function assignmentWeightPercentsForBatteryGroup(
  assignments: { battery_id?: string | null; test_name: string; weight?: number }[],
  batteryGroupKey: string | null,
): Map<string, number> {
  const m = new Map<string, number>();
  if (!batteryGroupKey) return m;
  const slice = assignments.filter((a) => (a.battery_id ?? "__unassigned__") === batteryGroupKey);
  const total = slice.reduce((s, a) => s + (a.weight ?? 1), 0) || 1;
  for (const a of slice) {
    m.set(canonicalTaskKey(a.test_name), ((a.weight ?? 1) / total) * 100);
  }
  return m;
}

export type BatteryTaskCompareRow = {
  key: string;
  displayName: string;
  pct1: number | null;
  pct2: number | null;
  /** Normalized assignment share for this battery (for discrete score denominator). */
  weightPct1: number | null;
  weightPct2: number | null;
};

/** Union input for merging session task saves with `/sessions/.../report` per_task lists. */
export type PerTaskSourceRow = {
  task_name: string;
  metrics?: Record<string, unknown>;
  z_scores?: Record<string, unknown>;
};

/**
 * The scored report JSON often lists only tasks that rolled into domains; `/users/me/task-results` carries every
 * activity saved on that session. Merge so comparison tables mirror “all tests in this battery run.”
 */
export function mergeReportPerTaskWithSessionTaskResults(
  reportPerTask: PerTaskSourceRow[] | undefined,
  sessionResults: { task_name: string; metrics?: Record<string, unknown>; created_at?: string | null }[] | undefined,
): PerTaskSourceRow[] {
  const sorted = [...(sessionResults ?? [])].sort((a, b) => {
    const da = a.created_at ? Date.parse(a.created_at) : 0;
    const db = b.created_at ? Date.parse(b.created_at) : 0;
    return db - da;
  });

  const map = new Map<string, PerTaskSourceRow>();

  for (const tr of sorted) {
    const k = canonicalTaskKey(tr.task_name);
    if (!map.has(k)) {
      map.set(k, { task_name: tr.task_name, metrics: tr.metrics });
    }
  }

  for (const t of reportPerTask ?? []) {
    const k = canonicalTaskKey(t.task_name);
    const prev = map.get(k);
    const hasReportMetrics = t.metrics != null && Object.keys(t.metrics).length > 0;
    map.set(k, {
      task_name: t.task_name,
      metrics: hasReportMetrics ? t.metrics : prev?.metrics ?? t.metrics,
      z_scores: t.z_scores ?? prev?.z_scores,
    });
  }

  return [...map.values()];
}

function toEntry(t: {
  task_name: string;
  metrics?: Record<string, unknown>;
  z_scores?: Record<string, unknown>;
}): ReportPerTaskEntry {
  return {
    task_name: t.task_name,
    metrics: t.metrics,
    z_scores: t.z_scores,
  };
}

export type BatteryCompareRowOptions = {
  /** Every test assigned to battery 1 — rows appear even with no session/report data (shows —). */
  assignedTestNamesA?: string[];
  assignedTestNamesB?: string[];
  /** Map canonical task → weight % of that battery (drives displayed max, e.g. 7→ …/7). */
  weightPercentByKeyA?: Map<string, number>;
  weightPercentByKeyB?: Map<string, number>;
};

/** One row per test in either merged list or battery assignment roster (matched by canonical task id). */
export function buildBatteryTaskCompareRows(
  perA: PerTaskSourceRow[] | undefined,
  perB: PerTaskSourceRow[] | undefined,
  opts?: BatteryCompareRowOptions,
): BatteryTaskCompareRow[] {
  const mapA = new Map<string, ReportPerTaskEntry>();
  const mapB = new Map<string, ReportPerTaskEntry>();

  for (const t of perA ?? []) {
    mapA.set(canonicalTaskKey(t.task_name), toEntry(t));
  }
  for (const t of perB ?? []) {
    mapB.set(canonicalTaskKey(t.task_name), toEntry(t));
  }

  for (const name of opts?.assignedTestNamesA ?? []) {
    const k = canonicalTaskKey(name);
    if (!mapA.has(k)) mapA.set(k, toEntry({ task_name: name }));
  }
  for (const name of opts?.assignedTestNamesB ?? []) {
    const k = canonicalTaskKey(name);
    if (!mapB.has(k)) mapB.set(k, toEntry({ task_name: name }));
  }

  const labelForKey = (k: string): string => {
    const ta = mapA.get(k)?.task_name;
    const tb = mapB.get(k)?.task_name;
    return getTaskDisplayName(tb ?? ta ?? k);
  };

  const union = new Set([...mapA.keys(), ...mapB.keys()]);
  const sortedKeys = [...union].sort((a, b) => labelForKey(a).localeCompare(labelForKey(b)));

  return sortedKeys.map((k) => {
    const ea = mapA.get(k);
    const eb = mapB.get(k);
    return {
      key: k,
      displayName: labelForKey(k),
      pct1: ea != null ? taskPerformancePercent(ea) : null,
      pct2: eb != null ? taskPerformancePercent(eb) : null,
      weightPct1: opts?.weightPercentByKeyA?.get(k) ?? null,
      weightPct2: opts?.weightPercentByKeyB?.get(k) ?? null,
    };
  });
}
