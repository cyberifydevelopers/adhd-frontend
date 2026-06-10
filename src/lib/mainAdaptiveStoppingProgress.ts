import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS, type MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import {
  CI_WIDTH_CPT_RATE,
  CI_WIDTH_TASK_SWITCHING_SWITCH_ERROR,
  getCptStoppingGates,
  getFlankerStoppingGates,
  incongruentErrorWilsonWidth,
  getTimeEstimationStoppingGates,
  sstRecentStopSuccessBandMet,
  type AdaptiveHistory,
  type MainAdaptiveCheckpointData,
  type MainTaskAdaptivePolicy,
  wilson95Width,
} from "@/lib/mainAdaptiveEngine";
import {
  SST_MIN_STOP_TRIALS_FOR_STABLE_STOP,
  SST_RECENT_STOP_WINDOW_SIZE,
} from "@/lib/mainAdaptiveEngine";

export type StoppingRuleRow = {
  id: string;
  label: string;
  /** Current / accumulated (numerator). */
  a: number;
  /** Target / denominator for display. */
  n: number;
  /** Rule satisfied for stopping path (null = informational only). */
  met: boolean | null;
  hint?: string;
};

function nextPeriodicPastMinBoundary(pastMin: number, every: number): number {
  if (every <= 0) return 1;
  if (pastMin <= 0) return every;
  if (pastMin % every === 0) return pastMin + every;
  return Math.ceil(pastMin / every) * every;
}

/** Rows track progress toward engine stopping gates as **a / n** (current / need). */
export function stoppingRuleRows(
  taskKey: MainAdaptiveTrialTaskKey,
  checkpoint: MainAdaptiveCheckpointData | null,
  policy: MainTaskAdaptivePolicy,
  effectiveMaxTrials: number,
  recentCheckpoints: MainAdaptiveCheckpointData[] = [],
  _adaptiveHistory?: AdaptiveHistory,
): StoppingRuleRow[] {
  const lim = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey];
  const trials = checkpoint?.trialsCompleted ?? 0;
  const maxCap = Math.max(effectiveMaxTrials || policy.maxTrials, 1);

  if (taskKey === "sst") {
    const stops = checkpoint?.stopTrialsCompleted ?? 0;
    const recentT = checkpoint?.recentStopTrials ?? 0;
    const recentSucc = checkpoint?.recentStopSuccesses ?? 0;
    const ckEvery = policy.checkpointEvery;

    const minTotal = lim.minTrials;
    const minStopsGate = 30;
    const minStopsStable = SST_MIN_STOP_TRIALS_FOR_STABLE_STOP;
    const win = SST_RECENT_STOP_WINDOW_SIZE;

    const rem = stops % ckEvery;
    const segA = stops === 0 ? 0 : rem === 0 ? ckEvery : rem;

    return [
      {
        id: "sst_trials_session_max",
        label: "Total trials / session max (hard cap)",
        a: Math.min(trials, maxCap),
        n: maxCap,
        met: trials >= maxCap,
        hint: "Session ceiling; may stop with low-confidence if stability not met.",
      },
      {
        id: "sst_trials_spec_min",
        label: "Total trials / spec min",
        a: Math.min(trials, minTotal),
        n: minTotal,
        met: trials >= minTotal,
        hint: "passesMinTrialThreshold total trials.",
      },
      {
        id: "sst_stops_passes_min",
        label: "Stop trials / min for passesMin",
        a: Math.min(stops, minStopsGate),
        n: minStopsGate,
        met: stops >= minStopsGate,
        hint: "Needs ≥30 stop trials with ≥120 total trials.",
      },
      {
        id: "sst_stops_confidence",
        label: "Stop trials / min for stable-confidence rule",
        a: Math.min(stops, minStopsStable),
        n: minStopsStable,
        met: stops >= minStopsStable,
        hint: "confidenceSst requires ≥50 stop trials.",
      },
      {
        id: "sst_recent_window",
        label: "Recent stop trials / window size",
        a: Math.min(recentT, win),
        n: win,
        met: recentT === win,
        hint: "recentStopTrials must equal 25 for band + SSRT checks.",
      },
      {
        id: "sst_recent_successes",
        label: "Successful stops / stops in rolling window",
        a: recentSucc,
        n: Math.max(recentT, 1),
        met: null,
        hint: "Rate must sit in ~40–60% when window is full.",
      },
      {
        id: "sst_recent_band",
        label: "Recent stop success rate in 40–60% band",
        a: checkpoint && sstRecentStopSuccessBandMet(checkpoint) ? 1 : 0,
        n: 1,
        met: checkpoint ? sstRecentStopSuccessBandMet(checkpoint) : false,
        hint:
          recentT === win && recentT > 0
            ? `${Math.round((100 * recentSucc) / recentT)}% in last ${win} stops (need 40–60%)`
            : `Need ${win} stop trials in rolling window (have ${recentT})`,
      },
      {
        id: "sst_stop_checkpoint_cycle",
        label: "Stop trials within 25-stop checkpoint cycle",
        a: segA,
        n: ckEvery,
        met: stops > 0 && rem === 0,
        hint: "Engine evaluates when stop trials hit 25, 50, 75…",
      },
    ];
  }

  if (taskKey === "flanker" && checkpoint) {
    const minT = policy.minTrials;
    const every = policy.checkpointEvery;
    const pastMin = Math.max(0, trials - minT);
    const history: AdaptiveHistory = {
      checkpoints: recentCheckpoints,
      lowConfidenceFlag: _adaptiveHistory?.lowConfidenceFlag ?? false,
    };
    const gates = getFlankerStoppingGates("diagnostic", history, checkpoint);
    const pairLabel =
      gates.priorTrial != null && gates.currentTrial != null
        ? `trials ${gates.priorTrial} → ${gates.currentTrial}`
        : "need 2 consecutive checkpoints";

    let wilsonHint = "Wilson CI on incongruent errors / incongruent trials.";
    if (
      checkpoint.incongruentErrors != null &&
      checkpoint.incongruentTrials != null &&
      checkpoint.incongruentTrials > 0
    ) {
      const w = incongruentErrorWilsonWidth(
        checkpoint.incongruentErrors,
        checkpoint.incongruentTrials,
      );
      wilsonHint = `error-rate CI width ${w.toFixed(3)} (need ≤ 0.10 diagnostic; 0 errors → 0 width)`;
    }

    return [
      {
        id: "flanker_trials_cap",
        label: "Trials / session max",
        a: Math.min(trials, maxCap),
        n: maxCap,
        met: trials >= maxCap,
      },
      {
        id: "flanker_spec_min",
        label: "Trials / spec min",
        a: Math.min(trials, minT),
        n: minT,
        met: trials >= minT,
      },
      {
        id: "flanker_periodic",
        label: "Past-min progress / next periodic checkpoint slot",
        a: pastMin,
        n: nextPeriodicPastMinBoundary(pastMin, every),
        met: trials === minT || (pastMin >= every && pastMin % every === 0),
        hint: "Engine evaluates at trial 40, then every 20 trials (60, 80, …).",
      },
      {
        id: "flanker_cells",
        label: "≥15 congruent & ≥15 incongruent trials",
        a: gates.cellsOk ? 1 : 0,
        n: 1,
        met: gates.cellsOk,
        hint: `${checkpoint.congruentTrials ?? 0} congruent · ${checkpoint.incongruentTrials ?? 0} incongruent`,
      },
      {
        id: "flanker_at_level",
        label: "Trials at difficulty or since last checkpoint / 20",
        a: Math.min(
          Math.max(
            checkpoint.trialsAtCurrentDifficulty ?? 0,
            gates.priorTrial != null && gates.currentTrial != null
              ? gates.currentTrial - gates.priorTrial
              : 0,
          ),
          20,
        ),
        n: 20,
        met: gates.trialsAtLevelOk,
        hint: `${checkpoint.trialsAtCurrentDifficulty ?? 0} at current difficulty · ${gates.priorTrial != null && gates.currentTrial != null ? gates.currentTrial - gates.priorTrial : trials} since last checkpoint`,
      },
      {
        id: "flanker_error_ci",
        label: "Incongruent-error Wilson CI width",
        a: gates.errorCiOk ? 1 : 0,
        n: 1,
        met: gates.errorCiOk,
        hint: wilsonHint,
      },
      {
        id: "flanker_cost_stable",
        label: "Interference RT cost stable vs prior checkpoint",
        a: gates.costStable ? 1 : 0,
        n: 1,
        met: gates.costStable,
        hint: `|Δ| < 15 ms on consecutive pair (${pairLabel}).`,
      },
      {
        id: "flanker_confidence_all",
        label: "All flanker stable-stop gates (engine)",
        a: gates.confidenceMet ? 1 : 0,
        n: 1,
        met: gates.confidenceMet,
        hint: "Early stop fires at this checkpoint when this row is met.",
      },
    ];
  }

  if (taskKey === "task_switching") {
    const sw = checkpoint?.switchTrials ?? 0;
    const rep = checkpoint?.repeatTrials ?? 0;
    const swErr = checkpoint?.switchErrors ?? 0;
    const atDiff = checkpoint?.trialsAtCurrentDifficulty ?? trials;
    const minSw = 16;
    const minRep = 16;
    const needStable = 24;
    const specMin = policy.minTrials;

    let switchCostMet: boolean | null = null;
    let switchCostHint = "Needs two checkpoints with switch-cost estimates.";
    if (checkpoint && recentCheckpoints.length >= 1) {
      const prev = recentCheckpoints[recentCheckpoints.length - 1]!;
      const currCost = checkpoint.switchRtCostMs;
      const prevCost = prev.switchRtCostMs;
      if (currCost != null && prevCost != null) {
        const delta = Math.abs(currCost - prevCost);
        switchCostMet = delta < 20;
        switchCostHint = `|Δ cost| = ${Math.round(delta * 10) / 10} ms (need < 20 ms vs prior checkpoint)`;
      }
    }

    let switchErrCiMet: boolean | null = null;
    let switchErrCiHint = "Wilson CI on switch-trial errors (engine stable-stop gate).";
    if (sw > 0 && checkpoint) {
      const w = wilson95Width(swErr, sw);
      switchErrCiMet = w <= CI_WIDTH_TASK_SWITCHING_SWITCH_ERROR;
      switchErrCiHint = `CI width = ${(Math.round(w * 1000) / 1000).toFixed(3)} (need ≤ ${CI_WIDTH_TASK_SWITCHING_SWITCH_ERROR})`;
    }

    return [
      {
        id: "ts_trials_cap",
        label: "Trials / session max",
        a: Math.min(trials, maxCap),
        n: maxCap,
        met: trials >= maxCap,
      },
      {
        id: "ts_spec_min",
        label: "Trials / session minimum (CAT / spec)",
        a: Math.min(trials, specMin),
        n: specMin,
        met: trials >= specMin,
      },
      {
        id: "ts_switch_trials",
        label: "Switch trials / minimum",
        a: Math.min(sw, minSw),
        n: minSw,
        met: sw >= minSw,
        hint: "Stable stop requires ≥16 switch trials.",
      },
      {
        id: "ts_repeat_trials",
        label: "Repeat trials / minimum",
        a: Math.min(rep, minRep),
        n: minRep,
        met: rep >= minRep,
        hint: "Stable stop requires ≥16 repeat trials.",
      },
      {
        id: "ts_trials_since_difficulty",
        label: "Trials at current difficulty / minimum before stop",
        a: Math.min(atDiff, needStable),
        n: needStable,
        met: atDiff >= needStable,
        hint: "After a difficulty change, collect ≥24 trials before stable stop.",
      },
      {
        id: "ts_switch_cost_stable",
        label: "Switch cost stable vs prior checkpoint",
        a: switchCostMet === true ? 1 : 0,
        n: 1,
        met: switchCostMet,
        hint: switchCostHint,
      },
      {
        id: "ts_switch_error_ci",
        label: "Switch-error Wilson CI width",
        a: switchErrCiMet === true ? 1 : 0,
        n: 1,
        met: switchErrCiMet,
        hint: switchErrCiHint,
      },
    ];
  }

  if (taskKey === "cpt" && checkpoint) {
    const minT = policy.minTrials;
    const every = policy.checkpointEvery;
    const pastMin = Math.max(0, trials - minT);
    const history: AdaptiveHistory = {
      checkpoints: recentCheckpoints,
      lowConfidenceFlag: _adaptiveHistory?.lowConfidenceFlag ?? false,
    };
    const gates = getCptStoppingGates("diagnostic", history, checkpoint);
    const pairLabel =
      gates.priorTrial != null && gates.currentTrial != null
        ? `trials ${gates.priorTrial} → ${gates.currentTrial}`
        : "need 2 consecutive checkpoints";

    const ciCapScaled = Math.round(CI_WIDTH_CPT_RATE * 1000);
    let omissionWidthScaled: number | null = null;
    let omissionHint =
      "Wilson CI on cumulative omissions / targets — not overall % correct. ~22.5% of trials are targets, so you need very few misses (often ≤2–3) for this gate.";
    if (checkpoint.targetTrialsTotal != null && checkpoint.targetTrialsTotal > 0 && checkpoint.omissions != null) {
      const w = wilson95Width(checkpoint.omissions, checkpoint.targetTrialsTotal);
      omissionWidthScaled = Math.round(w * 1000);
      const hitPct =
        Math.round(
          ((checkpoint.targetTrialsTotal - checkpoint.omissions) / checkpoint.targetTrialsTotal) * 1000,
        ) / 10;
      omissionHint = `width ${w.toFixed(3)} (need ≤ ${CI_WIDTH_CPT_RATE}) · target hit ${hitPct}% (${checkpoint.omissions} omissions / ${checkpoint.targetTrialsTotal} targets)`;
    }

    let commissionWidthScaled: number | null = null;
    let commissionHint = "Wilson CI on cumulative commissions / non-targets at this checkpoint.";
    if (
      checkpoint.nonTargetTrialsTotal != null &&
      checkpoint.nonTargetTrialsTotal > 0 &&
      checkpoint.commissions != null
    ) {
      const w = wilson95Width(checkpoint.commissions, checkpoint.nonTargetTrialsTotal);
      commissionWidthScaled = Math.round(w * 1000);
      commissionHint = `width ${w.toFixed(3)} (need ≤ ${CI_WIDTH_CPT_RATE}) · ${checkpoint.commissions} commissions / ${checkpoint.nonTargetTrialsTotal} non-targets`;
    }

    const rows: StoppingRuleRow[] = [
      {
        id: "cpt_trials_cap",
        label: "Trials / session max",
        a: Math.min(trials, maxCap),
        n: maxCap,
        met: trials >= maxCap,
      },
      {
        id: "cpt_spec_min",
        label: "Trials / spec min",
        a: Math.min(trials, minT),
        n: minT,
        met: trials >= minT,
      },
      {
        id: "cpt_periodic",
        label: "Past-min progress / next periodic checkpoint slot",
        a: pastMin,
        n: nextPeriodicPastMinBoundary(pastMin, every),
        met: trials === minT || (pastMin >= every && pastMin % every === 0),
        hint: "Snapshots every 60 trials; stop eval from 180; Wilson CI often needs ~240 targets at 22.5% rate.",
      },
      {
        id: "cpt_omission_ci",
        label: "Omission Wilson CI width (×1000) / cap",
        a: omissionWidthScaled ?? (gates.omissionOk ? ciCapScaled : ciCapScaled + 1),
        n: ciCapScaled,
        met: gates.omissionOk,
        hint: omissionHint,
      },
      {
        id: "cpt_commission_ci",
        label: "Commission Wilson CI width (×1000) / cap",
        a: commissionWidthScaled ?? (gates.commissionOk ? ciCapScaled : ciCapScaled + 1),
        n: ciCapScaled,
        met: gates.commissionOk,
        hint: commissionHint,
      },
      {
        id: "cpt_rt_var_stable",
        label: "RT variability (MAD) stable vs prior checkpoint",
        a: gates.rtVarStable ? 1 : 0,
        n: 1,
        met: gates.rtVarStable,
        hint: `Spec: Δ <10% on consecutive pair (${pairLabel}).`,
      },
      {
        id: "cpt_lapse_level",
        label: "Lapse rate at checkpoint (omissions + slow RTs)",
        a:
          checkpoint.cptLapseRate != null
            ? Math.round(checkpoint.cptLapseRate * 1000)
            : 0,
        n: 1000,
        met: checkpoint.cptLapseRate != null ? checkpoint.cptLapseRate < 0.08 : null,
        hint:
          "Lapse ≠ accuracy: includes target RT > 2× median. High withhold % does not lower this.",
      },
      {
        id: "cpt_lapse_stable",
        label: "Lapse rate stable across two checkpoints",
        a: gates.lapseStable ? 1 : 0,
        n: 1,
        met: gates.lapseStable,
        hint: `Consecutive pair (${pairLabel}); continue while unstable.`,
      },
      {
        id: "cpt_slope_stable",
        label: "Time-on-task slope stable across two checkpoints",
        a: gates.slopeStable ? 1 : 0,
        n: 1,
        met: gates.slopeStable,
        hint: `|Δ| ≤ 20 ms/quarter or <25% relative (${pairLabel}).`,
      },
      {
        id: "cpt_confidence_all",
        label: "All CPT stable-stop gates (engine)",
        a: gates.confidenceMet ? 1 : 0,
        n: 1,
        met: gates.confidenceMet,
        hint: "Early stop fires at this checkpoint when this row is met.",
      },
    ];

    if (checkpoint.fatigueSlopeAnalysisActive === true) {
      const mins = checkpoint.scoredDurationMinutes ?? 0;
      rows.push({
        id: "cpt_fatigue_min",
        label: "Scored duration / 4 min (extended fatigue mode)",
        a: Math.min(Math.floor(mins), 4),
        n: 4,
        met: mins >= 4,
        hint: "Only when fatigue slope analysis is active.",
      });
    }

    return rows;
  }

  if (taskKey === "time_estimation" && checkpoint) {
    const minT = policy.minTrials;
    const every = policy.checkpointEvery;
    const scored = checkpoint.trialsCompleted ?? 0;
    const pastMin = Math.max(0, scored - minT);
    const history: AdaptiveHistory = {
      checkpoints: recentCheckpoints,
      lowConfidenceFlag: _adaptiveHistory?.lowConfidenceFlag ?? false,
    };
    const gates = getTimeEstimationStoppingGates("diagnostic", history, checkpoint);
    const pairLabel =
      gates.priorTrial != null && gates.currentTrial != null
        ? `reproductions ${gates.priorTrial} → ${gates.currentTrial}`
        : "need 2 consecutive checkpoints";

    const errHint =
      gates.errShiftPct != null
        ? `|Δ| ${(gates.errShiftPct * 100).toFixed(1)}% (need <10%) · ${pairLabel}`
        : pairLabel;
    const varHint =
      gates.varShiftPct != null
        ? `|Δ| ${(gates.varShiftPct * 100).toFixed(1)}% (need <10%) · ${pairLabel}`
        : pairLabel;

    return [
      {
        id: "te_scored_cap",
        label: "Scored reproductions / session max",
        a: Math.min(scored, maxCap),
        n: maxCap,
        met: scored >= maxCap,
        hint: "Session ceiling; ends with low confidence if timing stability not met.",
      },
      {
        id: "te_spec_min",
        label: "Scored reproductions / spec min",
        a: Math.min(scored, minT),
        n: minT,
        met: scored >= minT,
      },
      {
        id: "te_periodic",
        label: "Past-min progress / next periodic checkpoint slot",
        a: pastMin,
        n: nextPeriodicPastMinBoundary(pastMin, every),
        met: scored === minT || (pastMin >= every && pastMin % every === 0),
        hint: "Engine evaluates at 18, 24, 30, … (min 12 + every 6).",
      },
      {
        id: "te_min_per_cell",
        label: "Min reproductions per duration (or duration×condition)",
        a: Math.min(checkpoint.timeEstimationMinTrialsPerCell ?? 0, 3),
        n: 3,
        met: gates.minPerCellOk,
        hint: checkpoint.timeEstimationDistractorUsed
          ? "Distractor design: ≥3 per duration in each condition."
          : "Clean block: ≥3 per target duration (5 / 10 / 15 s).",
      },
      {
        id: "te_err_stable",
        label: "Mean absolute error stable vs prior checkpoint",
        a: gates.errStable ? 1 : 0,
        n: 1,
        met: gates.errStable,
        hint: errHint,
      },
      {
        id: "te_var_stable",
        label: "Timing variability (MAD) stable vs prior checkpoint",
        a: gates.varStable ? 1 : 0,
        n: 1,
        met: gates.varStable,
        hint: varHint,
      },
      {
        id: "te_confidence_all",
        label: "All time-estimation stable-stop gates (engine)",
        a: gates.confidenceMet ? 1 : 0,
        n: 1,
        met: gates.confidenceMet,
        hint: "Early stop fires at this checkpoint when this row is met.",
      },
    ];
  }

  if (taskKey === "digit_span") {
    const seqDone = checkpoint?.trialsCompleted ?? 0;
    const budgetUsed = checkpoint?.digitSpanSequencesBudgetUsed ?? seqDone;
    const maxSeq =
      checkpoint?.digitSpanMaxSequences != null
        ? Math.min(checkpoint.digitSpanMaxSequences, maxCap)
        : Math.min(lim.maxTrials, maxCap);
    const battery = checkpoint?.spanBatteryComplete === true;
    const minT = policy.minTrials;

    return [
      {
        id: "ds_sequences_cap",
        label: "Sequences completed / session max",
        a: Math.min(seqDone, maxCap),
        n: maxCap,
        met: seqDone >= maxCap,
        hint: "Hard cap on sequence presentations.",
      },
      {
        id: "ds_spec_min",
        label: "Sequences / spec minimum",
        a: Math.min(seqDone, minT),
        n: minT,
        met: seqDone >= minT,
      },
      {
        id: "ds_budget",
        label: "Sequences used (budget) / max sequences",
        a: Math.min(budgetUsed, maxSeq),
        n: maxSeq,
        met: budgetUsed >= maxSeq,
        hint: "Same counter as sequencesUsedMain vs task maximum.",
      },
      {
        id: "ds_battery",
        label: "Staircase finished (stop_stable)",
        a: battery ? 1 : 0,
        n: 1,
        met: battery,
        hint: "Engine treats digit_span stable stop as battery complete (not CPT-style CI).",
      },
      {
        id: "ds_stop_reason",
        label: "Battery stop reason (when complete)",
        a: battery ? 1 : 0,
        n: 1,
        met: battery,
        hint: checkpoint?.digitSpanBatteryStopReason
          ? {
              backward_discontinue: "Backward 0/2 at a span after passing lower spans.",
              backward_span_ceiling: "Backward span passed maximum (9 digits).",
              sequence_budget: "24-sequence budget exhausted (may occur with strong performance).",
            }[checkpoint.digitSpanBatteryStopReason]
          : "Battery not complete yet.",
      },
    ];
  }

  const useValid = taskKey === "simple_rt" || taskKey === "choice_rt" || taskKey === "psychomotor_speed";
  const counter = useValid
    ? (checkpoint?.validTrialsCompleted ?? checkpoint?.trialsCompleted ?? 0)
    : trials;
  const minT = policy.minTrials;
  const every = policy.checkpointEvery;

  const rows: StoppingRuleRow[] = [
    {
      id: "gen_trials_cap",
      label: "Trials / session max",
      a: Math.min(trials, maxCap),
      n: maxCap,
      met: trials >= maxCap,
    },
    {
      id: "gen_trials_min",
      label: `${useValid ? "Valid trials" : "Trials"} / spec min`,
      a: Math.min(counter, minT),
      n: minT,
      met: counter >= minT,
    },
  ];

  if (every > 0) {
    const pastMin = counter - minT;
    const nextB = useValid
      ? counter < minT
        ? minT
        : counter === minT
          ? minT + every
          : nextPeriodicPastMinBoundary(pastMin, every)
      : nextPeriodicPastMinBoundary(pastMin, every);
    const onPeriodic = useValid
      ? counter >= minT &&
        (counter === minT || (pastMin >= every && pastMin % every === 0))
      : pastMin >= every && pastMin % every === 0;
    rows.push({
      id: "gen_periodic_next",
      label: "Past-min progress / next periodic checkpoint slot",
      a: useValid ? Math.min(counter, nextB) : Math.max(0, pastMin),
      n: Math.max(nextB, 1),
      met: onPeriodic,
      hint: useValid
        ? `Checkpoints at min (${minT}) valid trials, then every ${every} (e.g. ${minT + every}, ${minT + 2 * every}). Stable stop needs two consecutive checkpoints.`
        : pastMin < every
          ? `First checkpoint lands when trials reach min + ${every} (counter past min = ${every}).`
          : "Checkpoint when (trials − min) is a positive multiple of checkpointEvery.",
    });
  }

  return rows;
}
