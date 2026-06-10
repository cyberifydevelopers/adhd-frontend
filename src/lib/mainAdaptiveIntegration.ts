import { catStore } from "@/stores/catStore";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { stashMainAdaptiveDebugAfterRecord } from "@/lib/mainAdaptiveDebugSnapshot";
import { mainAdaptiveDebugStore } from "@/stores/mainAdaptiveDebugStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import {
  createAdaptiveHistory,
  evaluateMainAdaptiveCheckpoint,
  isMainAdaptiveEvaluationPoint,
  resolveSessionAdaptivePolicy,
  type AdaptiveHistory,
  type AdaptiveMode,
  type MainAdaptiveCheckpointData,
  type MainAdaptiveEvaluationOutput,
  type MainAdaptiveSessionBounds,
} from "@/lib/mainAdaptiveEngine";

/** Align with CAT diagnostic norms (tighter CI than screening) */
export const MAIN_ADAPTIVE_DEFAULT_MODE: AdaptiveMode = "diagnostic";

export function resetMainAdaptiveHistory(): AdaptiveHistory {
  return createAdaptiveHistory();
}

/** CAT session task config bounds when loaded for the active task. */
export function getSessionAdaptiveBounds(
  taskKey: MainAdaptiveTrialTaskKey,
  sessionMaxTrials?: number,
): MainAdaptiveSessionBounds {
  const tc = catStore.getState().taskConfig;
  const fromConfig =
    tc?.task_name === taskKey
      ? { sessionMinTrials: tc.min_trials, sessionMaxTrials: tc.max_trials }
      : {};
  return {
    ...fromConfig,
    ...(sessionMaxTrials != null ? { sessionMaxTrials } : {}),
  };
}

/**
 * Run main adaptive engine when the checkpoint is on-spec; updates rolling history.
 * Sets CAT block-end trigger when stopping criteria met (early or max burden).
 */
function evaluationToSnapshot(
  out: MainAdaptiveEvaluationOutput,
): Omit<MainAdaptiveEvaluationOutput, "history"> {
  const { history: _h, ...rest } = out;
  return rest;
}

export type MainAdaptiveStopResult = {
  history: AdaptiveHistory;
  /** Present when `isMainAdaptiveEvaluationPoint` was true for this trial */
  evaluation: MainAdaptiveEvaluationOutput | null;
};

export function tryMainAdaptiveStop(
  taskKey: MainAdaptiveTrialTaskKey,
  checkpoint: MainAdaptiveCheckpointData,
  history: AdaptiveHistory,
  sessionBounds?: number | MainAdaptiveSessionBounds,
  mode: AdaptiveMode = MAIN_ADAPTIVE_DEFAULT_MODE,
): MainAdaptiveStopResult {
  const bounds: MainAdaptiveSessionBounds =
    typeof sessionBounds === "number"
      ? getSessionAdaptiveBounds(taskKey, sessionBounds)
      : getSessionAdaptiveBounds(taskKey, sessionBounds?.sessionMaxTrials);
  if (typeof sessionBounds === "object" && sessionBounds?.sessionMinTrials != null) {
    bounds.sessionMinTrials = sessionBounds.sessionMinTrials;
  }
  const policy = resolveSessionAdaptivePolicy(taskKey, bounds);
  const effectiveMaxTrials = policy.maxTrials;

  const atPoint = isMainAdaptiveEvaluationPoint(taskKey, checkpoint, bounds);

  let nextHistory = history;
  let evaluation: MainAdaptiveEvaluationOutput | null = null;

  if (atPoint) {
    evaluation = evaluateMainAdaptiveCheckpoint({
      taskKey,
      mode,
      history,
      checkpoint,
      ...bounds,
    });
    nextHistory = evaluation.history;
    if (
      evaluation.decision === "stop_stable" ||
      evaluation.decision === "stop_max_low_confidence"
    ) {
      /** Always latch spec stop — spurious earlier triggers (e.g. practice-style CI flags) must not block this. */
      catStore.getState().setBlockEndTrigger("main_adaptive_stop");
    }
  }

  mainAdaptiveDebugStore.getState().record({
    taskKey,
    mode,
    sessionMaxTrials: bounds.sessionMaxTrials,
    effectiveMaxTrials,
    policy,
    checkpoint,
    atEvaluationPoint: atPoint,
    evaluation: evaluation ? evaluationToSnapshot(evaluation) : null,
    returnedHistory: nextHistory,
  });
  stashMainAdaptiveDebugAfterRecord(taskKey);

  taskPauseStore.getState().maybeAnnounceMinCheckpointMilestone(taskKey, checkpoint, bounds);

  return { history: nextHistory, evaluation };
}
