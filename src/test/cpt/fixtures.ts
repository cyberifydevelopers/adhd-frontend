import { buildCptCheckpoint } from "@/lib/mainAdaptiveBridge";
import {
  evaluateMainAdaptiveCheckpoint,
  type AdaptiveHistory,
  type MainAdaptiveCheckpointData,
  type MainAdaptiveEvaluationOutput,
} from "@/lib/mainAdaptiveEngine";

/** Spec CPT main block */
export const CPT_SPEC = {
  minTrials: 150,
  maxTrials: 360,
  checkpointEvery: 60,
  ciWidth: 0.08,
  targetRatio: 0.225,
  stimulusMs: 250,
  isiMin: 1000,
  isiMax: 2000,
  anticipatoryMs: 120,
} as const;

/** Rolling engine snapshots every 60 scored trials. */
export const CPT_CHECKPOINT_TRIALS = [60, 120, 180, 240, 300, 360] as const;

/** First trial count where stopping rules are evaluated (≥ min 150, on 60-boundary). */
export const CPT_FIRST_STOP_EVAL_TRIAL = 180;

/** Earliest trial count where zero-error Wilson CIs typically pass at 22.5% target rate. */
export const CPT_EARLIEST_PERFECT_STOP_TRIAL = 240;

export type CptEvent = Record<string, unknown>;

export type BuildCptEventsProfile = {
  /** Exact target trial count (default ~22.5% of total). */
  targetTrials?: number;
  /** Target trials with no response (omissions). */
  omissions?: number;
  /** Non-target trials with a response (commissions). */
  commissions?: number;
  /** Target RT (ms) for hits; default 500. */
  targetRtMs?: number;
  /** Extra slow target RTs (>2× median) to inflate lapse rate. */
  slowLapseCount?: number;
  /** Target RTs below anticipatory threshold. */
  anticipatoryCount?: number;
  /** Linear RT increase per target hit for vigilance slope (ms per trial index). */
  rtSlopePerTrial?: number;
  /** When true, spread targets through the block (~22.5%) instead of front-loading them. */
  interleaved?: boolean;
};

/**
 * Deterministic CPT event stream for pipeline tests (no RNG).
 * Trial order: all targets first, then non-targets, padded to `totalTrials`.
 */
export function buildDeterministicCptEvents(
  totalTrials: number,
  profile: BuildCptEventsProfile = {},
): CptEvent[] {
  const targetTrials =
    profile.targetTrials ?? Math.max(1, Math.round(totalTrials * CPT_SPEC.targetRatio));
  const nonTargetTrials = Math.max(0, totalTrials - targetTrials);
  const omissions = profile.omissions ?? 0;
  const commissions = profile.commissions ?? 0;
  const targetRtMs = profile.targetRtMs ?? 500;
  const slowLapseCount = profile.slowLapseCount ?? 0;
  const anticipatoryCount = profile.anticipatoryCount ?? 0;
  const rtSlope = profile.rtSlopePerTrial ?? 0;
  const interleaved = profile.interleaved === true;

  const events: CptEvent[] = [];
  let targetIdx = 0;

  const pushTarget = (i: number) => {
    if (i < omissions) {
      events.push({ event_type: "target", reaction_time_ms: null, is_correct: false });
      targetIdx += 1;
      return;
    }
    if (i < omissions + anticipatoryCount) {
      events.push({
        event_type: "target",
        reaction_time_ms: 80,
        is_correct: false,
      });
      targetIdx += 1;
      return;
    }
    if (i < omissions + anticipatoryCount + slowLapseCount) {
      events.push({
        event_type: "target",
        reaction_time_ms: targetRtMs * 3,
        is_correct: true,
      });
      targetIdx += 1;
      return;
    }
    const rt = targetRtMs + rtSlope * targetIdx;
    events.push({
      event_type: "target",
      reaction_time_ms: rt,
      is_correct: true,
    });
    targetIdx += 1;
  };

  if (interleaved) {
    const targetEvery = Math.max(1, Math.round(1 / CPT_SPEC.targetRatio));
    let targetsPlaced = 0;
    for (let t = 0; t < totalTrials; t += 1) {
      const placeTarget =
        targetsPlaced < targetTrials &&
        (t % targetEvery === 0 || targetsPlaced + (totalTrials - t) <= targetTrials);
      if (placeTarget) {
        pushTarget(targetsPlaced);
        targetsPlaced += 1;
      } else if (t - targetsPlaced < nonTargetTrials) {
        const j = t - targetsPlaced;
        if (j < commissions) {
          events.push({
            event_type: "nontarget",
            reaction_time_ms: 400,
            is_correct: false,
          });
        } else {
          events.push({
            event_type: "nontarget",
            reaction_time_ms: null,
            is_correct: true,
          });
        }
      }
    }
    return events;
  }

  for (let i = 0; i < targetTrials; i += 1) {
    pushTarget(i);
  }

  for (let j = 0; j < nonTargetTrials; j += 1) {
    if (j < commissions) {
      events.push({
        event_type: "nontarget",
        reaction_time_ms: 400,
        is_correct: false,
      });
    } else {
      events.push({
        event_type: "nontarget",
        reaction_time_ms: null,
        is_correct: true,
      });
    }
  }

  return events;
}

/** Manual checkpoint payload when not using `buildCptCheckpoint`. */
export function cptCheckpoint(
  trials: number,
  overrides: Partial<MainAdaptiveCheckpointData> = {},
): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: trials,
    omissions: 0,
    targetTrialsTotal: 40,
    commissions: 0,
    nonTargetTrialsTotal: 120,
    medianRtMs: 500,
    rtVariability: 50,
    cptLapseRate: 0,
    cptTimeOnTaskSlopeMsPerQuarter: 0,
    fatigueSlopeAnalysisActive: false,
    scoredDurationMinutes: 5,
    ...overrides,
  };
}

export function evaluateCptAtTrial(
  events: CptEvent[],
  trial: number,
  history: AdaptiveHistory,
): MainAdaptiveEvaluationOutput {
  const subset = events.slice(0, trial);
  const checkpoint = buildCptCheckpoint(subset, CPT_SPEC.maxTrials, 5);
  return evaluateMainAdaptiveCheckpoint({
    taskKey: "cpt",
    mode: "diagnostic",
    history,
    checkpoint,
    sessionMinTrials: CPT_SPEC.minTrials,
    sessionMaxTrials: CPT_SPEC.maxTrials,
  });
}
