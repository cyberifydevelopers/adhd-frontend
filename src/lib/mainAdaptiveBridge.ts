/**
 * Builds {@link MainAdaptiveCheckpointData} from main-task trial stores for `mainAdaptiveEngine`.
 * Practice phases must not call these builders.
 */
import type { MainAdaptiveCheckpointData } from "@/lib/mainAdaptiveEngine";
import {
  SST_MIN_STOP_TRIALS_FOR_STABLE_STOP,
  SST_RECENT_STOP_WINDOW_SIZE,
} from "@/lib/mainAdaptiveEngine";

const ANT_MS = 120;

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[m]! : ((s[m - 1]! + s[m]!) / 2);
}

export function medianAbsoluteDeviation(nums: number[], med: number): number | null {
  if (nums.length === 0) return null;
  const devs = nums.map((n) => Math.abs(n - med));
  return median(devs);
}

export type BuildSimpleRtLikeCheckpointOpts = {
  /**
   * `responded_ge_ant`: valid trials = count of trials with RT ≥ anticipatory threshold (psychomotor spec).
   * Default: all trials in `events` count toward min-trial / periodic counters (simple RT).
   */
  validTrialsCounter?: "total" | "responded_ge_ant";
  psychomotorMotorImpairmentNoted?: boolean;
};

/** Simple RT / psychomotor_speed — median/MAD on valid RTs (≥120 ms); lapse Wilson uses omission count */
export function buildSimpleRtLikeCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  opts?: BuildSimpleRtLikeCheckpointOpts,
): MainAdaptiveCheckpointData {
  const total = events.length;
  const responded = events.filter((e) => typeof e.reaction_time_ms === "number");
  const anticipatoryCount = responded.filter((e) => (e.reaction_time_ms as number) < ANT_MS).length;
  const simpleRtAnticipatoryRate =
    responded.length > 0 ? anticipatoryCount / responded.length : undefined;

  const omissionCount = events.filter(
    (e) => e.reaction_time_ms == null || e.reaction_time_ms === undefined,
  ).length;
  const simpleRtOmissionRate = total > 0 ? omissionCount / total : undefined;

  const rts = events
    .filter((e) => e.is_correct === true && typeof e.reaction_time_ms === "number")
    .map((e) => e.reaction_time_ms as number)
    .filter((rt) => rt >= ANT_MS);
  const med = median(rts);
  const mad = med != null ? medianAbsoluteDeviation(rts, med) : null;

  const lapseCount = omissionCount;
  const lapseTrialsTotal = Math.max(1, total);

  const validTrialsCompleted =
    opts?.validTrialsCounter === "responded_ge_ant"
      ? events.filter(
          (e) => typeof e.reaction_time_ms === "number" && (e.reaction_time_ms as number) >= ANT_MS,
        ).length
      : total;

  return {
    trialsCompleted: total,
    validTrialsCompleted,
    medianRtMs: med,
    rtVariability: mad,
    lapseCount,
    lapseTrialsTotal,
    lapseNonEvents: Math.max(0, total - lapseCount),
    simpleRtAnticipatoryRate,
    simpleRtOmissionRate,
    ...(opts?.psychomotorMotorImpairmentNoted === true ? { psychomotorMotorImpairmentNoted: true } : {}),
  };
}

/** CRT checkpoint: extendedFeatureEnabled = session allows extended CRT rules; threeChoiceActive = expanded (4-way) direction set for main/extension */
export type ChoiceRtCheckpointOptions = {
  extendedFeatureEnabled: boolean;
  threeChoiceActive: boolean;
};

/**
 * Median(RT | prior trial incorrect) − median(RT | prior trial correct); valid RTs only (≥120 ms).
 */
export function computeChoiceRtPostErrorSlowingMs(events: Record<string, unknown>[]): number | null {
  const sorted = [...events].sort((a, b) => Number(a.trial_index) - Number(b.trial_index));
  const afterErr: number[] = [];
  const afterOk: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const rt = cur.reaction_time_ms as number | null | undefined;
    if (typeof rt !== "number" || rt < ANT_MS) continue;
    const prevOk = prev.is_correct === true;
    if (prevOk) afterOk.push(rt);
    else afterErr.push(rt);
  }
  if (afterErr.length === 0 || afterOk.length === 0) return null;
  const medE = median(afterErr);
  const medO = median(afterOk);
  if (medE == null || medO == null) return null;
  return medE - medO;
}

export function buildChoiceRtCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  opts: ChoiceRtCheckpointOptions,
): MainAdaptiveCheckpointData {
  const responded = events.filter((e) => typeof e.reaction_time_ms === "number");
  const correct = events.filter((e) => e.is_correct === true).length;
  const anticipatoryCount = responded.filter(
    (e) => typeof e.reaction_time_ms === "number" && (e.reaction_time_ms as number) < ANT_MS,
  ).length;
  const choiceRtAnticipatoryRate =
    responded.length > 0 ? anticipatoryCount / responded.length : undefined;
  const keyCounts = new Map<string, number>();
  for (const e of responded) {
    const k = String(e.response_key ?? "");
    if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  let choiceRtDominantResponseShare: number | undefined;
  if (responded.length > 0) {
    let mx = 0;
    for (const v of keyCounts.values()) mx = Math.max(mx, v / responded.length);
    choiceRtDominantResponseShare = mx;
  }
  const rts = events
    .filter((e) => e.is_correct === true && typeof e.reaction_time_ms === "number")
    .map((e) => e.reaction_time_ms as number)
    .filter((rt) => rt >= ANT_MS);
  const med = median(rts);
  const mad = med != null ? medianAbsoluteDeviation(rts, med) : null;
  const total = events.length;
  const choiceRtPostErrorSlowingMs = computeChoiceRtPostErrorSlowingMs(events);
  return {
    trialsCompleted: total,
    validTrialsCompleted: responded.length,
    correctTrials: correct,
    responseTrials: responded.length,
    medianRtMs: med,
    rtVariability: mad,
    choiceRtThreeChoiceExtendedMode: opts.extendedFeatureEnabled,
    choiceRtThreeChoiceActive: opts.threeChoiceActive,
    choiceRtPostErrorSlowingMs,
    choiceRtAnticipatoryRate,
    choiceRtDominantResponseShare,
  };
}

export type BuildFlankerCheckpointOpts = {
  trialsAtCurrentDifficulty?: number;
};

export function buildFlankerCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  opts?: BuildFlankerCheckpointOpts,
): MainAdaptiveCheckpointData {
  const cong = events.filter((e) => e.event_type === "congruent");
  const incong = events.filter((e) => e.event_type === "incongruent");
  const incongErr = incong.filter((e) => e.is_correct !== true).length;
  const congRt = cong
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((rt): rt is number => typeof rt === "number" && rt >= ANT_MS);
  const incongRt = incong
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((rt): rt is number => typeof rt === "number" && rt >= ANT_MS);
  const mC = median(congRt);
  const mI = median(incongRt);
  const cost = mC != null && mI != null ? mI - mC : null;
  const correct = events.filter((e) => e.is_correct === true).length;
  const responded = events.filter((e) => typeof e.reaction_time_ms === "number");
  const keyCounts = new Map<string, number>();
  for (const e of responded) {
    const k = String(e.response_key ?? "");
    if (k) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
  }
  let flankerDominantResponseShare: number | undefined;
  if (responded.length > 0) {
    let mx = 0;
    for (const v of keyCounts.values()) mx = Math.max(mx, v / responded.length);
    flankerDominantResponseShare = mx;
  }
  return {
    trialsCompleted: events.length,
    congruentTrials: cong.length,
    incongruentTrials: incong.length,
    incongruentErrors: incongErr,
    interferenceRtCostMs: cost,
    correctTrials: correct,
    responseTrials: events.length,
    flankerDominantResponseShare,
    trialsAtCurrentDifficulty: opts?.trialsAtCurrentDifficulty ?? events.length,
  };
}

/** Spec / backend-aligned SSD bounds for SST staircase */
export const SST_SSD_SPEC_MIN_MS = 50;
export const SST_SSD_SPEC_MAX_MS = 900;

/**
 * SSRT via integration method — matches backend `app/scoring/sst.py` `compute_metrics`.
 * Uses mean SSD and the go RT at quantile p = overall stop success rate.
 */
export function computeSstSsrtIntegrationMs(events: Record<string, unknown>[]): number | null {
  const goTrials = events.filter((e) => e.event_type === "go");
  const stopTrials = events.filter((e) => e.event_type === "stop");
  const goRts = goTrials
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((rt): rt is number => typeof rt === "number");
  const nStop = stopTrials.length;
  if (nStop === 0 || goRts.length === 0) return null;

  const stopSuccesses = stopTrials.filter((e) => e.is_correct === true).length;
  const stopSuccessRate = stopSuccesses / nStop;

  const ssds = stopTrials
    .map((e) => e.isi_ms as number | undefined)
    .filter((x): x is number => typeof x === "number");
  const meanSsd = ssds.length > 0 ? ssds.reduce((a, b) => a + b, 0) / ssds.length : null;

  if (meanSsd == null || !(stopSuccessRate > 0 && stopSuccessRate < 1)) return null;

  const sortedGoRts = [...goRts].sort((a, b) => a - b);
  let idx = Math.floor(stopSuccessRate * sortedGoRts.length);
  idx = Math.min(Math.max(0, idx), sortedGoRts.length - 1);
  const nthRt = sortedGoRts[idx]!;
  return nthRt - meanSsd;
}

/** Long runs at SSD floor/ceiling — spec “trigger failures” / staircase not moving */
export function computeSstSsdStuck(
  events: Record<string, unknown>[],
  floorMs: number,
  ceilingMs: number,
  runThreshold: number,
): boolean {
  const ssds = events
    .filter((e: Record<string, unknown>) => e.event_type === "stop" && e.isi_ms != null)
    .map((e) => e.isi_ms as number);
  if (ssds.length < runThreshold) return false;
  let floorRun = 0;
  let ceilingRun = 0;
  for (let i = 0; i < ssds.length; i += 1) {
    if (ssds[i]! <= floorMs) {
      floorRun = i > 0 && ssds[i - 1]! <= floorMs ? floorRun + 1 : 1;
      if (floorRun >= runThreshold) return true;
    } else floorRun = 0;
  }
  for (let i = 0; i < ssds.length; i += 1) {
    if (ssds[i]! >= ceilingMs) {
      ceilingRun = i > 0 && ssds[i - 1]! >= ceilingMs ? ceilingRun + 1 : 1;
      if (ceilingRun >= runThreshold) return true;
    } else ceilingRun = 0;
  }
  return false;
}

/** Minimum stop trials required for a main session of this total length (spec). */
export function sstMinStopTrialsForSession(totalTrials: number): number {
  if (totalTrials >= 200) return SST_MIN_STOP_TRIALS_FOR_STABLE_STOP;
  if (totalTrials >= 120) return 30;
  return Math.min(30, Math.max(1, Math.floor(totalTrials * 0.25)));
}

/** 
 * Main SST schedule: guarantees ≥minStopTrials stop trials, remainder go, then shuffled.
 * Fixes under-sampling stop trials with a fixed goRatio alone (e.g. only 46/200 stops).
 */
export function buildSstMainTrialSchedule(
  totalTrials: number,
  minStopTrials: number,
  isiMs?: () => number,
): { type: "go" | "stop"; direction: "left" | "right"; isi_ms: number }[] {
  const total = Math.max(1, totalTrials);
  const minStop = Math.min(Math.max(0, minStopTrials), total);
  const isi = isiMs ?? (() => 1200 + Math.random() * 600);
  const dir = () => (Math.random() < 0.5 ? "left" : "right") as "left" | "right";
  const trials: { type: "go" | "stop"; direction: "left" | "right"; isi_ms: number }[] = [];
  for (let i = 0; i < minStop; i += 1) {
    trials.push({ type: "stop", direction: dir(), isi_ms: isi() });
  }
  for (let i = minStop; i < total; i += 1) {
    trials.push({ type: "go", direction: dir(), isi_ms: isi() });
  }
  for (let i = trials.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = trials[i]!;
    trials[i] = trials[j]!;
    trials[j] = tmp;
  }
  return trials;
}

export function buildSstCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  baselineMedianGoRtMs: number | null,
): MainAdaptiveCheckpointData {
  const goEv = events.filter((e) => e.event_type === "go");
  const stopEv = events.filter((e) => e.event_type === "stop");
  const goRts = goEv
    .filter((e) => typeof e.reaction_time_ms === "number")
    .map((e) => e.reaction_time_ms as number);
  const medianGo = median(goRts);
  const recentStops = stopEv.slice(-SST_RECENT_STOP_WINDOW_SIZE);
  const recentStopSuccesses = recentStops.filter((e) => e.is_correct === true).length;
  const goSucc = goEv.filter((e) => e.is_correct === true).length;
  const overallStopSuccesses = stopEv.filter((e) => e.is_correct === true).length;
  const overallStopTrials = stopEv.length;
  const overallStopSuccessRate =
    overallStopTrials > 0 ? overallStopSuccesses / overallStopTrials : undefined;
  const stuck = computeSstSsdStuck(events, SST_SSD_SPEC_MIN_MS, SST_SSD_SPEC_MAX_MS, 5);
  return {
    trialsCompleted: events.length,
    stopTrialsCompleted: stopEv.length,
    recentStopSuccesses,
    recentStopTrials: recentStops.length,
    ssrtMs: computeSstSsrtIntegrationMs(events),
    goSuccesses: goSucc,
    goTrials: goEv.length,
    medianRtMs: medianGo,
    baselineMedianGoRtMs,
    overallStopSuccessRate,
    sstSsdStuck: stuck,
  };
}

export type BuildCptCheckpointOpts = {
  /** When true, engine applies ≥4 min gate before stop if fatigue slope analysis is active */
  fatigueSlopeAnalysisActive?: boolean;
  droppedFrames?: number;
};

/** Cumulative lapse rate — omissions + RT &gt; 2× median among valid target RTs (backend-aligned). */
export function computeCptLapseRate(events: Record<string, unknown>[]): number | null {
  const targets = events.filter((e) => e.event_type === "target");
  if (targets.length === 0) return null;
  const validRts = targets
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((rt): rt is number => typeof rt === "number" && rt >= ANT_MS);
  const medRt = median(validRts);
  let lapseCount = 0;
  for (const e of targets) {
    const rt = e.reaction_time_ms as number | null | undefined;
    if (rt == null) {
      lapseCount += 1;
    } else if (medRt != null && rt > 2 * medRt) {
      lapseCount += 1;
    }
  }
  return lapseCount / targets.length;
}

/** Quarter-mean RT slope (vigilance decrement) — matches backend `compute_metrics`. */
export function computeCptTimeOnTaskSlopeMsPerQuarter(events: Record<string, unknown>[]): number | null {
  const validRts = events
    .filter(
      (e) =>
        e.event_type === "target" &&
        typeof e.reaction_time_ms === "number" &&
        (e.reaction_time_ms as number) >= ANT_MS,
    )
    .map((e) => e.reaction_time_ms as number);
  if (validRts.length < 4) return null;
  const quarters = 4;
  const perQ = Math.max(1, Math.floor(validRts.length / quarters));
  const quarterMeans: number[] = [];
  for (let i = 0; i < quarters; i += 1) {
    const slice =
      i === quarters - 1
        ? validRts.slice(i * perQ)
        : validRts.slice(i * perQ, (i + 1) * perQ);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    quarterMeans.push(mean);
  }
  return (quarterMeans[quarters - 1]! - quarterMeans[0]!) / Math.max(quarters - 1, 1);
}

export function buildCptCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  scoredDurationMinutes?: number,
  opts?: BuildCptCheckpointOpts,
): MainAdaptiveCheckpointData {
  const targets = events.filter((e) => e.event_type === "target");
  const nonTargets = events.filter((e) => e.event_type === "nontarget");
  const omissions = targets.filter((e) => e.reaction_time_ms == null).length;
  const commissions = nonTargets.filter((e) => e.reaction_time_ms != null).length;
  const respondedTargets = targets.filter((e) => typeof e.reaction_time_ms === "number");
  const targetRts = respondedTargets.map((e) => e.reaction_time_ms as number);
  const anticipatoryCount = targetRts.filter((rt) => rt < ANT_MS).length;
  const cptAnticipatoryRate =
    targetRts.length > 0 ? anticipatoryCount / targetRts.length : undefined;
  const rts = events
    .filter(
      (e) =>
        e.event_type === "target" &&
        e.is_correct === true &&
        typeof e.reaction_time_ms === "number",
    )
    .map((e) => e.reaction_time_ms as number)
    .filter((rt) => rt >= ANT_MS);
  const med = median(rts);
  const mad = med != null ? medianAbsoluteDeviation(rts, med) : null;
  const dropped = opts?.droppedFrames ?? 0;
  const cptLapseRate = computeCptLapseRate(events);
  const cptTimeOnTaskSlopeMsPerQuarter = computeCptTimeOnTaskSlopeMsPerQuarter(events);
  return {
    trialsCompleted: events.length,
    omissions,
    targetTrialsTotal: Math.max(1, targets.length),
    commissions,
    nonTargetTrialsTotal: Math.max(1, nonTargets.length),
    medianRtMs: med,
    rtVariability: mad,
    scoredDurationMinutes,
    fatigueSlopeAnalysisActive: opts?.fatigueSlopeAnalysisActive ?? false,
    cptAnticipatoryRate,
    cptLapseRate,
    cptTimeOnTaskSlopeMsPerQuarter,
    deviceTimingJitterFlag: dropped >= 8,
  };
}

export function buildTaskSwitchingCheckpoint(
  events: Record<string, unknown>[],
  _sessionMaxTrials: number,
  opts?: { trialsAtCurrentDifficulty?: number },
): MainAdaptiveCheckpointData {
  const sw = events.filter(
    (e) => typeof e.event_type === "string" && String(e.event_type).includes("_switch"),
  );
  const rep = events.filter(
    (e) => typeof e.event_type === "string" && String(e.event_type).includes("_repeat"),
  );
  const swRt = sw
    .filter((e) => e.is_correct === true && typeof e.reaction_time_ms === "number")
    .map((e) => e.reaction_time_ms as number);
  const repRt = rep
    .filter((e) => e.is_correct === true && typeof e.reaction_time_ms === "number")
    .map((e) => e.reaction_time_ms as number);
  const mS = median(swRt);
  const mR = median(repRt);
  const cost = mS != null && mR != null ? mS - mR : null;
  const swErr = sw.filter((e) => e.is_correct !== true).length;
  const repErr = rep.filter((e) => e.is_correct !== true).length;
  const correct = events.filter((e) => e.is_correct === true).length;
  const swErrRate = sw.length > 0 ? swErr / sw.length : 0;
  const repErrRate = rep.length > 0 ? repErr / rep.length : 0;
  const taskSwitchingRuleConfusionPattern =
    sw.length >= 8 &&
    rep.length >= 8 &&
    swErrRate > repErrRate + 0.2 &&
    swErrRate > 0.25;
  return {
    trialsCompleted: events.length,
    switchTrials: sw.length,
    repeatTrials: rep.length,
    switchRtCostMs: cost,
    switchErrors: swErr,
    correctTrials: correct,
    responseTrials: events.length,
    trialsAtCurrentDifficulty: opts?.trialsAtCurrentDifficulty ?? events.length,
    taskSwitchingRuleConfusionPattern,
  };
}

export function buildTimeEstimationCheckpoint(args: {
  meanAbsErr: number | null;
  variability: number | null;
  trialsCompleted: number;
  distractorUsed: boolean;
  minPerCell: number;
  signedBiasMs?: number | null;
  cvAbsoluteError?: number | null;
  immediateReproduction?: boolean;
  misunderstandingFlag?: boolean;
  adjacentSwapInPlan?: boolean;
  /** Reproductions within ±1 s of target (practice/main UI tolerance). */
  correctTrials?: number;
  responseTrials?: number;
}): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: args.trialsCompleted,
    meanAbsoluteErrorMs: args.meanAbsErr,
    timingVariabilityMs: args.variability,
    timeEstimationDistractorUsed: args.distractorUsed,
    timeEstimationMinTrialsPerCell: args.minPerCell,
    timeEstimationSignedBiasMs: args.signedBiasMs ?? undefined,
    timeEstimationCvAbsoluteError: args.cvAbsoluteError ?? undefined,
    timeEstimationImmediateReproductionFlag: args.immediateReproduction ?? undefined,
    timeEstimationMisunderstandingFlag: args.misunderstandingFlag ?? undefined,
    timeEstimationAdjacentSwapInPlan: args.adjacentSwapInPlan ?? undefined,
    correctTrials: args.correctTrials,
    responseTrials: args.responseTrials,
  };
}

function timeEstReproCondition(e: Record<string, unknown>): "clean" | "distractor" {
  const ex = e.extra_data as Record<string, unknown> | undefined;
  return ex?.condition === "distractor" ? "distractor" : "clean";
}

function sampleStdDev(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

/** Min reproduction count across observed duration (× condition when distractor is used). */
function minTimeEstimationCellCount(
  rep: Record<string, unknown>[],
  distractorPlanned: boolean,
): number {
  if (rep.length === 0) return 0;
  const cellKeys = new Set<string>();
  for (const e of rep) {
    const d = e.isi_ms as number;
    if (!d) continue;
    cellKeys.add(distractorPlanned ? `${d}:${timeEstReproCondition(e)}` : String(d));
  }
  if (cellKeys.size === 0) return 0;
  let minC = Number.POSITIVE_INFINITY;
  for (const key of cellKeys) {
    const sep = key.indexOf(":");
    const d = Number(distractorPlanned && sep >= 0 ? key.slice(0, sep) : key);
    const cond = distractorPlanned && sep >= 0 ? (key.slice(sep + 1) as "clean" | "distractor") : null;
    const c = rep.filter((e) => {
      if ((e.isi_ms as number) !== d) return false;
      if (cond) return timeEstReproCondition(e) === cond;
      return true;
    }).length;
    minC = Math.min(minC, c);
  }
  return Number.isFinite(minC) ? minC : 0;
}

export type BuildTimeEstimationCheckpointOpts = {
  /** Session includes distractor half — gates min cells across duration×condition. */
  distractorPlanned: boolean;
  /** Schedule builder had to swap cells to avoid same target back-to-back. */
  adjacentDurationSwapInPlan?: boolean;
};

export function buildDelayDiscountingCheckpoint(args: {
  trialsCompleted: number;
  indifferencePoint: number | null;
  consistencyScore: number | null;
  minCellTrials: number | null;
  immediateChoiceRate?: number | null;
  fastChoiceRate?: number | null;
  dominantSideShare?: number | null;
  nowVsLaterMisunderstanding?: boolean;
  substanceDdDistressReported?: boolean;
}): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: args.trialsCompleted,
    indifferencePoint: args.indifferencePoint,
    consistencyScore: args.consistencyScore,
    delayDiscountingMinCellTrials: args.minCellTrials ?? undefined,
    delayDiscountingImmediateChoiceRate: args.immediateChoiceRate ?? undefined,
    delayDiscountingFastChoiceRate: args.fastChoiceRate ?? undefined,
    delayDiscountingDominantSideShare: args.dominantSideShare ?? undefined,
    delayDiscountingNowVsLaterMisunderstandingFlag: args.nowVsLaterMisunderstanding ?? undefined,
    ...(args.substanceDdDistressReported === true ? { substanceDdDistressReported: true } : {}),
  };
}

export function buildSetShiftingCheckpoint(args: {
  mainTrialsDone: number;
  ruleShiftsWithCriterion: number;
  perseverationEstablished: boolean;
  ruleBlockEnded: boolean;
  switchAccuracy?: number | null;
  trialsToCriterionByPhase?: number[];
  firstCriterionCompleted?: boolean;
  randomRespondingFlag?: boolean;
  maxTrialsWithoutCriterion?: boolean;
  perseverationSwitchErrors?: number;
  correctTrials?: number;
  responseTrials?: number;
}): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: args.mainTrialsDone,
    ruleShiftsWithCriterion: args.ruleShiftsWithCriterion,
    perseverationEstablished: args.perseverationEstablished,
    setShiftingRuleBlockEnded: args.ruleBlockEnded,
    setShiftingSwitchAccuracy: args.switchAccuracy ?? undefined,
    setShiftingTrialsToCriterionByPhase: args.trialsToCriterionByPhase ?? undefined,
    setShiftingFirstCriterionCompleted: args.firstCriterionCompleted ?? undefined,
    setShiftingRandomRespondingFlag: args.randomRespondingFlag ?? undefined,
    setShiftingMaxTrialsWithoutCriterion: args.maxTrialsWithoutCriterion ?? undefined,
    setShiftingPerseverationSwitchErrors: args.perseverationSwitchErrors ?? undefined,
    ...(args.correctTrials != null ? { correctTrials: args.correctTrials } : {}),
    ...(args.responseTrials != null ? { responseTrials: args.responseTrials } : {}),
  };
}

export function buildDigitSpanCheckpoint(args: {
  sequencesCompleted: number;
  spanBatteryComplete: boolean;
  ladderPhase?: "forward" | "backward";
  currentSpan?: number;
  startingSpan?: number;
  sequencesBudgetUsed?: number;
  maxSequences?: number;
  digitSpanEarlyResponseFlag?: boolean;
  digitSpanRepeatedInvalidInput?: boolean;
  digitSpanFloorAfterPractice?: boolean;
  digitSpanFailedStartingSpan?: boolean;
  digitSpanBatteryStopReason?: "backward_discontinue" | "backward_span_ceiling" | "sequence_budget";
  /** Running main-task accuracy for debug / CAT */
  correctTrials?: number;
  responseTrials?: number;
}): MainAdaptiveCheckpointData {
  const n = args.sequencesCompleted;
  const correct = args.correctTrials;
  const resp = args.responseTrials ?? n;
  return {
    trialsCompleted: n,
    spanOrLoadCheckpoint: true,
    spanBatteryComplete: args.spanBatteryComplete,
    digitSpanLadderPhase: args.ladderPhase,
    digitSpanCurrentSpan: args.currentSpan,
    digitSpanStartingSpan: args.startingSpan,
    digitSpanSequencesBudgetUsed: args.sequencesBudgetUsed,
    digitSpanMaxSequences: args.maxSequences,
    digitSpanEarlyResponseFlag: args.digitSpanEarlyResponseFlag,
    digitSpanRepeatedInvalidInput: args.digitSpanRepeatedInvalidInput,
    digitSpanFloorAfterPractice: args.digitSpanFloorAfterPractice,
    digitSpanFailedStartingSpan: args.digitSpanFailedStartingSpan,
    digitSpanBatteryStopReason: args.digitSpanBatteryStopReason,
    ...(correct != null ? { correctTrials: correct } : {}),
    ...(resp != null ? { responseTrials: resp } : {}),
  };
}

export function buildWmDistractionCheckpoint(args: {
  sequencesCompleted: number;
  wmBatteryComplete: boolean;
  wmMaxCleanLoad?: number | null;
  wmMaxDistractedLoad?: number | null;
  wmDistractorCost?: number | null;
  wmTrialsClean?: number;
  wmTrialsDistracted?: number;
  wmMinTrialsPerConditionMet?: boolean;
  wmEarlyInputFlag?: boolean;
  wmDistractorUnderstandingFlag?: boolean;
  wmFloorAfterPracticeFlag?: boolean;
  wmInconsistentAtMax?: boolean;
}): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: args.sequencesCompleted,
    spanOrLoadCheckpoint: true,
    wmBatteryComplete: args.wmBatteryComplete,
    wmMaxCleanLoad: args.wmMaxCleanLoad ?? undefined,
    wmMaxDistractedLoad: args.wmMaxDistractedLoad ?? undefined,
    wmDistractorCost: args.wmDistractorCost ?? undefined,
    wmTrialsClean: args.wmTrialsClean,
    wmTrialsDistracted: args.wmTrialsDistracted,
    wmMinTrialsPerConditionMet: args.wmMinTrialsPerConditionMet,
    wmEarlyInputFlag: args.wmEarlyInputFlag,
    wmDistractorUnderstandingFlag: args.wmDistractorUnderstandingFlag,
    wmFloorAfterPracticeFlag: args.wmFloorAfterPracticeFlag,
    wmInconsistentAtMax: args.wmInconsistentAtMax,
  };
}

const DD_FAST_RT_MS = 400;

/** Client-side staircase summary for delay-discounting adaptive checkpoints (main block only). */
export function computeDelayDiscountingCheckpointFields(events: Record<string, unknown>[]): {
  trialsCompleted: number;
  indifferencePoint: number | null;
  consistencyScore: number | null;
  minCellTrials: number | null;
  immediateChoiceRate: number | null;
  fastChoiceRate: number | null;
  dominantSideShare: number | null;
  nowVsLaterMisunderstanding: boolean;
  distressReported: boolean;
} {
  const mainOnly = events.filter((e) => {
    const ex = e.extra_data as Record<string, unknown> | undefined;
    return ex?.is_practice !== true;
  });
  const scoredEvents = mainOnly.length > 0 ? mainOnly : events;
  const n = scoredEvents.length;
  if (n === 0) {
    return {
      trialsCompleted: 0,
      indifferencePoint: null,
      consistencyScore: null,
      minCellTrials: null,
      immediateChoiceRate: null,
      fastChoiceRate: null,
      dominantSideShare: null,
      nowVsLaterMisunderstanding: false,
      distressReported: false,
    };
  }

  const amounts: number[] = [];
  let imm = 0;
  let del = 0;
  let fast = 0;
  let left = 0;
  let right = 0;

  for (const e of scoredEvents) {
    const ex = e.extra_data as Record<string, unknown> | undefined;
    const rt = e.reaction_time_ms as number | undefined;
    if (typeof rt === "number" && rt < DD_FAST_RT_MS) fast += 1;
    const ci = ex?.chose_immediate;
    if (ci === true) imm += 1;
    else if (ci === false) del += 1;
    const amt = ex?.immediate_amount;
    if (typeof amt === "number") amounts.push(amt);
    const rk = e.response_key as string | undefined;
    if (rk === "ArrowLeft") left += 1;
    else if (rk === "ArrowRight") right += 1;
  }

  const tail = amounts.slice(-Math.min(6, amounts.length));
  const indifferencePoint =
    tail.length > 0
      ? tail.reduce((a, b) => a + b, 0) / tail.length
      : (() => {
          const lastExtra = scoredEvents[n - 1]?.extra_data as Record<string, unknown> | undefined;
          return typeof lastExtra?.immediate_amount === "number"
            ? (lastExtra.immediate_amount as number)
            : null;
        })();

  const distressReported = scoredEvents.some((e) => {
    const ex = e.extra_data as Record<string, unknown> | undefined;
    return ex?.distress_flag === true || ex?.user_reported_distress === true;
  });

  let changes = 0;
  for (let i = 1; i < n; i += 1) {
    const a = (scoredEvents[i - 1]?.extra_data as Record<string, unknown> | undefined)?.chose_immediate;
    const b = (scoredEvents[i]?.extra_data as Record<string, unknown> | undefined)?.chose_immediate;
    if (typeof a === "boolean" && typeof b === "boolean" && a !== b) changes += 1;
  }
  const consistencyScore = n > 1 ? Math.max(0, Math.min(1, 1 - changes / (n - 1))) : null;

  const scored = imm + del;
  const immediateChoiceRate = scored > 0 ? imm / scored : null;
  const fastChoiceRate = n > 0 ? fast / n : null;
  const totalSides = left + right;
  const dominantSideShare = totalSides > 0 ? Math.max(left, right) / totalSides : null;

  const nowVsLaterMisunderstanding =
    n >= 10 &&
    consistencyScore != null &&
    consistencyScore < 0.55 &&
    immediateChoiceRate != null &&
    (immediateChoiceRate > 0.92 || immediateChoiceRate < 0.08);

  return {
    trialsCompleted: n,
    indifferencePoint,
    consistencyScore,
    minCellTrials: scored > 0 ? Math.min(imm, del) : null,
    immediateChoiceRate,
    fastChoiceRate,
    dominantSideShare,
    nowVsLaterMisunderstanding,
    distressReported,
  };
}

/** Aggregate reproduction-phase timing for time-estimation adaptive checkpoints. */
export function buildTimeEstimationCheckpointFromEvents(
  events: Record<string, unknown>[],
  opts?: BuildTimeEstimationCheckpointOpts,
): MainAdaptiveCheckpointData {
  const distractorPlanned = opts?.distractorPlanned === true;
  const rep = events.filter(
    (e) =>
      e.event_type === "reproduction" &&
      typeof e.reaction_time_ms === "number" &&
      typeof e.isi_ms === "number",
  );
  const reproCount = rep.length;
  const errs = rep.map((e) =>
    Math.abs((e.reaction_time_ms as number) - (e.isi_ms as number)),
  );
  const signed = rep.map((e) => (e.reaction_time_ms as number) - (e.isi_ms as number));
  const meanAbsErr = errs.length > 0 ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
  const signedBiasMs = signed.length > 0 ? signed.reduce((a, b) => a + b, 0) / signed.length : null;
  const med = median(errs);
  const mad = med != null ? medianAbsoluteDeviation(errs, med) : null;
  const stdAbs = sampleStdDev(errs);
  const cvAbsoluteError =
    stdAbs != null && meanAbsErr != null && meanAbsErr > 1e-6 ? stdAbs / meanAbsErr : null;

  const minPerCell = minTimeEstimationCellCount(rep, distractorPlanned);

  const immediateReproduction = rep.some((e) => {
    const rt = e.reaction_time_ms as number;
    const isi = e.isi_ms as number;
    return rt < Math.max(300, 0.08 * isi);
  });

  const meanTargetMs =
    rep.length > 0 ? rep.reduce((a, e) => a + (e.isi_ms as number), 0) / rep.length : 0;
  const misunderstandingFlag =
    rep.length >= 6 &&
    meanAbsErr != null &&
    meanTargetMs > 0 &&
    (meanAbsErr > 0.55 * meanTargetMs ||
      (signedBiasMs != null && Math.abs(signedBiasMs) > 0.35 * meanTargetMs));

  const scorable = rep.filter((e) => typeof e.is_correct === "boolean");
  const withinTol = scorable.filter((e) => e.is_correct === true).length;

  return buildTimeEstimationCheckpoint({
    meanAbsErr,
    variability: mad,
    trialsCompleted: reproCount,
    distractorUsed: distractorPlanned,
    minPerCell,
    signedBiasMs,
    cvAbsoluteError,
    immediateReproduction,
    misunderstandingFlag,
    adjacentSwapInPlan: opts?.adjacentDurationSwapInPlan === true,
    correctTrials: scorable.length > 0 ? withinTol : undefined,
    responseTrials: scorable.length > 0 ? scorable.length : reproCount > 0 ? reproCount : undefined,
  });
}
