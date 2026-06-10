import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import type { MainAdaptiveCheckpointData, MainAdaptiveDecision } from "@/lib/mainAdaptiveEngine";

export function checkpointSummary(c: Record<string, unknown>): string {
  const parts: string[] = [];
  const keys = [
    "trialsCompleted",
    "validTrialsCompleted",
    "stopTrialsCompleted",
    "medianRtMs",
    "rtVariability",
    "correctTrials",
    "responseTrials",
    "recentStopSuccesses",
    "recentStopTrials",
    "indifferencePoint",
    "consistencyScore",
    "meanAbsoluteErrorMs",
    "timingVariabilityMs",
    "spanBatteryComplete",
    "wmBatteryComplete",
    "switchRtCostMs",
    "interferenceRtCostMs",
    "choiceRtPostErrorSlowingMs",
    "choiceRtThreeChoiceActive",
    "choiceRtThreeChoiceExtendedMode",
    "cptAnticipatoryRate",
    "cptLapseRate",
    "cptTimeOnTaskSlopeMsPerQuarter",
    "fatigueSlopeAnalysisActive",
    "digitSpanLadderPhase",
    "digitSpanCurrentSpan",
    "digitSpanStartingSpan",
    "digitSpanSequencesBudgetUsed",
    "digitSpanMaxSequences",
    "digitSpanEarlyResponseFlag",
    "digitSpanRepeatedInvalidInput",
    "digitSpanFloorAfterPractice",
    "digitSpanFailedStartingSpan",
    "digitSpanBatteryStopReason",
    "taskSwitchingRuleConfusionPattern",
  ];
  for (const k of keys) {
    if (c[k] !== undefined && c[k] !== null) {
      const v = c[k];
      parts.push(`${k}: ${typeof v === "number" ? (Math.round(v * 100) / 100).toString() : String(v)}`);
    }
  }
  return parts.length ? parts.join(" · ") : "(see raw)";
}

export function mainAdaptiveDecisionLabel(
  taskKey: MainAdaptiveTrialTaskKey,
  decision: MainAdaptiveDecision | undefined,
  checkpoint?: MainAdaptiveCheckpointData | null,
): string {
  if (!decision) return "—";
  if (decision === "stop_stable") {
    if (taskKey === "digit_span" && checkpoint?.digitSpanBatteryStopReason) {
      const n = checkpoint.trialsCompleted ?? checkpoint.digitSpanSequencesBudgetUsed ?? 0;
      const span = checkpoint.digitSpanCurrentSpan;
      switch (checkpoint.digitSpanBatteryStopReason) {
        case "backward_discontinue":
          return `Stopped at ${n} sequences (backward 0/2 at span ${span ?? "?"})`;
        case "backward_span_ceiling":
          return `Stopped at ${n} sequences (passed max span ${span ?? 9})`;
        case "sequence_budget":
          return `Stopped at ${n}/24 sequences (budget cap before staircase end)`;
      }
    }
    return taskKey === "digit_span" ? "Would stop (battery complete)" : "Would stop (stable)";
  }
  if (decision === "stop_max_low_confidence") return "Would stop (max, low confidence)";
  if (decision === "adjust_difficulty_up") return "Recommend ↑ difficulty";
  if (decision === "adjust_difficulty_down") return "Recommend ↓ difficulty";
  return "Continue collecting";
}
