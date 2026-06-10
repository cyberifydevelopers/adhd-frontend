/**
 * Mirrors backend `task_attainment.py` + norms `signal_severity_score`
 * so user-facing percentages match scoring intent (higher = better).
 */

export function normalizeTaskSlug(taskName: string | null | undefined): string {
  if (!taskName) return "";
  return String(taskName).trim().toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
}

/** Canonical key used to match the same test across batteries. */
export function canonicalTaskKey(taskName: string): string {
  const raw = normalizeTaskSlug(taskName);
  const aliases: Record<string, string> = {
    simple_reaction_time: "simple_rt",
    choice_reaction_time: "choice_rt",
    go_no_go: "sst",
    taskswitching: "task_switching",
    digitspan: "digit_span",
    timeestimation: "time_estimation",
    delaydiscounting: "delay_discounting",
  };
  return aliases[raw] ?? raw;
}

function floatMetric(m: Record<string, unknown>, key: string): number | null {
  const v = m[key];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function intMetric(m: Record<string, unknown>, key: string): number {
  const v = m[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function clampPct(x: number): number {
  return Math.round(Math.max(0, Math.min(100, x)) * 10) / 10;
}

/** Same formula as backend norms.signal_severity_score */
export function signalSeverityScore(z: number): number {
  const severity = 50 + z * 15;
  return Math.round(Math.max(0, Math.min(100, severity)) * 10) / 10;
}

/** Higher = closer to typical on this scale (inverse of clinical severity). */
export function typicalAlignmentPercentFromZ(z: number): number {
  return clampPct(100 - signalSeverityScore(z));
}

function meanZFromTaskZScores(zScores: Record<string, unknown> | undefined): number | null {
  if (!zScores) return null;
  const zs: number[] = [];
  for (const v of Object.values(zScores)) {
    if (v && typeof v === "object" && v !== null && "z_score" in v) {
      const z = Number((v as { z_score: unknown }).z_score);
      if (Number.isFinite(z)) zs.push(z);
    }
  }
  if (!zs.length) return null;
  return zs.reduce((a, b) => a + b, 0) / zs.length;
}

/**
 * 0–100 attainment from stored metrics (accuracy, omission, etc.) when possible.
 * Port of `attainment_percent_from_task_metrics`.
 */
export function taskAttainmentPercentFromMetrics(
  taskName: string,
  metrics: Record<string, unknown> | null | undefined,
): number | null {
  const t = canonicalTaskKey(taskName);
  const m = metrics ?? {};

  if (t === "task_switching") {
    const sw = floatMetric(m, "switch_accuracy");
    const rp = floatMetric(m, "repeat_accuracy");
    if (sw == null || rp == null) return null;
    const ns = intMetric(m, "n_switch");
    const nr = intMetric(m, "n_repeat");
    const tot = ns + nr;
    if (tot <= 0) return null;
    return clampPct(100 * (sw * ns + rp * nr) / tot);
  }

  if (["choice_rt", "wm_distraction", "set_shifting_mini"].includes(t)) {
    const acc = floatMetric(m, "accuracy");
    if (acc == null) return null;
    return clampPct(acc * 100);
  }

  if (t === "psychomotor_speed") {
    const acc = floatMetric(m, "accuracy");
    if (acc != null) return clampPct(acc * 100);
    const tps = floatMetric(m, "taps_per_second");
    if (tps != null) return clampPct(100 * Math.min(1, tps / 5));
    const taps = intMetric(m, "total_taps");
    if (taps > 0) return clampPct(100 * Math.min(1, taps / 50));
    return null;
  }

  if (t === "flanker") {
    const ca = floatMetric(m, "congruent_accuracy");
    const ia = floatMetric(m, "incongruent_accuracy");
    if (ca == null || ia == null) return null;
    const nc = intMetric(m, "n_congruent");
    const ni = intMetric(m, "n_incongruent");
    const tot = nc + ni;
    if (tot <= 0) return clampPct(100 * (ca + ia) / 2);
    return clampPct(100 * (ca * nc + ia * ni) / tot);
  }

  if (t === "cpt") {
    const om = floatMetric(m, "omission_rate");
    const cm = floatMetric(m, "commission_rate");
    if (om == null || cm == null) return null;
    return clampPct(100 * Math.max(0, Math.min(1, (1 - om) * (1 - cm))));
  }

  if (t === "sst") {
    const sr = floatMetric(m, "stop_success_rate");
    if (sr == null) return null;
    const goOm = floatMetric(m, "go_omission_rate");
    if (goOm == null) return clampPct(100 * sr);
    const goHit = Math.max(0, Math.min(1, 1 - goOm));
    return clampPct(100 * (goHit + sr) / 2);
  }

  if (t === "digit_span") {
    const tc = intMetric(m, "total_correct");
    const tt = intMetric(m, "total_trials");
    if (tt <= 0) return null;
    return clampPct((100 * tc) / tt);
  }

  if (t === "delay_discounting" || t === "substance_dd") {
    const rate = floatMetric(m, "immediate_choice_rate");
    if (rate == null) return null;
    return clampPct(100 * Math.max(0, Math.min(1, 1 - rate)));
  }

  if (t === "simple_rt") {
    const nv = intMetric(m, "n_valid");
    const tt = intMetric(m, "total_trials");
    if (tt <= 0) return null;
    return clampPct((100 * nv) / tt);
  }

  if (t === "time_estimation") {
    const acc =
      floatMetric(m, "accuracy_within_tolerance_rate") ??
      floatMetric(m, "accuracy_rate") ??
      floatMetric(m, "accuracy");
    if (acc != null) return clampPct(acc <= 1 ? acc * 100 : acc);
    const mae = floatMetric(m, "mean_abs_error");
    if (mae == null || mae < 0) return null;
    const capMs = 2500;
    return clampPct(100 * Math.max(0, Math.min(1, 1 - Math.min(mae, capMs) / capMs)));
  }

  return null;
}

/** Report task blob from session report `per_task` entry. */
export type ReportPerTaskEntry = {
  task_name: string;
  metrics?: Record<string, unknown>;
  z_scores?: Record<string, unknown>;
};

export function taskPerformancePercent(entry: ReportPerTaskEntry): number | null {
  const { task_name: taskName, metrics, z_scores: zScores } = entry;
  const fromMetrics = taskAttainmentPercentFromMetrics(taskName, metrics as Record<string, unknown> | undefined);
  if (fromMetrics != null) return fromMetrics;
  const mz = meanZFromTaskZScores(zScores);
  if (mz == null) return null;
  return typicalAlignmentPercentFromZ(mz);
}
