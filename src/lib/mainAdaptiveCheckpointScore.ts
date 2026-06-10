import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import type { MainAdaptiveCheckpointData } from "@/lib/mainAdaptiveEngine";

type CheckpointScoreLine = {
  label: string;
  a: number;
  n: number;
};

/**
 * Best-effort “correct / total” from the latest main adaptive checkpoint (task-dependent).
 */
export function checkpointCorrectLines(
  taskKey: MainAdaptiveTrialTaskKey,
  c: MainAdaptiveCheckpointData | null,
): CheckpointScoreLine[] {
  if (!c) return [];

  const lines: CheckpointScoreLine[] = [];

  if (
    taskKey === "time_estimation" &&
    c.correctTrials != null &&
    c.responseTrials != null &&
    c.responseTrials > 0
  ) {
    lines.push({
      label: "Within ±1 s of target / scored reproductions",
      a: c.correctTrials,
      n: c.responseTrials,
    });
    return lines;
  }

  if (taskKey === "digit_span" && c.correctTrials != null) {
    const n = c.responseTrials ?? c.trialsCompleted ?? 0;
    if (n > 0) {
      lines.push({
        label: "Correct sequences / sequences completed",
        a: c.correctTrials,
        n,
      });
      return lines;
    }
  }

  if (c.correctTrials != null && c.responseTrials != null && c.responseTrials > 0) {
    lines.push({
      label: "Correct / trials with response",
      a: c.correctTrials,
      n: c.responseTrials,
    });
  } else if (c.correctTrials != null && c.trialsCompleted != null && c.trialsCompleted > 0) {
    lines.push({
      label: "Correct / trials completed",
      a: c.correctTrials,
      n: c.trialsCompleted,
    });
  }

  if (taskKey === "sst" && c.goSuccesses != null && c.goTrials != null && c.goTrials > 0) {
    lines.push({ label: "Go correct / go trials", a: c.goSuccesses, n: c.goTrials });
  }

  if (c.recentStopTrials != null && c.recentStopTrials > 0 && c.recentStopSuccesses != null) {
    lines.push({
      label: "Successful stops / stops in rolling window",
      a: c.recentStopSuccesses,
      n: c.recentStopTrials,
    });
  }

  if (
    taskKey === "cpt" &&
    c.targetTrialsTotal != null &&
    c.omissions != null &&
    c.targetTrialsTotal > 0
  ) {
    const hits = Math.max(0, c.targetTrialsTotal - c.omissions);
    lines.push({
      label: "Target responses (non-omission) / target trials",
      a: hits,
      n: c.targetTrialsTotal,
    });
  }

  if (
    taskKey === "cpt" &&
    c.nonTargetTrialsTotal != null &&
    c.commissions != null &&
    c.nonTargetTrialsTotal > 0
  ) {
    const correctWithhold = Math.max(0, c.nonTargetTrialsTotal - c.commissions);
    lines.push({
      label: "Correct withholds / non-target trials",
      a: correctWithhold,
      n: c.nonTargetTrialsTotal,
    });
  }

  if (
    lines.length === 0 &&
    c.lapseNonEvents != null &&
    c.lapseTrialsTotal != null &&
    c.lapseTrialsTotal > 0
  ) {
    lines.push({
      label: "Non-lapse trials / scored trials (lapse-rate window)",
      a: c.lapseNonEvents,
      n: c.lapseTrialsTotal,
    });
  }

  return lines;
}

function formatPct(a: number, n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${Math.round((100 * a) / n * 10) / 10}%`;
}

/** One-line summary for the debug panel (task-dependent metrics). */
export function formatCheckpointCorrectSummary(
  taskKey: MainAdaptiveTrialTaskKey,
  c: MainAdaptiveCheckpointData | null,
): string | null {
  const lines = checkpointCorrectLines(taskKey, c);
  if (lines.length === 0) return null;
  return lines
    .map((L) => `${L.a} / ${L.n} (${formatPct(L.a, L.n)}) — ${L.label}`)
    .join(" · ");
}
