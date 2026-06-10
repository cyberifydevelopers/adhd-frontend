import {
  CI_WIDTH_CPT_RATE,
  ciTargetForMode,
  getCptStoppingGates,
  getTimeEstimationStoppingGates,
  type AdaptiveHistory,
  type AdaptiveMode,
  type MainAdaptiveCheckpointData,
  wilson95Width,
} from "@/lib/mainAdaptiveEngine";

/** One row of the flanker confidence breakdown (mirrors `confidenceFlanker` in mainAdaptiveEngine). */
export type FlankerConfidenceGateRow = {
  id: string;
  label: string;
  met: boolean;
  detail: string;
};

/**
 * Structured gates matching {@link confidenceFlanker}: cells, trials-at-level, incongruent-error CI, cost stability.
 * `trail` should be the rolling checkpoint list (≥2 entries to evaluate cost stability).
 */
export function flankerConfidenceGates(
  mode: AdaptiveMode,
  trail: MainAdaptiveCheckpointData[],
): FlankerConfidenceGateRow[] {
  const c = trail[trail.length - 1];
  if (!c) {
    return [
      {
        id: "data",
        label: "Checkpoint data",
        met: false,
        detail: "No checkpoint recorded yet",
      },
    ];
  }

  const target = ciTargetForMode(mode);
  const gates: FlankerConfidenceGateRow[] = [];

  const nCong = c.congruentTrials ?? 0;
  const nIncong = c.incongruentTrials ?? 0;
  const cellsOk = nCong >= 15 && nIncong >= 15;
  gates.push({
    id: "cells",
    label: "≥15 congruent & ≥15 incongruent trials",
    met: cellsOk,
    detail: `${nCong} congruent · ${nIncong} incongruent`,
  });

  const trialsAtLevel = c.trialsAtCurrentDifficulty ?? c.trialsCompleted;
  gates.push({
    id: "at-level",
    label: "≥20 trials at current difficulty",
    met: trialsAtLevel >= 20,
    detail: `${trialsAtLevel} trials`,
  });

  if (
    c.incongruentErrors != null &&
    c.incongruentTrials != null &&
    c.incongruentTrials > 0
  ) {
    const w = wilson95Width(c.incongruentErrors, c.incongruentTrials);
    const ok = w <= target;
    gates.push({
      id: "wilson",
      label: `Incongruent-error Wilson CI width ≤ ${target.toFixed(2)}`,
      met: ok,
      detail: `width ${w.toFixed(3)} (${ok ? "met" : "not met"})`,
    });
  } else {
    gates.push({
      id: "wilson",
      label: "Incongruent-error Wilson CI width",
      met: false,
      detail: "Missing incongruent errors / incongruent trials",
    });
  }

  if (trail.length >= 2) {
    const prev = trail[trail.length - 2]!;
    const pc = prev.interferenceRtCostMs;
    const cc = c.interferenceRtCostMs;
    if (pc != null && cc != null) {
      const delta = Math.abs(cc - pc);
      const ok = delta < 15;
      gates.push({
        id: "cost",
        label: "Interference RT cost stable (|Δ| < 15 ms vs prior checkpoint)",
        met: ok,
        detail: `${pc.toFixed(1)} → ${cc.toFixed(1)} ms (|Δ|=${delta.toFixed(1)} ms)`,
      });
    } else {
      gates.push({
        id: "cost",
        label: "Interference RT cost stability",
        met: false,
        detail: "Median-based cost null on prior or current checkpoint",
      });
    }
  } else {
    gates.push({
      id: "cost",
      label: "Interference RT cost stability",
      met: false,
      detail: `Need ≥2 checkpoints in trail (have ${trail.length})`,
    });
  }

  return gates;
}

export function firstFailingFlankerGate(rows: FlankerConfidenceGateRow[]): string | null {
  const f = rows.find((r) => !r.met);
  return f ? `${f.label}: ${f.detail}` : null;
}

/** Mirrors {@link getCptStoppingGates} in mainAdaptiveEngine. */
export function cptConfidenceGates(
  rolling: MainAdaptiveCheckpointData[],
  current?: MainAdaptiveCheckpointData,
): FlankerConfidenceGateRow[] {
  const c = current ?? rolling[rolling.length - 1];
  if (!c) {
    return [
      {
        id: "data",
        label: "Checkpoint data",
        met: false,
        detail: "No checkpoint recorded yet",
      },
    ];
  }

  const history: AdaptiveHistory = { checkpoints: rolling, lowConfidenceFlag: false };
  const engine = getCptStoppingGates("diagnostic", history, c);
  const pairLabel =
    engine.priorTrial != null && engine.currentTrial != null
      ? `trials ${engine.priorTrial} → ${engine.currentTrial}`
      : "need prior checkpoint";

  const gates: FlankerConfidenceGateRow[] = [];

  if (c.targetTrialsTotal != null && c.targetTrialsTotal > 0 && c.omissions != null) {
    const w = wilson95Width(c.omissions, c.targetTrialsTotal);
    gates.push({
      id: "omission-ci",
      label: `Omission Wilson CI width ≤ ${CI_WIDTH_CPT_RATE}`,
      met: engine.omissionOk,
      detail: `width ${w.toFixed(3)} (${c.omissions}/${c.targetTrialsTotal} omissions)`,
    });
  } else {
    gates.push({
      id: "omission-ci",
      label: "Omission Wilson CI width",
      met: false,
      detail: "Missing target trials / omissions",
    });
  }

  if (
    c.nonTargetTrialsTotal != null &&
    c.nonTargetTrialsTotal > 0 &&
    c.commissions != null
  ) {
    const w = wilson95Width(c.commissions, c.nonTargetTrialsTotal);
    gates.push({
      id: "commission-ci",
      label: `Commission Wilson CI width ≤ ${CI_WIDTH_CPT_RATE}`,
      met: engine.commissionOk,
      detail: `width ${w.toFixed(3)} (${c.commissions}/${c.nonTargetTrialsTotal} commissions)`,
    });
  } else {
    gates.push({
      id: "commission-ci",
      label: "Commission Wilson CI width",
      met: false,
      detail: "Missing non-target trials / commissions",
    });
  }

  gates.push({
    id: "rt-var",
    label: "RT variability (MAD) stable (Δ <10% vs prior checkpoint)",
    met: engine.rtVarStable,
    detail: pairLabel,
  });

  gates.push({
    id: "lapse",
    label: "Lapse rate stable across two checkpoints",
    met: engine.lapseStable,
    detail:
      c.cptLapseRate != null
        ? `lapse ${(c.cptLapseRate * 100).toFixed(1)}% · ${pairLabel}`
        : "lapse rate unavailable",
  });

  gates.push({
    id: "slope",
    label: "Time-on-task slope stable across two checkpoints",
    met: engine.slopeStable,
    detail:
      c.cptTimeOnTaskSlopeMsPerQuarter != null
        ? `slope ${c.cptTimeOnTaskSlopeMsPerQuarter.toFixed(1)} ms/qtr · ${pairLabel}`
        : "slope unavailable",
  });

  if (c.fatigueSlopeAnalysisActive === true) {
    const mins = c.scoredDurationMinutes ?? 0;
    gates.push({
      id: "fatigue-min",
      label: "≥4 minutes scored before stop (extended fatigue mode)",
      met: mins >= 4,
      detail: `${mins.toFixed(1)} min scored`,
    });
  }

  return gates;
}

export function firstFailingCptGate(rows: FlankerConfidenceGateRow[]): string | null {
  return firstFailingFlankerGate(rows);
}

/** Mirrors {@link getTimeEstimationStoppingGates} — timing stability, not Wilson CI. */
export function timeEstimationConfidenceGates(
  rolling: MainAdaptiveCheckpointData[],
  current?: MainAdaptiveCheckpointData,
): FlankerConfidenceGateRow[] {
  const c = current ?? rolling[rolling.length - 1];
  if (!c) {
    return [
      {
        id: "data",
        label: "Checkpoint data",
        met: false,
        detail: "No checkpoint recorded yet",
      },
    ];
  }

  const history: AdaptiveHistory = { checkpoints: rolling, lowConfidenceFlag: false };
  const engine = getTimeEstimationStoppingGates("diagnostic", history, c);
  const pairLabel =
    engine.priorTrial != null && engine.currentTrial != null
      ? `reproductions ${engine.priorTrial} → ${engine.currentTrial}`
      : "need prior checkpoint";

  const gates: FlankerConfidenceGateRow[] = [];

  gates.push({
    id: "min-cell",
    label: "≥3 reproductions per duration (or per duration×condition)",
    met: engine.minPerCellOk,
    detail: `min cell count ${c.timeEstimationMinTrialsPerCell ?? 0}`,
  });

  if (c.meanAbsoluteErrorMs != null) {
    const errPct =
      engine.errShiftPct != null ? `${(engine.errShiftPct * 100).toFixed(1)}%` : "—";
    gates.push({
      id: "err-stable",
      label: "Mean absolute error stable (Δ <10% vs prior checkpoint)",
      met: engine.errStable,
      detail:
        engine.errShiftPct != null
          ? `mean ${c.meanAbsoluteErrorMs.toFixed(0)} ms · |Δ| ${errPct} · ${pairLabel}`
          : `mean ${c.meanAbsoluteErrorMs.toFixed(0)} ms · ${pairLabel}`,
    });
  } else {
    gates.push({
      id: "err-stable",
      label: "Mean absolute error stability",
      met: false,
      detail: "Mean absolute error unavailable",
    });
  }

  if (c.timingVariabilityMs != null) {
    const varPct =
      engine.varShiftPct != null ? `${(engine.varShiftPct * 100).toFixed(1)}%` : "—";
    gates.push({
      id: "var-stable",
      label: "Timing variability (MAD) stable (Δ <10% vs prior checkpoint)",
      met: engine.varStable,
      detail:
        engine.varShiftPct != null
          ? `MAD ${c.timingVariabilityMs.toFixed(0)} ms · |Δ| ${varPct} · ${pairLabel}`
          : `MAD ${c.timingVariabilityMs.toFixed(0)} ms · ${pairLabel}`,
    });
  } else {
    gates.push({
      id: "var-stable",
      label: "Timing variability stability",
      met: false,
      detail: "Variability (MAD) unavailable",
    });
  }

  gates.push({
    id: "all",
    label: "All stable-stop gates (engine)",
    met: engine.confidenceMet,
    detail: engine.confidenceMet
      ? "Would allow early stop at this checkpoint"
      : "Early stop not allowed yet",
  });

  return gates;
}

export function firstFailingTimeEstimationGate(rows: FlankerConfidenceGateRow[]): string | null {
  return firstFailingFlankerGate(rows);
}
