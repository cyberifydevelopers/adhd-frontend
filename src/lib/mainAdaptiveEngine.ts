import {
  MAIN_TASK_ADAPTIVE_TRIAL_LIMITS,
  type MainAdaptiveTrialTaskKey,
} from "@/config/catConfig";

/**
 * Main-test adaptive engine (practice is out of scope).
 * Each task has a dedicated evaluator aligned with the platform adaptive spec.
 *
 * Persisted task summaries (main blocks) should expose at minimum: task_name, task_version,
 * difficulty_level_start/end, trials_completed, minimum_trials_met, maximum_trials_reached,
 * adaptive_stopping_reason, primary_metric_value and CI bounds, confidence_met,
 * low_confidence_flag, validity_flags, practice_passed, practice_trials_completed.
 *
 * Callers must populate `MainAdaptiveCheckpointData` with the metrics that task
 * can compute at each checkpoint; missing optional fields → stopping criteria not met.
 *
 * SST: pass `recentStopSuccesses` / `recentStopTrials` for the **last 25 stop trials only**
 * (`recentStopTrials` must equal {@link SST_RECENT_STOP_WINDOW_SIZE}). Cumulative stop
 * counts are only used for cadence (`stopTrialsCompleted % 25 === 0`).
 */

export type AdaptiveMode = "screening" | "diagnostic";

export type DifficultyAdjustment = "increase" | "decrease" | "hold";

export type MainAdaptiveDecision =
  | "continue"
  | "stop_stable"
  | "stop_max_low_confidence"
  | "adjust_difficulty_up"
  | "adjust_difficulty_down";

export type AdaptiveHistory = {
  checkpoints: MainAdaptiveCheckpointData[];
  lowConfidenceFlag: boolean;
};

/** Binomial rate CI width targets from spec */
export const CI_WIDTH_SCREENING = 0.15;
export const CI_WIDTH_DIAGNOSTIC = 0.1;
/** CPT omission & commission */
export const CI_WIDTH_CPT_RATE = 0.08;
/** Task switching: switch-error rate Wilson CI width for stable stop */
export const CI_WIDTH_TASK_SWITCHING_SWITCH_ERROR = 0.1;
/** SRT lapse-rate stopping branch */
export const CI_WIDTH_LAPSE_STOP = 0.1;

/** SST: spec “most recent 25 stop trials” for success-rate band */
export const SST_RECENT_STOP_WINDOW_SIZE = 25;
/** SST: max design requires ≥50 stop trials — stable stop must satisfy this */
export const SST_MIN_STOP_TRIALS_FOR_STABLE_STOP = 50;

/** Recent-window stop success in 40–60% band (spec stopping rule). */
export function sstRecentStopSuccessBandMet(c: MainAdaptiveCheckpointData): boolean {
  if (c.recentStopTrials !== SST_RECENT_STOP_WINDOW_SIZE) return false;
  if (c.recentStopSuccesses == null || c.recentStopTrials <= 0) return false;
  const rate = c.recentStopSuccesses / c.recentStopTrials;
  return rate >= 0.4 && rate <= 0.6;
}

export type MainAdaptiveCheckpointData = {
  trialsCompleted: number;
  /** Prefer for cadence when task tracks valid trials only */
  validTrialsCompleted?: number;

  /** SST: checkpoint every 25 stop trials (not total trials) */
  stopTrialsCompleted?: number;

  /** After a difficulty change; flanker / task_switching need ≥20 / ≥24 trials at new level before stop */
  trialsAtCurrentDifficulty?: number;

  /* --- Simple RT / psychomotor --- */
  medianRtMs?: number | null;
  /** MAD or IQR — precomputed by task */
  rtVariability?: number | null;
  /** For lapse-rate Wilson CI: successes = trials − lapses */
  lapseNonEvents?: number;
  lapseTrialsTotal?: number;
  /** Simple RT / psychomotor: raw lapse count (e.g. omissions) for Wilson CI on lapse rate */
  lapseCount?: number;

  /** Simple RT validity — responded trials with RT <120 ms */
  simpleRtAnticipatoryRate?: number;
  /** Simple RT validity — omissions / all scored trials */
  simpleRtOmissionRate?: number;
  deviceTimingJitterFlag?: boolean;
  /** Psychomotor speed: user noted motor limitation (QC / validity). */
  psychomotorMotorImpairmentNoted?: boolean;

  /* --- Choice RT / flanker accuracy --- */
  correctTrials?: number;
  responseTrials?: number;

  /* --- Flanker --- */
  congruentTrials?: number;
  incongruentTrials?: number;
  incongruentErrors?: number;
  interferenceRtCostMs?: number | null;

  /* --- SST --- */
  /** Window for stop-success band (spec: most recent 25 stop trials) */
  recentStopSuccesses?: number;
  recentStopTrials?: number;
  ssrtMs?: number | null;
  goSuccesses?: number;
  goTrials?: number;
  /** Initial median go RT vs current — waiting-strategy validity */
  baselineMedianGoRtMs?: number | null;
  /** All stop trials — successes / n(stop); QC / validity flags */
  overallStopSuccessRate?: number;
  /** SSD staircase stuck at min/max — spec trigger-failure pattern */
  sstSsdStuck?: boolean;

  /** Choice RT — anticipatory rate among responded trials (RT &lt; 120 ms) */
  choiceRtAnticipatoryRate?: number;
  /** Choice RT — max share of trials using one response key (side bias) */
  choiceRtDominantResponseShare?: number;
  /** Flanker — max share of trials using one response key (response bias) */
  flankerDominantResponseShare?: number;

  /** Session/product flag: extended (3-choice) CRT is allowed when criteria met */
  choiceRtThreeChoiceExtendedMode?: boolean;
  /** Task is currently presenting 3 alternatives (after adjust_difficulty_up applied in UI) */
  choiceRtThreeChoiceActive?: boolean;
  /** Median RT after incorrect − median RT after correct (prior trial); anticipatory RTs excluded */
  choiceRtPostErrorSlowingMs?: number | null;

  /* --- CPT --- */
  omissions?: number;
  targetTrialsTotal?: number;
  commissions?: number;
  nonTargetTrialsTotal?: number;
  /** For fatigue / slope gate when CPT uses time-on-task stopping */
  scoredDurationMinutes?: number;
  fatigueSlopeAnalysisActive?: boolean;
  /** CPT: target responses with RT &lt; 120 ms / responded targets */
  cptAnticipatoryRate?: number;
  /** CPT cumulative lapse rate (matches backend `compute_metrics`) */
  cptLapseRate?: number | null;
  /** CPT vigilance / fatigue slope from quarter RT means */
  cptTimeOnTaskSlopeMsPerQuarter?: number | null;

  /* --- Digit span / WM distraction --- */
  /** Caller fires checkpoint when span or load level completes */
  spanOrLoadCheckpoint?: boolean;
  hitCeiling?: boolean;
  hitFloor?: boolean;
  /** Forward + backward ladder done (digit span) */
  spanBatteryComplete?: boolean;
  /** Digit span adaptive staircase */
  digitSpanLadderPhase?: "forward" | "backward";
  digitSpanCurrentSpan?: number;
  digitSpanStartingSpan?: number;
  digitSpanSequencesBudgetUsed?: number;
  digitSpanMaxSequences?: number;
  digitSpanEarlyResponseFlag?: boolean;
  digitSpanRepeatedInvalidInput?: boolean;
  digitSpanFloorAfterPractice?: boolean;
  digitSpanFailedStartingSpan?: boolean;
  /** Why main battery ended when spanBatteryComplete is true. */
  digitSpanBatteryStopReason?: "backward_discontinue" | "backward_span_ceiling" | "sequence_budget";
  /** Highest clean load + distracted load identified (WM) */
  wmBatteryComplete?: boolean;
  /** WM spec 13: max span reached (separate ladders). */
  wmMaxCleanLoad?: number | null;
  wmMaxDistractedLoad?: number | null;
  /** Clean minus distracted accuracy (0–1 each), when computable. */
  wmDistractorCost?: number | null;
  wmTrialsClean?: number;
  wmTrialsDistracted?: number;
  /** ≥2 main trials in each condition (spec floor before adaptive stop). */
  wmMinTrialsPerConditionMet?: boolean;
  wmEarlyInputFlag?: boolean;
  wmDistractorUnderstandingFlag?: boolean;
  wmFloorAfterPracticeFlag?: boolean;
  wmInconsistentAtMax?: boolean;

  /* --- Task switching --- */
  switchTrials?: number;
  repeatTrials?: number;
  switchRtCostMs?: number | null;
  switchErrors?: number;
  /** Heuristic: disproportionate switch vs repeat errors (rule confusion) */
  taskSwitchingRuleConfusionPattern?: boolean;

  /* --- Time estimation --- */
  meanAbsoluteErrorMs?: number | null;
  timingVariabilityMs?: number | null;
  /** True when main design includes a distractor half (min cells = duration×condition). */
  timeEstimationDistractorUsed?: boolean;
  /** Min reproduction count across duration cells (clean) or duration×condition (distractor design). */
  timeEstimationMinTrialsPerCell?: number;
  timeEstimationSignedBiasMs?: number | null;
  timeEstimationCvAbsoluteError?: number | null;
  timeEstimationImmediateReproductionFlag?: boolean;
  timeEstimationMisunderstandingFlag?: boolean;
  /** Schedule builder repaired accidental same-duration adjacency. */
  timeEstimationAdjacentSwapInPlan?: boolean;

  /* --- Delay discounting / substance DD --- */
  indifferencePoint?: number | null;
  consistencyScore?: number | null;
  /** Min trials across immediate vs delayed choice counts (both branches). */
  delayDiscountingMinCellTrials?: number;
  delayDiscountingImmediateChoiceRate?: number | null;
  /** Share of trials with RT below fast threshold (anticipatory / random clicking). */
  delayDiscountingFastChoiceRate?: number | null;
  /** max(P(left), P(right)) on response keys — side bias. */
  delayDiscountingDominantSideShare?: number | null;
  delayDiscountingNowVsLaterMisunderstandingFlag?: boolean;
  /** Substance DD: user indicated discomfort (events or checkpoint aggregate). */
  substanceDdDistressReported?: boolean;

  /* --- Set shifting mini --- */
  /** Completed learning blocks after a rule change (each = 5 correct in a row on the new rule); stop at 2. */
  ruleShiftsWithCriterion?: number;
  perseverationEstablished?: boolean;
  /** Checkpoint at end of a rule block (spec: after each rule block or every 10 trials) */
  setShiftingRuleBlockEnded?: boolean;
  /** Accuracy on trials where the sorting rule changed vs the prior trial. */
  setShiftingSwitchAccuracy?: number | null;
  /** Trials to reach 5-in-a-row for each completed rule phase (main only). */
  setShiftingTrialsToCriterionByPhase?: number[];
  setShiftingFirstCriterionCompleted?: boolean;
  setShiftingRandomRespondingFlag?: boolean;
  setShiftingMaxTrialsWithoutCriterion?: boolean;
  /** Count of perseverative errors on switch trials (wrong response matching previous rule). */
  setShiftingPerseverationSwitchErrors?: number;
};

export type MainTaskAdaptivePolicy = {
  taskName: string;
  minTrials: number;
  maxTrials: number;
  /** Primary cadence unit (total trials, valid trials, or stop trials — see task) */
  checkpointEvery: number;
};

export type MainAdaptiveSessionBounds = {
  /** CAT `min_trials` from session task config (falls back to spec preset) */
  sessionMinTrials?: number;
  /** CAT `max_trials` from session task config (falls back to spec preset) */
  sessionMaxTrials?: number;
};

export type MainAdaptiveEvaluationInput = {
  taskKey: MainAdaptiveTrialTaskKey;
  mode: AdaptiveMode;
  history: AdaptiveHistory;
  checkpoint: MainAdaptiveCheckpointData;
} & MainAdaptiveSessionBounds;

/** Merge CAT session bounds with spec presets (used by engine + debug panel). */
export function resolveSessionAdaptivePolicy(
  taskKey: MainAdaptiveTrialTaskKey,
  bounds?: MainAdaptiveSessionBounds,
): MainTaskAdaptivePolicy {
  const base = MAIN_TASK_POLICY_PRESETS[taskKey];
  const lim = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey];
  const minTrials = Math.max(1, bounds?.sessionMinTrials ?? lim.minTrials);
  const maxTrials = Math.max(minTrials, bounds?.sessionMaxTrials ?? lim.maxTrials);
  return { ...base, minTrials, maxTrials };
}

export type MainAdaptiveEvaluationOutput = {
  decision: MainAdaptiveDecision;
  confidenceMet: boolean;
  lowConfidenceFlag: boolean;
  /** Machine-readable checks (spec validity_flags); caller may merge with task-level QC */
  validityFlags: string[];
  adaptiveStoppingReason: string;
  recommendedDifficulty: DifficultyAdjustment;
  history: AdaptiveHistory;
};

export function createAdaptiveHistory(): AdaptiveHistory {
  return { checkpoints: [], lowConfidenceFlag: false };
}

export function ciTargetForMode(mode: AdaptiveMode): number {
  return mode === "screening" ? CI_WIDTH_SCREENING : CI_WIDTH_DIAGNOSTIC;
}

/**
 * Wilson ~95% CI width for a binomial proportion.
 */
export function wilson95Width(successes: number, n: number): number {
  if (!Number.isFinite(successes) || !Number.isFinite(n) || n <= 0) return 1;
  const z = 1.96;
  const p = Math.max(0, Math.min(1, successes / n));
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const lo = Math.max(0, center - margin);
  const hi = Math.min(1, center + margin);
  return hi - lo;
}

/** Wilson CI width for incongruent *error rate*; 0 errors on ≥1 trial is treated as width 0 (confident low error rate). */
export function incongruentErrorWilsonWidth(errors: number, incongruentTrials: number): number {
  if (!Number.isFinite(errors) || !Number.isFinite(incongruentTrials) || incongruentTrials <= 0) {
    return 1;
  }
  if (errors <= 0) return 0;
  return wilson95Width(errors, incongruentTrials);
}

function stableRtMedianAndVariabilityAcrossTwo(
  checkpoints: MainAdaptiveCheckpointData[],
): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1];
  const prev = checkpoints[checkpoints.length - 2];
  if (
    curr.medianRtMs == null ||
    prev.medianRtMs == null ||
    curr.rtVariability == null ||
    prev.rtVariability == null ||
    prev.medianRtMs <= 0 ||
    prev.rtVariability <= 0
  ) {
    return false;
  }
  const medianShift = Math.abs(curr.medianRtMs - prev.medianRtMs) / prev.medianRtMs;
  const variabilityShift =
    Math.abs(curr.rtVariability - prev.rtVariability) / prev.rtVariability;
  return medianShift < 0.05 && variabilityShift < 0.1;
}

/** CPT spec: RT variability (MAD) stable across two consecutive checkpoints (Δ <10%). */
export function stableRtVariabilityAcrossTwo(
  checkpoints: MainAdaptiveCheckpointData[],
): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1];
  const prev = checkpoints[checkpoints.length - 2];
  if (curr.rtVariability == null || prev.rtVariability == null) {
    return false;
  }
  if (prev.rtVariability <= 0 && curr.rtVariability <= 0) {
    return true;
  }
  if (prev.rtVariability <= 0) {
    return false;
  }
  const variabilityShift =
    Math.abs(curr.rtVariability - prev.rtVariability) / prev.rtVariability;
  return variabilityShift < 0.1;
}

/** CPT: lapse rate stable across last two checkpoints (relative on denominator ≥5%). */
export function stableCptLapseRateAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1].cptLapseRate;
  const prev = checkpoints[checkpoints.length - 2].cptLapseRate;
  if (curr == null || prev == null) return false;
  if (Math.max(prev, curr) < 0.08) {
    return Math.abs(curr - prev) <= 0.05;
  }
  const denom = Math.max(prev, 0.05);
  return Math.abs(curr - prev) / denom < 0.25;
}

/** Psychomotor: omission/lapse rate stable across last two checkpoints (trial-based proportion). */
function stablePsychomotorLapseRateAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const a = checkpoints[checkpoints.length - 2];
  const b = checkpoints[checkpoints.length - 1];
  if (
    a.lapseCount == null ||
    b.lapseCount == null ||
    a.lapseTrialsTotal == null ||
    b.lapseTrialsTotal == null ||
    a.lapseTrialsTotal < 1 ||
    b.lapseTrialsTotal < 1
  ) {
    return false;
  }
  const r0 = a.lapseCount / a.lapseTrialsTotal;
  const r1 = b.lapseCount / b.lapseTrialsTotal;
  const scale = Math.max(r0, 0.05);
  return Math.abs(r1 - r0) / scale < 0.25;
}

/** CPT: time-on-task slope stable across last two checkpoints (aligned with backend `_stable_slope`). */
export function stableCptTimeOnTaskSlopeAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1].cptTimeOnTaskSlopeMsPerQuarter;
  const prev = checkpoints[checkpoints.length - 2].cptTimeOnTaskSlopeMsPerQuarter;
  if (curr == null || prev == null) return false;
  if (Math.abs(curr - prev) <= 20) return true;
  if (Math.abs(curr) < 3 && Math.abs(prev) < 3) {
    return Math.abs(curr - prev) <= 3;
  }
  const scale = Math.max(Math.abs(curr), Math.abs(prev), 5);
  return Math.abs(curr - prev) / scale < 0.25;
}

/** Relative change between two checkpoint scalars (0–1 scale). */
export function relativeCheckpointShift(prev: number, curr: number): number {
  if (prev <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(curr - prev) / prev;
}

/** Spec: absolute error & variability change <10% across two checkpoints. */
export function timeEstimationStabilityBetween(
  prev: MainAdaptiveCheckpointData,
  curr: MainAdaptiveCheckpointData,
): {
  errStable: boolean;
  varStable: boolean;
  errShiftPct: number | null;
  varShiftPct: number | null;
} {
  if (
    curr.meanAbsoluteErrorMs == null ||
    prev.meanAbsoluteErrorMs == null ||
    curr.timingVariabilityMs == null ||
    prev.timingVariabilityMs == null ||
    prev.meanAbsoluteErrorMs <= 0 ||
    prev.timingVariabilityMs <= 0
  ) {
    return { errStable: false, varStable: false, errShiftPct: null, varShiftPct: null };
  }
  const errShift = relativeCheckpointShift(prev.meanAbsoluteErrorMs, curr.meanAbsoluteErrorMs);
  const varShift = relativeCheckpointShift(prev.timingVariabilityMs, curr.timingVariabilityMs);
  return {
    errStable: errShift < 0.1,
    varStable: varShift < 0.1,
    errShiftPct: errShift,
    varShiftPct: varShift,
  };
}

function stableTimeEstimationAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1]!;
  const prev = checkpoints[checkpoints.length - 2]!;
  const { errStable, varStable } = timeEstimationStabilityBetween(prev, curr);
  return errStable && varStable;
}

export type TimeEstimationStoppingGates = {
  minPerCellOk: boolean;
  errStable: boolean;
  varStable: boolean;
  confidenceMet: boolean;
  priorTrial: number | null;
  currentTrial: number | null;
  errShiftPct: number | null;
  varShiftPct: number | null;
};

function timeEstimationConsecutiveCheckpointPair(
  history: AdaptiveHistory,
  current: MainAdaptiveCheckpointData,
): MainAdaptiveCheckpointData[] {
  const rolling = history.checkpoints;
  if (rolling.length === 0) return [current];
  const last = rolling[rolling.length - 1]!;
  if (last.trialsCompleted === current.trialsCompleted) {
    return [...rolling.slice(0, -1), current];
  }
  return [...rolling, current];
}

export function getTimeEstimationStoppingGates(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): TimeEstimationStoppingGates {
  const pair = timeEstimationConsecutiveCheckpointPair(history, c);
  const prior = pair.length >= 2 ? pair[0] : null;
  const current = pair.length >= 1 ? pair[pair.length - 1]! : c;
  const minPerCellOk = (current.timeEstimationMinTrialsPerCell ?? 0) >= 3;
  let errStable = false;
  let varStable = false;
  let errShiftPct: number | null = null;
  let varShiftPct: number | null = null;
  if (pair.length >= 2 && prior) {
    const stab = timeEstimationStabilityBetween(prior, current);
    errStable = stab.errStable;
    varStable = stab.varStable;
    errShiftPct = stab.errShiftPct;
    varShiftPct = stab.varShiftPct;
  }
  const confidenceMet = minPerCellOk && errStable && varStable;
  return {
    minPerCellOk,
    errStable,
    varStable,
    confidenceMet,
    priorTrial: prior?.trialsCompleted ?? null,
    currentTrial: current.trialsCompleted ?? null,
    errShiftPct,
    varShiftPct,
  };
}

function stableScalarAcrossTwo(
  checkpoints: MainAdaptiveCheckpointData[],
  pick: (c: MainAdaptiveCheckpointData) => number | null | undefined,
  maxRelativeDelta: number,
): boolean {
  if (checkpoints.length < 2) return false;
  const a = pick(checkpoints[checkpoints.length - 1]);
  const b = pick(checkpoints[checkpoints.length - 2]);
  if (a == null || b == null || b === 0) return false;
  return Math.abs(a - b) / Math.abs(b) < maxRelativeDelta;
}

function stableInterferenceRtCostAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1].interferenceRtCostMs;
  const prev = checkpoints[checkpoints.length - 2].interferenceRtCostMs;
  if (curr == null || prev == null) return false;
  return Math.abs(curr - prev) < 15;
}

function stableSwitchRtCostAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1].switchRtCostMs;
  const prev = checkpoints[checkpoints.length - 2].switchRtCostMs;
  if (curr == null || prev == null) return false;
  return Math.abs(curr - prev) < 20;
}

function stableSsrtAcrossTwo(checkpoints: MainAdaptiveCheckpointData[]): boolean {
  if (checkpoints.length < 2) return false;
  const curr = checkpoints[checkpoints.length - 1].ssrtMs;
  const prev = checkpoints[checkpoints.length - 2].ssrtMs;
  if (curr == null || prev == null) return false;
  return Math.abs(curr - prev) < 25;
}

function effectiveTrialCounter(
  c: MainAdaptiveCheckpointData,
  useValid: boolean,
): number {
  if (useValid && c.validTrialsCompleted != null) return c.validTrialsCompleted;
  return c.trialsCompleted;
}

/**
 * Checkpoints start after minimum: first boundary at minTrials + every.
 */
function isPeriodicCheckpointAfterMin(
  counter: number,
  minTrials: number,
  every: number,
): boolean {
  if (every <= 0) return false;
  const pastMin = counter - minTrials;
  return pastMin >= every && pastMin % every === 0;
}

/** Task switching: checkpoint at min trials, then every `every` trials after min (72, 96, …). */
function isTaskSwitchingCheckpointBoundary(
  counter: number,
  minTrials: number,
  every: number,
): boolean {
  if (counter < minTrials) return false;
  if (counter === minTrials) return true;
  return isPeriodicCheckpointAfterMin(counter, minTrials, every);
}

/** Set shifting: first checkpoint at min trials, then every `every` trials (20, 30, 40, …). */
function isSetShiftingCheckpointBoundary(
  counter: number,
  minTrials: number,
  every: number,
): boolean {
  if (counter < minTrials) return false;
  if (counter === minTrials) return true;
  return isPeriodicCheckpointAfterMin(counter, minTrials, every);
}

/** CPT spec: rolling snapshots every `every` scored trials (60, 120, 180, …). */
function isCptPeriodicCheckpoint(counter: number, every: number): boolean {
  return every > 0 && counter > 0 && counter % every === 0;
}

/** Flanker: first checkpoint at min trials, then every `every` trials after min (40, 60, 80, …). */
function isFlankerCheckpointBoundary(
  counter: number,
  minTrials: number,
  every: number,
): boolean {
  if (counter < minTrials) return false;
  if (counter === minTrials) return true;
  return isPeriodicCheckpointAfterMin(counter, minTrials, every);
}

/** Simple RT / psychomotor: first eval at min valid trials, then every `every` after min. */
function isValidTrialPeriodicCheckpointBoundary(
  counter: number,
  minTrials: number,
  every: number,
): boolean {
  if (counter < minTrials) return false;
  if (counter === minTrials) return true;
  return isPeriodicCheckpointAfterMin(counter, minTrials, every);
}

function isSstStopCheckpoint(stopTrials: number | undefined): boolean {
  if (stopTrials == null || stopTrials <= 0) return false;
  return stopTrials % 25 === 0;
}

function isSpanLoadCheckpoint(c: MainAdaptiveCheckpointData): boolean {
  return c.spanOrLoadCheckpoint === true;
}

/* -------------------------------------------------------------------------- */
/* Per-task: confidenceMet (stopping criteria)                                  */
/* -------------------------------------------------------------------------- */

function confidenceSimpleRt(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  const hist = [...history.checkpoints, c];
  const rtStable = stableRtMedianAndVariabilityAcrossTwo(hist);
  let lapseCiOk = false;
  if (c.lapseCount != null && c.lapseTrialsTotal != null && c.lapseTrialsTotal > 0) {
    lapseCiOk = wilson95Width(c.lapseCount, c.lapseTrialsTotal) <= CI_WIDTH_LAPSE_STOP;
  }
  /**
   * Wilson lapse-rate CI becomes ≤0.10 immediately when lapse rate is ~0 (e.g. 0/35) — that must not end the block
   * on the first post-min checkpoint before RT median/MAD stability across two evaluations is possible.
   * Allow lapse-only branch only after at least one prior rolling checkpoint (second periodic eval or later).
   */
  if (lapseCiOk && history.checkpoints.length < 1) {
    lapseCiOk = false;
  }
  return rtStable || lapseCiOk;
}

function confidenceChoiceRt(
  mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  const target = ciTargetForMode(mode);
  let accOk = false;
  if (c.correctTrials != null && c.responseTrials != null && c.responseTrials > 0) {
    const w = wilson95Width(c.correctTrials, c.responseTrials);
    accOk = w <= target;
  }
  const hist = [...history.checkpoints, c];
  const rtStable = stableRtMedianAndVariabilityAcrossTwo(hist);
  return accOk && rtStable;
}

export type FlankerStoppingGates = {
  cellsOk: boolean;
  trialsAtLevelOk: boolean;
  errorCiOk: boolean;
  costStable: boolean;
  confidenceMet: boolean;
  priorTrial: number | null;
  currentTrial: number | null;
};

export function mergeFlankerCheckpointTrail(
  rolling: MainAdaptiveCheckpointData[],
  current: MainAdaptiveCheckpointData,
): MainAdaptiveCheckpointData[] {
  return mergeCptCheckpointTrail(rolling, current);
}

export function flankerConsecutiveCheckpointPair(
  history: AdaptiveHistory,
  current: MainAdaptiveCheckpointData,
): MainAdaptiveCheckpointData[] {
  const trail = mergeFlankerCheckpointTrail(history.checkpoints, current);
  if (trail.length < 2) return trail;
  return trail.slice(-2);
}

export function getFlankerStoppingGates(
  mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): FlankerStoppingGates {
  const pair = flankerConsecutiveCheckpointPair(history, c);
  const prior = pair.length >= 2 ? pair[0] : null;
  const current = pair.length >= 1 ? pair[pair.length - 1]! : c;

  const cellsOk = (current.congruentTrials ?? 0) >= 15 && (current.incongruentTrials ?? 0) >= 15;
  const trialsAtLevel = current.trialsAtCurrentDifficulty ?? current.trialsCompleted ?? 0;
  const lastRolling = history.checkpoints[history.checkpoints.length - 1];
  const trialsSinceLastEval =
    lastRolling != null
      ? (current.trialsCompleted ?? 0) - (lastRolling.trialsCompleted ?? 0)
      : (current.trialsCompleted ?? 0);
  /** Periodic checkpoints are every 20 trials; also honor epoch counter when adaptation is stable. */
  const trialsAtLevelOk = trialsAtLevel >= 20 || trialsSinceLastEval >= 20;

  let errorCiOk = false;
  const target = ciTargetForMode(mode);
  if (
    current.incongruentErrors != null &&
    current.incongruentTrials != null &&
    current.incongruentTrials > 0
  ) {
    errorCiOk =
      incongruentErrorWilsonWidth(current.incongruentErrors, current.incongruentTrials) <= target;
  }

  const costStable = pair.length >= 2 && stableInterferenceRtCostAcrossTwo(pair);
  const confidenceMet = cellsOk && trialsAtLevelOk && errorCiOk && costStable;

  return {
    cellsOk,
    trialsAtLevelOk,
    errorCiOk,
    costStable,
    confidenceMet,
    priorTrial: prior?.trialsCompleted ?? null,
    currentTrial: current.trialsCompleted ?? null,
  };
}

function confidenceFlanker(
  mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  return getFlankerStoppingGates(mode, history, c).confidenceMet;
}

function confidenceSst(_mode: AdaptiveMode, history: AdaptiveHistory, c: MainAdaptiveCheckpointData): boolean {
  if ((c.goTrials ?? 0) < 1 || c.goSuccesses == null) return false;
  if (c.goSuccesses / c.goTrials! < 0.8) return false;

  if ((c.stopTrialsCompleted ?? 0) < SST_MIN_STOP_TRIALS_FOR_STABLE_STOP) return false;

  if (
    c.baselineMedianGoRtMs != null &&
    c.baselineMedianGoRtMs > 0 &&
    c.medianRtMs != null &&
    c.medianRtMs / c.baselineMedianGoRtMs > 1.25
  ) {
    return false;
  }

  if (
    c.recentStopTrials !== SST_RECENT_STOP_WINDOW_SIZE ||
    c.recentStopSuccesses == null
  ) {
    return false;
  }
  if (!sstRecentStopSuccessBandMet(c)) return false;

  const hist = [...history.checkpoints, c];
  return stableSsrtAcrossTwo(hist);
}

/** Merge rolling engine snapshots with the live checkpoint (avoids duplicate trial rows in UI). */
export function mergeCptCheckpointTrail(
  rolling: MainAdaptiveCheckpointData[],
  current: MainAdaptiveCheckpointData,
): MainAdaptiveCheckpointData[] {
  const merged = [...rolling];
  const last = merged[merged.length - 1];
  if (last?.trialsCompleted !== current.trialsCompleted) {
    merged.push(current);
  }
  return merged;
}

/** Last two consecutive checkpoint evaluations used for stability gates. */
export function cptConsecutiveCheckpointPair(
  history: AdaptiveHistory,
  current: MainAdaptiveCheckpointData,
): MainAdaptiveCheckpointData[] {
  const trail = mergeCptCheckpointTrail(history.checkpoints, current);
  if (trail.length < 2) return trail;
  return trail.slice(-2);
}

export type CptStoppingGates = {
  omissionOk: boolean;
  commissionOk: boolean;
  rtVarStable: boolean;
  lapseStable: boolean;
  slopeStable: boolean;
  confidenceMet: boolean;
  priorTrial: number | null;
  currentTrial: number | null;
};

export function getCptStoppingGates(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): CptStoppingGates {
  const pair = cptConsecutiveCheckpointPair(history, c);
  const prior = pair.length >= 2 ? pair[0] : null;
  const current = pair.length >= 1 ? pair[pair.length - 1]! : c;

  let omissionOk = false;
  let commissionOk = false;
  if (
    current.targetTrialsTotal != null &&
    current.targetTrialsTotal > 0 &&
    current.omissions != null
  ) {
    omissionOk = wilson95Width(current.omissions, current.targetTrialsTotal) <= CI_WIDTH_CPT_RATE;
  }
  if (
    current.nonTargetTrialsTotal != null &&
    current.nonTargetTrialsTotal > 0 &&
    current.commissions != null
  ) {
    commissionOk =
      wilson95Width(current.commissions, current.nonTargetTrialsTotal) <= CI_WIDTH_CPT_RATE;
  }

  const rtVarStable = pair.length >= 2 && stableRtVariabilityAcrossTwo(pair);
  const lapseStable = pair.length >= 2 && stableCptLapseRateAcrossTwo(pair);
  const slopeStable = pair.length >= 2 && stableCptTimeOnTaskSlopeAcrossTwo(pair);
  const confidenceMet =
    omissionOk && commissionOk && rtVarStable && lapseStable && slopeStable;

  return {
    omissionOk,
    commissionOk,
    rtVarStable,
    lapseStable,
    slopeStable,
    confidenceMet,
    priorTrial: prior?.trialsCompleted ?? null,
    currentTrial: current.trialsCompleted ?? null,
  };
}

export function confidenceCpt(mode: AdaptiveMode, history: AdaptiveHistory, c: MainAdaptiveCheckpointData): boolean {
  return getCptStoppingGates(mode, history, c).confidenceMet;
}

function confidenceDigitSpan(_mode: AdaptiveMode, _history: AdaptiveHistory, c: MainAdaptiveCheckpointData): boolean {
  return c.spanBatteryComplete === true;
}

function confidenceTaskSwitching(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  if ((c.switchTrials ?? 0) < 16) return false;
  if ((c.repeatTrials ?? 0) < 16) return false;
  let switchErrOk = false;
  if (c.switchErrors != null && c.switchTrials != null && c.switchTrials > 0) {
    const w = wilson95Width(c.switchErrors, c.switchTrials);
    switchErrOk = w <= CI_WIDTH_TASK_SWITCHING_SWITCH_ERROR;
  }
  const hist = [...history.checkpoints, c];
  const costStable = stableSwitchRtCostAcrossTwo(hist);
  const atLevel = (c.trialsAtCurrentDifficulty ?? c.trialsCompleted) >= 24;
  return costStable && switchErrOk && atLevel;
}

function confidenceTimeEstimation(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  if ((c.timeEstimationMinTrialsPerCell ?? 0) < 3) return false;
  const hist = [...history.checkpoints, c];
  return stableTimeEstimationAcrossTwo(hist);
}

function confidenceDelayDiscounting(
  mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  const hist = [...history.checkpoints, c];
  const indiffStable = stableScalarAcrossTwo(
    hist,
    (x) => x.indifferencePoint ?? null,
    0.1,
  );
  const consist = c.consistencyScore != null && c.consistencyScore >= 0.8;
  const cell = c.delayDiscountingMinCellTrials ?? 0;
  const cellScreenOk = cell >= 2;
  const cellDiagOk = cell >= 3;

  if (mode === "screening") {
    const n = c.trialsCompleted;
    if (n >= 12 && n <= 18 && consist && cellScreenOk) {
      return true;
    }
  }
  if (!cellDiagOk) {
    return false;
  }
  return indiffStable && consist;
}

function confidenceSubstanceDd(
  mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  return confidenceDelayDiscounting(mode, history, c);
}

function confidenceSetShifting(_mode: AdaptiveMode, _history: AdaptiveHistory, c: MainAdaptiveCheckpointData): boolean {
  if (c.perseverationEstablished === true) return true;
  return (c.ruleShiftsWithCriterion ?? 0) >= 2;
}

function confidencePsychomotor(
  _mode: AdaptiveMode,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): boolean {
  const hist = [...history.checkpoints, c];
  const rtStable = stableRtMedianAndVariabilityAcrossTwo(hist);
  const lapseStable = stablePsychomotorLapseRateAcrossTwo(hist);
  /** Spec 12: stop when median RT and variability are stable; continue if lapses remain unstable. */
  return rtStable && lapseStable;
}

function confidenceWmDistraction(_mode: AdaptiveMode, _history: AdaptiveHistory, c: MainAdaptiveCheckpointData): boolean {
  return c.wmBatteryComplete === true;
}

const CONFIDENCE_EVAL: Record<
  MainAdaptiveTrialTaskKey,
  (mode: AdaptiveMode, history: AdaptiveHistory, c: MainAdaptiveCheckpointData) => boolean
> = {
  simple_rt: confidenceSimpleRt,
  choice_rt: confidenceChoiceRt,
  flanker: confidenceFlanker,
  sst: confidenceSst,
  cpt: confidenceCpt,
  digit_span: confidenceDigitSpan,
  task_switching: confidenceTaskSwitching,
  time_estimation: confidenceTimeEstimation,
  delay_discounting: confidenceDelayDiscounting,
  set_shifting_mini: confidenceSetShifting,
  substance_dd: confidenceSubstanceDd,
  psychomotor_speed: confidencePsychomotor,
  wm_distraction: confidenceWmDistraction,
};

/* -------------------------------------------------------------------------- */
/* Validity flags (spec-aligned; extend at task stores as needed)               */
/* -------------------------------------------------------------------------- */

export function collectAdaptiveValidityFlags(
  taskKey: MainAdaptiveTrialTaskKey,
  c: MainAdaptiveCheckpointData,
  options: { reachedMax: boolean; history?: AdaptiveHistory },
): string[] {
  const flags: string[] = [];
  if (taskKey === "sst") {
    if (
      c.baselineMedianGoRtMs != null &&
      c.baselineMedianGoRtMs > 0 &&
      c.medianRtMs != null &&
      c.medianRtMs / c.baselineMedianGoRtMs > 1.25
    ) {
      flags.push("sst_waiting_strategy_go_rt_increase_gt_25pct");
    }
    if (
      c.recentStopTrials != null &&
      c.recentStopTrials !== SST_RECENT_STOP_WINDOW_SIZE
    ) {
      flags.push("sst_recent_stop_window_must_be_last_25");
    }
    if (
      options.reachedMax &&
      (c.stopTrialsCompleted ?? 0) < SST_MIN_STOP_TRIALS_FOR_STABLE_STOP
    ) {
      flags.push("sst_stop_trials_below_50_at_session_max");
    }
    if ((c.goTrials ?? 0) > 0 && c.goSuccesses != null && c.goSuccesses / c.goTrials! < 0.8) {
      flags.push("sst_go_accuracy_below_80pct");
    }
    if (c.overallStopSuccessRate != null && (c.overallStopSuccessRate < 0.3 || c.overallStopSuccessRate > 0.7)) {
      flags.push("sst_stop_success_rate_outside_03_07");
    }
    if (
      c.recentStopTrials === SST_RECENT_STOP_WINDOW_SIZE &&
      c.recentStopSuccesses != null &&
      c.recentStopTrials > 0
    ) {
      const pr = c.recentStopSuccesses / c.recentStopTrials;
      if (pr < 0.3 || pr > 0.7) {
        flags.push("sst_recent_stop_success_outside_03_07");
      }
    }
    if (c.sstSsdStuck === true) {
      flags.push("sst_ssd_stuck_trigger_failures");
    }
    const nGo = c.goTrials ?? 0;
    const nStop = c.stopTrialsCompleted ?? 0;
    if (nGo >= 5 && nStop >= 5 && c.ssrtMs == null) {
      flags.push("sst_ssrt_cannot_compute_reliably");
    }
  }
  if (taskKey === "time_estimation") {
    if (c.timeEstimationDistractorUsed === true && (c.timeEstimationMinTrialsPerCell ?? 0) < 3) {
      flags.push("time_estimation_distractor_min_trials_per_duration_condition_not_met");
    }
    if (c.timeEstimationImmediateReproductionFlag === true) {
      flags.push("time_estimation_immediate_reproduction_after_start");
    }
    if (c.timeEstimationMisunderstandingFlag === true) {
      flags.push("time_estimation_possible_misunderstanding");
    }
    if (c.timeEstimationAdjacentSwapInPlan === true) {
      flags.push("time_estimation_adjacent_same_duration_schedule_repair");
    }
    if (
      options.reachedMax &&
      c.meanAbsoluteErrorMs != null &&
      c.timingVariabilityMs != null &&
      c.meanAbsoluteErrorMs > 0 &&
      c.timingVariabilityMs > 2 * c.meanAbsoluteErrorMs
    ) {
      flags.push("time_estimation_extreme_variability_at_max_trials");
    }
  }
  if (taskKey === "delay_discounting") {
    if (c.delayDiscountingMinCellTrials != null && c.delayDiscountingMinCellTrials < 3) {
      flags.push("delay_discounting_min_cell_trials_below_3");
    }
    if (c.consistencyScore != null && c.consistencyScore < 0.7) {
      flags.push("delay_discounting_choice_consistency_below_70pct");
    }
    if (c.delayDiscountingFastChoiceRate != null && c.delayDiscountingFastChoiceRate > 0.6) {
      flags.push("delay_discounting_extremely_fast_responses_majority");
    }
    if (c.delayDiscountingDominantSideShare != null && c.delayDiscountingDominantSideShare > 0.9) {
      flags.push("delay_discounting_same_side_selection_gt_90pct");
    }
    if (c.delayDiscountingNowVsLaterMisunderstandingFlag === true) {
      flags.push("delay_discounting_now_vs_later_misunderstanding_suspected");
    }
  }
  if (taskKey === "substance_dd") {
    if (c.substanceDdDistressReported === true) {
      flags.push("substance_dd_distress_reported");
    }
    if (c.delayDiscountingMinCellTrials != null && c.delayDiscountingMinCellTrials < 3) {
      flags.push("substance_dd_min_cell_trials_below_3");
    }
    if (c.consistencyScore != null && c.consistencyScore < 0.7) {
      flags.push("substance_dd_choice_consistency_below_70pct");
    }
    if (c.delayDiscountingFastChoiceRate != null && c.delayDiscountingFastChoiceRate > 0.6) {
      flags.push("substance_dd_extremely_fast_responses_majority");
    }
    if (c.delayDiscountingDominantSideShare != null && c.delayDiscountingDominantSideShare > 0.9) {
      flags.push("substance_dd_same_side_selection_gt_90pct");
    }
  }
  if (taskKey === "choice_rt") {
    if (
      c.correctTrials != null &&
      c.responseTrials != null &&
      c.responseTrials > 0 &&
      c.correctTrials / c.responseTrials < 0.7
    ) {
      flags.push("crt_accuracy_below_70pct");
    }
    if (c.choiceRtAnticipatoryRate != null && c.choiceRtAnticipatoryRate > 0.05) {
      flags.push("crt_anticipatory_rate_gt_5pct");
    }
    if (c.choiceRtDominantResponseShare != null && c.choiceRtDominantResponseShare > 0.8) {
      flags.push("crt_side_bias_gt_80pct");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableRtMedianAndVariabilityAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("crt_rt_variability_unstable_at_max");
    }
  }
  if (taskKey === "flanker") {
    if (
      c.correctTrials != null &&
      c.responseTrials != null &&
      c.responseTrials > 0 &&
      c.correctTrials / c.responseTrials < 0.7
    ) {
      flags.push("flanker_accuracy_below_70pct");
    }
    if (c.flankerDominantResponseShare != null && c.flankerDominantResponseShare > 0.8) {
      flags.push("flanker_response_bias_gt_80pct");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableInterferenceRtCostAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("flanker_interference_unstable_at_session_max");
    }
  }
  if (taskKey === "task_switching") {
    if (
      c.correctTrials != null &&
      c.responseTrials != null &&
      c.responseTrials > 0 &&
      c.correctTrials / c.responseTrials < 0.7
    ) {
      flags.push("task_switching_accuracy_below_70pct");
    }
    if ((c.switchTrials ?? 0) < 16) {
      flags.push("task_switching_too_few_switch_trials");
    }
    if ((c.repeatTrials ?? 0) < 16) {
      flags.push("task_switching_too_few_repeat_trials");
    }
    if (c.taskSwitchingRuleConfusionPattern === true) {
      flags.push("task_switching_rule_confusion_pattern");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableSwitchRtCostAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("task_switching_switch_cost_unstable_at_session_max");
    }
  }
  if (taskKey === "simple_rt") {
    if (c.simpleRtAnticipatoryRate != null && c.simpleRtAnticipatoryRate > 0.05) {
      flags.push("srt_anticipatory_rate_gt_5pct");
    }
    if (c.simpleRtOmissionRate != null && c.simpleRtOmissionRate > 0.15) {
      flags.push("srt_omission_rate_gt_15pct");
    }
    if (c.deviceTimingJitterFlag === true) {
      flags.push("srt_device_timing_jitter_flag");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableRtMedianAndVariabilityAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("srt_rt_median_or_variability_unstable_at_session_max");
    }
  }
  if (taskKey === "psychomotor_speed") {
    if (c.simpleRtOmissionRate != null && c.simpleRtOmissionRate > 0.2) {
      flags.push("psychomotor_omission_rate_gt_20pct");
    }
    if (c.simpleRtAnticipatoryRate != null && c.simpleRtAnticipatoryRate > 0.05) {
      flags.push("psychomotor_anticipatory_rate_gt_5pct");
    }
    if (c.psychomotorMotorImpairmentNoted === true) {
      flags.push("psychomotor_motor_impairment_noted");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableRtMedianAndVariabilityAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("psychomotor_rt_variability_unstable_at_session_max");
    }
  }
  if (taskKey === "cpt") {
    if (c.cptAnticipatoryRate != null && c.cptAnticipatoryRate > 0.05) {
      flags.push("cpt_anticipatory_rate_gt_5pct");
    }
    const tt = c.targetTrialsTotal ?? 0;
    const om = c.omissions ?? 0;
    if (tt > 0 && om / tt > 0.4) {
      flags.push("cpt_omission_rate_gt_40pct_suggesting_disengagement");
    }
    if (
      options.reachedMax &&
      tt > 0 &&
      tt < 30 &&
      c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.cpt.minTrials
    ) {
      flags.push("cpt_too_few_target_trials");
    }
    if (c.deviceTimingJitterFlag === true) {
      flags.push("cpt_device_timing_problem");
    }
    if (
      options.reachedMax &&
      options.history &&
      [...options.history.checkpoints, c].length >= 2 &&
      !stableRtVariabilityAcrossTwo([...options.history.checkpoints, c])
    ) {
      flags.push("cpt_rt_variability_unstable_at_session_max");
    }
  }
  if (taskKey === "set_shifting_mini") {
    const noInitial =
      c.setShiftingFirstCriterionCompleted !== true &&
      c.trialsCompleted >= 10 &&
      (options.reachedMax ||
        c.setShiftingMaxTrialsWithoutCriterion === true ||
        c.perseverationEstablished === true);
    if (noInitial) {
      flags.push("set_shifting_failure_to_learn_initial_rule");
    }
    const persSwitch = c.setShiftingPerseverationSwitchErrors ?? 0;
    if (persSwitch >= 1) {
      flags.push("set_shifting_perseverative_errors_after_rule_change");
    }
    if (c.perseverationEstablished === true) {
      flags.push("set_shifting_perseverative_pattern_established");
    }
    if (c.setShiftingRandomRespondingFlag === true) {
      flags.push("set_shifting_random_responding_suspected");
    }
    if (c.setShiftingMaxTrialsWithoutCriterion === true) {
      flags.push("set_shifting_max_trials_reached_without_criterion");
    }
  }
  if (taskKey === "digit_span") {
    if (c.digitSpanEarlyResponseFlag === true) {
      flags.push("digit_span_sequence_entry_before_digits_cleared");
    }
    if (c.digitSpanRepeatedInvalidInput === true) {
      flags.push("digit_span_repeated_invalid_input");
    }
    if (c.digitSpanFloorAfterPractice === true) {
      flags.push("digit_span_floor_performance_after_practice");
    }
    if (c.digitSpanFailedStartingSpan === true) {
      flags.push("digit_span_high_distraction_failed_starting_span");
    }
  }
  if (taskKey === "wm_distraction") {
    if (c.wmEarlyInputFlag === true) {
      flags.push("wm_early_input_before_stimulus_ends");
    }
    if (c.wmDistractorUnderstandingFlag === true) {
      flags.push("wm_distractor_prevents_understanding");
    }
    if (c.wmFloorAfterPracticeFlag === true) {
      flags.push("wm_floor_performance_after_practice");
    }
    if (options.reachedMax && c.wmInconsistentAtMax === true) {
      flags.push("wm_inconsistent_performance_at_max_sequences");
    }
  }

  if (options.reachedMax) {
    flags.push("max_trials_reached_without_stability");
  }

  return flags;
}

/* -------------------------------------------------------------------------- */
/* Difficulty recommendations (spec + MVP notes)                                */
/* -------------------------------------------------------------------------- */

function recommendDifficulty(
  taskKey: MainAdaptiveTrialTaskKey,
  history: AdaptiveHistory,
  c: MainAdaptiveCheckpointData,
): DifficultyAdjustment {
  switch (taskKey) {
    case "flanker": {
      const acc =
        c.responseTrials && c.correctTrials != null
          ? c.correctTrials / c.responseTrials
          : null;
      const hist = [...history.checkpoints, c];
      const costStable = stableInterferenceRtCostAcrossTwo(hist);
      if (acc != null && acc >= 0.85 && costStable) return "increase";
      if (acc != null && acc < 0.7) return "decrease";
      return "hold";
    }
    case "task_switching": {
      const acc =
        c.responseTrials && c.correctTrials != null && c.responseTrials > 0
          ? c.correctTrials / c.responseTrials
          : null;
      const hist = [...history.checkpoints, c];
      const costStable = stableSwitchRtCostAcrossTwo(hist);
      if (acc != null && acc >= 0.85 && costStable) return "increase";
      if (acc != null && acc < 0.7) return "decrease";
      return "hold";
    }
    case "choice_rt": {
      if (!c.choiceRtThreeChoiceExtendedMode) return "hold";
      if (c.choiceRtThreeChoiceActive) return "hold";
      const v = c.validTrialsCompleted ?? c.trialsCompleted;
      if (v < 40) return "hold";
      const acc =
        c.responseTrials && c.correctTrials != null && c.responseTrials > 0
          ? c.correctTrials / c.responseTrials
          : 0;
      if (acc < 0.9) return "hold";
      const hist = [...history.checkpoints, c];
      if (!stableRtMedianAndVariabilityAcrossTwo(hist)) return "hold";
      return "increase";
    }
    case "cpt":
    case "time_estimation":
    case "delay_discounting":
    case "substance_dd":
    case "set_shifting_mini":
      return "hold";
    default:
      return "hold";
  }
}

/* -------------------------------------------------------------------------- */
/* Checkpoint boundary                                                          */
/* -------------------------------------------------------------------------- */

function shouldEvaluateAtCheckpoint(
  taskKey: MainAdaptiveTrialTaskKey,
  policy: MainTaskAdaptivePolicy,
  c: MainAdaptiveCheckpointData,
  reachedMax: boolean,
): boolean {
  if (reachedMax) return true;

  switch (taskKey) {
    case "sst": {
      const stops = c.stopTrialsCompleted;
      if (stops == null) return false;
      return isSstStopCheckpoint(stops);
    }
    case "choice_rt": {
      const counter = effectiveTrialCounter(c, true);
      return isValidTrialPeriodicCheckpointBoundary(
        counter,
        policy.minTrials,
        policy.checkpointEvery,
      );
    }
    case "simple_rt":
    case "psychomotor_speed": {
      const counter = effectiveTrialCounter(c, true);
      return isValidTrialPeriodicCheckpointBoundary(
        counter,
        policy.minTrials,
        policy.checkpointEvery,
      );
    }
    case "digit_span":
    case "wm_distraction":
      return isSpanLoadCheckpoint(c);
    case "set_shifting_mini": {
      const counter = effectiveTrialCounter(c, false);
      if (c.setShiftingRuleBlockEnded === true) return true;
      return isSetShiftingCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery);
    }
    case "cpt": {
      const counter = effectiveTrialCounter(c, false);
      return isCptPeriodicCheckpoint(counter, policy.checkpointEvery);
    }
    case "flanker": {
      const counter = effectiveTrialCounter(c, false);
      return isFlankerCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery);
    }
    case "task_switching": {
      const counter = effectiveTrialCounter(c, false);
      return isTaskSwitchingCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery);
    }
    case "time_estimation": {
      const counter = effectiveTrialCounter(c, false);
      return (
        counter >= policy.minTrials &&
        isPeriodicCheckpointAfterMin(counter, policy.minTrials, policy.checkpointEvery)
      );
    }
    case "delay_discounting":
    case "substance_dd": {
      const counter = effectiveTrialCounter(c, false);
      return (
        counter >= policy.minTrials &&
        isPeriodicCheckpointAfterMin(counter, policy.minTrials, policy.checkpointEvery)
      );
    }
    default: {
      const counter = effectiveTrialCounter(c, false);
      return counter >= policy.minTrials;
    }
  }
}

/**
 * Rolling history snapshots for stability checks — periodic samples only (plus span/SST boundaries).
 * Choice RT evaluates on periodic valid-trial cadence after min; simple_rt/psychomotor after min each trial.
 */
function shouldAppendAdaptiveCheckpoint(
  taskKey: MainAdaptiveTrialTaskKey,
  policy: MainTaskAdaptivePolicy,
  c: MainAdaptiveCheckpointData,
  reachedMax: boolean,
): boolean {
  if (reachedMax) return true;

  switch (taskKey) {
    case "sst": {
      const stops = c.stopTrialsCompleted;
      if (stops == null) return false;
      return isSstStopCheckpoint(stops);
    }
    case "digit_span":
    case "wm_distraction":
      return isSpanLoadCheckpoint(c);
    case "set_shifting_mini": {
      const counter = effectiveTrialCounter(c, false);
      return (
        isSetShiftingCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery) ||
        c.setShiftingRuleBlockEnded === true
      );
    }
    case "choice_rt": {
      const counter = effectiveTrialCounter(c, true);
      return isValidTrialPeriodicCheckpointBoundary(
        counter,
        policy.minTrials,
        policy.checkpointEvery,
      );
    }
    case "task_switching": {
      const counter = effectiveTrialCounter(c, false);
      return isTaskSwitchingCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery);
    }
    case "cpt": {
      const counter = effectiveTrialCounter(c, false);
      return isCptPeriodicCheckpoint(counter, policy.checkpointEvery);
    }
    case "flanker": {
      const counter = effectiveTrialCounter(c, false);
      return isFlankerCheckpointBoundary(counter, policy.minTrials, policy.checkpointEvery);
    }
    case "time_estimation": {
      const counter = effectiveTrialCounter(c, false);
      return (
        counter >= policy.minTrials &&
        isPeriodicCheckpointAfterMin(counter, policy.minTrials, policy.checkpointEvery)
      );
    }
    case "delay_discounting":
    case "substance_dd": {
      const counter = effectiveTrialCounter(c, false);
      return (
        counter >= policy.minTrials &&
        isPeriodicCheckpointAfterMin(counter, policy.minTrials, policy.checkpointEvery)
      );
    }
    case "simple_rt":
    case "psychomotor_speed": {
      const counter = effectiveTrialCounter(c, true);
      return isValidTrialPeriodicCheckpointBoundary(
        counter,
        policy.minTrials,
        policy.checkpointEvery,
      );
    }
    default: {
      const counter = effectiveTrialCounter(c, false);
      return isPeriodicCheckpointAfterMin(counter, policy.minTrials, policy.checkpointEvery);
    }
  }
}

function extendAdaptiveHistory(
  history: AdaptiveHistory,
  checkpoint: MainAdaptiveCheckpointData,
  append: boolean,
  lowConfidenceFlag: boolean,
): AdaptiveHistory {
  return {
    lowConfidenceFlag,
    checkpoints: append ? [...history.checkpoints, checkpoint] : history.checkpoints,
  };
}

/* -------------------------------------------------------------------------- */
/* Min structural gates before stopping                                         */
/* -------------------------------------------------------------------------- */

function passesMinTrialThreshold(
  taskKey: MainAdaptiveTrialTaskKey,
  c: MainAdaptiveCheckpointData,
  effectiveMinTrials?: number,
): boolean {
  const lim = effectiveMinTrials ?? MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey].minTrials;
  const useValid =
    taskKey === "simple_rt" || taskKey === "choice_rt" || taskKey === "psychomotor_speed";
  if (taskKey === "sst") {
    return c.trialsCompleted >= lim && (c.stopTrialsCompleted ?? 0) >= 30;
  }
  if (useValid) {
    const v = c.validTrialsCompleted ?? c.trialsCompleted;
    return v >= lim;
  }
  return c.trialsCompleted >= lim;
}

/** Extra per-task gates before allowing stop_stable (congruent/incongruent, switch count, etc.). */
function meetsMinimumStructural(
  taskKey: MainAdaptiveTrialTaskKey,
  c: MainAdaptiveCheckpointData,
  effectiveMinTrials?: number,
): boolean {
  const minT = effectiveMinTrials ?? MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey].minTrials;
  switch (taskKey) {
    case "flanker":
      return (
        (c.congruentTrials ?? 0) >= 15 &&
        (c.incongruentTrials ?? 0) >= 15 &&
        c.trialsCompleted >= minT
      );
    case "task_switching":
      return (
        (c.switchTrials ?? 0) >= 16 &&
        (c.repeatTrials ?? 0) >= 16 &&
        c.trialsCompleted >= minT
      );
    case "sst":
      return (
        c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.sst.minTrials &&
        (c.stopTrialsCompleted ?? 0) >= 30
      );
    case "time_estimation":
      return (
        c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.time_estimation.minTrials &&
        (c.timeEstimationMinTrialsPerCell ?? 0) >= 3
      );
    case "delay_discounting":
    case "substance_dd":
      return (
        c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.delay_discounting.minTrials &&
        (c.delayDiscountingMinCellTrials ?? 0) >= 2
      );
    case "set_shifting_mini":
      if (c.perseverationEstablished === true) {
        return c.trialsCompleted >= 10;
      }
      return (
        c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.set_shifting_mini.minTrials &&
        (c.ruleShiftsWithCriterion ?? 0) >= 2
      );
    case "wm_distraction":
      return (
        c.trialsCompleted >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.wm_distraction.minTrials &&
        (c.wmMinTrialsPerConditionMet === true ||
          ((c.wmTrialsClean ?? 0) >= 2 && (c.wmTrialsDistracted ?? 0) >= 2))
      );
    default:
      return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Policy presets                                                               */
/* -------------------------------------------------------------------------- */

type PolicyBase = Omit<MainTaskAdaptivePolicy, "minTrials" | "maxTrials">;

const MAIN_TASK_POLICY_BASES: Record<MainAdaptiveTrialTaskKey, PolicyBase> = {
  simple_rt: { taskName: "simple_rt", checkpointEvery: 10 },
  choice_rt: { taskName: "choice_rt", checkpointEvery: 10 },
  flanker: { taskName: "flanker", checkpointEvery: 20 },
  sst: { taskName: "sst", checkpointEvery: 25 },
  cpt: { taskName: "cpt", checkpointEvery: 60 },
  digit_span: { taskName: "digit_span", checkpointEvery: 1 },
  task_switching: { taskName: "task_switching", checkpointEvery: 24 },
  time_estimation: { taskName: "time_estimation", checkpointEvery: 6 },
  delay_discounting: { taskName: "delay_discounting", checkpointEvery: 6 },
  set_shifting_mini: { taskName: "set_shifting_mini", checkpointEvery: 10 },
  substance_dd: { taskName: "substance_dd", checkpointEvery: 6 },
  psychomotor_speed: { taskName: "psychomotor_speed", checkpointEvery: 10 },
  wm_distraction: { taskName: "wm_distraction", checkpointEvery: 1 },
};

function mergeMainTaskPolicy(taskKey: MainAdaptiveTrialTaskKey): MainTaskAdaptivePolicy {
  const base = MAIN_TASK_POLICY_BASES[taskKey];
  const lim = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey];
  return {
    ...base,
    minTrials: lim.minTrials,
    maxTrials: lim.maxTrials,
  };
}

export const MAIN_TASK_POLICY_PRESETS: Record<MainAdaptiveTrialTaskKey, MainTaskAdaptivePolicy> =
  Object.fromEntries(
    (Object.keys(MAIN_TASK_POLICY_BASES) as MainAdaptiveTrialTaskKey[]).map((k) => [
      k,
      mergeMainTaskPolicy(k),
    ]),
  ) as Record<MainAdaptiveTrialTaskKey, MainTaskAdaptivePolicy>;

/**
 * Main adaptive evaluation: dispatch by `taskKey` using the adaptive spec for each test.
 */
export function isMainAdaptiveEvaluationPoint(
  taskKey: MainAdaptiveTrialTaskKey,
  checkpoint: MainAdaptiveCheckpointData,
  bounds?: MainAdaptiveSessionBounds,
): boolean {
  const policy = resolveSessionAdaptivePolicy(taskKey, bounds);
  const reachedMax = checkpoint.trialsCompleted >= policy.maxTrials;
  return shouldEvaluateAtCheckpoint(taskKey, policy, checkpoint, reachedMax);
}

export function evaluateMainAdaptiveCheckpoint(
  input: MainAdaptiveEvaluationInput,
): MainAdaptiveEvaluationOutput {
  const { taskKey, mode, history, checkpoint, sessionMinTrials, sessionMaxTrials } = input;
  const policy = resolveSessionAdaptivePolicy(taskKey, { sessionMinTrials, sessionMaxTrials });
  const { minTrials, maxTrials } = policy;
  const trialsCompleted = checkpoint.trialsCompleted;
  const reachedMax = trialsCompleted >= maxTrials;

  const appendSnapshot = shouldAppendAdaptiveCheckpoint(
    taskKey,
    policy,
    checkpoint,
    reachedMax,
  );

  const recommendedDifficulty = recommendDifficulty(taskKey, history, checkpoint);

  if (!passesMinTrialThreshold(taskKey, checkpoint, minTrials)) {
    const shown =
      taskKey === "simple_rt" || taskKey === "choice_rt" || taskKey === "psychomotor_speed"
        ? effectiveTrialCounter(checkpoint, true)
        : taskKey === "sst"
          ? checkpoint.trialsCompleted
          : checkpoint.trialsCompleted;
    return {
      decision: "continue",
      confidenceMet: false,
      lowConfidenceFlag: history.lowConfidenceFlag,
      validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
      adaptiveStoppingReason: `below_min_trials_${shown}_of_${minTrials}`,
      recommendedDifficulty,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, history.lowConfidenceFlag),
    };
  }

  const atCheckpoint = shouldEvaluateAtCheckpoint(taskKey, policy, checkpoint, reachedMax);

  if (!atCheckpoint && !reachedMax) {
    return {
      decision: "continue",
      confidenceMet: false,
      lowConfidenceFlag: history.lowConfidenceFlag,
      validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
      adaptiveStoppingReason: "not_checkpoint_boundary",
      recommendedDifficulty,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, history.lowConfidenceFlag),
    };
  }

  let confidenceMet = CONFIDENCE_EVAL[taskKey](mode, history, checkpoint);
  if (!meetsMinimumStructural(taskKey, checkpoint, minTrials)) {
    confidenceMet = false;
  }

  // CPT: if fatigue slope is an explicit stopping goal, require ≥4 minutes of data first.
  if (
    taskKey === "cpt" &&
    confidenceMet &&
    checkpoint.fatigueSlopeAnalysisActive === true &&
    (checkpoint.scoredDurationMinutes ?? 0) < 4
  ) {
    confidenceMet = false;
  }

  if (confidenceMet) {
    let stableReason = "spec_stopping_criteria_met";
    if (taskKey === "digit_span" && checkpoint.digitSpanBatteryStopReason) {
      stableReason = `digit_span_battery_${checkpoint.digitSpanBatteryStopReason}`;
    }
    return {
      decision: "stop_stable",
      confidenceMet: true,
      lowConfidenceFlag: false,
      validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
      adaptiveStoppingReason: stableReason,
      recommendedDifficulty,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, false),
    };
  }

  if (reachedMax) {
    let maxReason: string = "max_trials_reached_without_stability";
    if (taskKey === "sst") {
      if ((checkpoint.stopTrialsCompleted ?? 0) < SST_MIN_STOP_TRIALS_FOR_STABLE_STOP) {
        maxReason = "max_trials_reached_stop_trials_below_50";
      } else if (
        checkpoint.overallStopSuccessRate != null &&
        (checkpoint.overallStopSuccessRate < 0.3 || checkpoint.overallStopSuccessRate > 0.7)
      ) {
        maxReason = "max_trials_reached_stop_success_outside_03_07";
      } else {
        maxReason = "max_trials_reached_without_stability";
      }
    }
    const maxFlags = collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: true, history });
    return {
      decision: "stop_max_low_confidence",
      confidenceMet: false,
      lowConfidenceFlag: true,
      validityFlags: maxFlags,
      adaptiveStoppingReason: maxReason,
      recommendedDifficulty,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, true),
    };
  }

  const diff = recommendDifficulty(taskKey, history, checkpoint);
  if (diff === "increase") {
    return {
      decision: "adjust_difficulty_up",
      confidenceMet: false,
      lowConfidenceFlag: history.lowConfidenceFlag,
      validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
      adaptiveStoppingReason: "continue_adjust_difficulty_up",
      recommendedDifficulty: diff,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, history.lowConfidenceFlag),
    };
  }
  if (diff === "decrease") {
    return {
      decision: "adjust_difficulty_down",
      confidenceMet: false,
      lowConfidenceFlag: history.lowConfidenceFlag,
      validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
      adaptiveStoppingReason: "continue_adjust_difficulty_down",
      recommendedDifficulty: diff,
      history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, history.lowConfidenceFlag),
    };
  }

  return {
    decision: "continue",
    confidenceMet: false,
    lowConfidenceFlag: history.lowConfidenceFlag,
    validityFlags: collectAdaptiveValidityFlags(taskKey, checkpoint, { reachedMax: false, history }),
    adaptiveStoppingReason: "continue_collecting_data",
    recommendedDifficulty,
    history: extendAdaptiveHistory(history, checkpoint, appendSnapshot, history.lowConfidenceFlag),
  };
}
