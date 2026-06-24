/**
 * Adaptive practice engine — pure functions, zero latency.
 *
 * Each task store calls `recordPracticeTrial` after every practice response,
 * then calls `evaluatePracticeBlock` at evaluation intervals to decide
 * whether to continue, reinstrcut, start final trials, or proceed to main.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Keep practice trials mounted this long before clearing when transitioning to main, so per-trial feedback can show (aligned with FEEDBACK_SETTLE_MS in task components). */
export const PRACTICE_FEEDBACK_FINISH_DELAY_MS = 1600;

export type PracticeConfig = {
  /** Minimum trials before pass can be evaluated */
  minTrials: number;
  /** Hard cap on practice trials */
  maxTrials: number;
  /** How often (in trials) to evaluate progress */
  evaluationInterval: number;
  /** Accuracy required to pass */
  passThreshold: number;
  /** Accuracy below which triggers reinstructions */
  continueThreshold: number;
  /** Optional: number of extra "wrap-up" practice trials before main. */
  finalTrialCount: number;
};

export type PracticeSubPhase = "early" | "final" | "reinstructions";

export type PracticeReinstructionLevel = "additional" | "simplified";

export type PracticeEvent = {
  trialNumber: number;
  isCorrect: boolean;
  errorType: "correct" | "incorrect" | "premature" | "omission";
  reactionTimeMs: number | null;
  accuracyAtPoint: number;
  /** Rolling accuracy over last N trials (typically 5) at this point. */
  windowAccuracyAtPoint: number;
  subPhase: PracticeSubPhase;
};

export type PracticeState = {
  subPhase: PracticeSubPhase;
  totalTrialsCompleted: number;
  currentBlockCorrect: number;
  currentBlockTrials: number;
  overallCorrect: number;
  blocksCompleted: number;
  instructionRedisplays: number;
  passed: boolean;
  lowConfidence: boolean;
  /** Optional override to match required reporting enum. */
  practiceErrorPattern: string | null;
  consecutiveCorrectSequences: number;
  sstGoTrials: number;
  sstGoCorrect: number;
  sstStopTrials: number;
  sstStopSuccess: number;
  sstNeverStopped: boolean;
  sstAlwaysWaiting: boolean;
  events: PracticeEvent[];
};

export type PracticeEvaluation =
  | { action: "continue" }
  | { action: "reinstructions"; level: PracticeReinstructionLevel }
  | { action: "start_final" }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean };

export type SpanPracticeEvaluation =
  | { action: "continue" }
  | { action: "reinstructions"; level: "additional"; feedback: string; state: PracticeState }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean; state: PracticeState };

export type SSTPracticeEvaluation =
  | { action: "continue"; state: PracticeState }
  | { action: "reinstructions"; level: "additional"; hint: string; state: PracticeState }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean; state: PracticeState };

export type TimeEstimationPracticeEvaluation =
  | { action: "continue"; feedback?: string; state: PracticeState }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean; state: PracticeState; feedback?: string };

export type DelayDiscountingChoice = { side: "left" | "right"; reactionTimeMs: number };

export type DelayDiscountingPracticeEvaluation =
  | { action: "continue"; feedback?: string; state: PracticeState }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean; state: PracticeState; feedback?: string };

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Config comes from PRACTICE_CONFIG in catConfig.ts — single source of truth.
 */
export function createPracticeState(): PracticeState {
  return {
    subPhase: "early",
    totalTrialsCompleted: 0,
    currentBlockCorrect: 0,
    currentBlockTrials: 0,
    overallCorrect: 0,
    blocksCompleted: 0,
    instructionRedisplays: 0,
    passed: false,
    lowConfidence: false,
    practiceErrorPattern: null,
    consecutiveCorrectSequences: 0,
    sstGoTrials: 0,
    sstGoCorrect: 0,
    sstStopTrials: 0,
    sstStopSuccess: 0,
    sstNeverStopped: false,
    sstAlwaysWaiting: false,
    events: [],
  };
}

/* ------------------------------------------------------------------ */
/*  Record a single trial (pure, returns new state)                    */
/* ------------------------------------------------------------------ */

export function recordPracticeTrial(
  state: PracticeState,
  result: { isCorrect: boolean; errorType: PracticeEvent["errorType"]; reactionTimeMs: number | null },
): PracticeState {
  const next: PracticeState = { ...state };
  next.totalTrialsCompleted = state.totalTrialsCompleted + 1;
  next.currentBlockTrials = state.currentBlockTrials + 1;
  if (result.isCorrect) {
    next.overallCorrect = state.overallCorrect + 1;
    next.currentBlockCorrect = state.currentBlockCorrect + 1;
  }

  const accuracy = next.totalTrialsCompleted > 0
    ? next.overallCorrect / next.totalTrialsCompleted
    : 0;

  const windowSize = 5;
  const recent = [
    ...state.events.slice(-(windowSize - 1)),
    { isCorrect: result.isCorrect } as Pick<PracticeEvent, "isCorrect">,
  ];
  const windowCorrect = recent.filter((e) => e.isCorrect).length;
  const windowAccuracy = windowSize > 0 ? windowCorrect / windowSize : 0;

  const event: PracticeEvent = {
    trialNumber: next.totalTrialsCompleted,
    isCorrect: result.isCorrect,
    errorType: result.errorType,
    reactionTimeMs: result.reactionTimeMs,
    accuracyAtPoint: accuracy,
    windowAccuracyAtPoint: windowAccuracy,
    subPhase: state.subPhase,
  };

  next.events = [...state.events, event];
  return next;
}

/* ------------------------------------------------------------------ */
/*  Evaluate at block boundary (every evaluationInterval trials)       */
/* ------------------------------------------------------------------ */

export function evaluatePracticeBlock(
  state: PracticeState,
  config: PracticeConfig,
): PracticeEvaluation {
  const { totalTrialsCompleted } = state;
  const windowN = Math.max(1, config.evaluationInterval);
  const lastN = state.events.slice(-windowN);
  const windowAccuracy =
    lastN.length > 0 ? lastN.filter((e) => e.isCorrect).length / lastN.length : 0;

  if (totalTrialsCompleted >= config.maxTrials) {
    const overallAccuracy = totalTrialsCompleted > 0 ? state.overallCorrect / totalTrialsCompleted : 0;
    if (overallAccuracy < config.continueThreshold || state.overallCorrect === 0) {
      return { action: "reinstructions", level: "simplified" };
    }
    return {
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
    };
  }

  // If configured, allow a short wrap-up segment before starting main.
  if (state.subPhase === "final") {
    if (state.currentBlockTrials >= config.finalTrialCount) {
      return { action: "proceed_to_main", passed: true, lowConfidence: false };
    }
    return { action: "continue" };
  }

  // Pass gate: accuracy over the *last N trials* (typically last 5).
  if (totalTrialsCompleted >= config.minTrials && lastN.length >= windowN && windowAccuracy >= config.passThreshold) {
    return { action: "proceed_to_main", passed: true, lowConfidence: false };
  }

  // Never reinstruct before minimum practice exposure is reached.
  if (totalTrialsCompleted < config.minTrials) return { action: "continue" };

  // Evaluate continue/reinstruction only at checkpoints (default every 5 trials).
  if (totalTrialsCompleted < config.evaluationInterval) return { action: "continue" };
  if (totalTrialsCompleted % config.evaluationInterval !== 0) return { action: "continue" };

  // At checkpoints: 50–79% => additional instruction; <50% => simplified instruction.
  if (windowAccuracy >= config.continueThreshold) {
    return { action: "reinstructions", level: "additional" };
  }
  return { action: "reinstructions", level: "simplified" };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** True during all practice sub-phases (per-trial feedback shown) */
export function shouldShowFeedback(state: PracticeState): boolean {
  return (
    state.subPhase === "early"
    || state.subPhase === "final"
    || state.subPhase === "reinstructions"
  );
}

/** Overall practice accuracy (0–1) */
export function getPracticeAccuracy(state: PracticeState): number {
  return state.totalTrialsCompleted > 0
    ? state.overallCorrect / state.totalTrialsCompleted
    : 0;
}

/** Metadata for posting to backend after practice */
export function getPracticeMetadata(state: PracticeState): {
  practice_passed: boolean;
  practice_accuracy: number;
  low_confidence_flag: boolean;
  total_practice_trials: number;
  practice_blocks_completed: number;
  practice_error_pattern: string | null;
} {
  return {
    practice_passed: state.passed,
    practice_accuracy: getPracticeAccuracy(state),
    low_confidence_flag: state.lowConfidence,
    total_practice_trials: state.totalTrialsCompleted,
    practice_blocks_completed: state.blocksCompleted,
    practice_error_pattern: state.practiceErrorPattern,
  };
}

export function computeLastNAccuracy(state: PracticeState, n = 5): number {
  const windowN = Math.max(1, Math.floor(n));
  const last = state.events.slice(-windowN);
  if (last.length === 0) return 0;
  const correct = last.filter((e) => e.isCorrect).length;
  return correct / last.length;
}

export function recordSpanTrial(
  state: PracticeState,
  result: { isCorrect: boolean; errorType: PracticeEvent["errorType"]; reactionTimeMs: number | null },
): PracticeState {
  const updated = recordPracticeTrial(state, result);
  return {
    ...updated,
    consecutiveCorrectSequences: result.isCorrect ? state.consecutiveCorrectSequences + 1 : 0,
  };
}

export function evaluateSpanPractice(
  state: PracticeState,
  config: PracticeConfig,
  feedback = "The correct sequence was X - X - X",
): SpanPracticeEvaluation {
  if (state.consecutiveCorrectSequences >= 2) {
    return {
      action: "proceed_to_main",
      passed: true,
      lowConfidence: false,
      state,
    };
  }

  if (state.totalTrialsCompleted >= config.maxTrials) {
    return {
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
      state: { ...state, practiceErrorPattern: "span_failure" },
    };
  }

  return {
    action: "reinstructions",
    level: "additional",
    feedback,
    state,
  };
}

export function recordSSTTrial(
  state: PracticeState,
  trialType: "go" | "stop",
  result: { isCorrect: boolean; errorType: PracticeEvent["errorType"]; reactionTimeMs: number | null },
): PracticeState {
  const updated = recordPracticeTrial(state, result);
  const goTrials = trialType === "go" ? state.sstGoTrials + 1 : state.sstGoTrials;
  const goCorrect = trialType === "go" && result.isCorrect ? state.sstGoCorrect + 1 : state.sstGoCorrect;
  const stopTrials = trialType === "stop" ? state.sstStopTrials + 1 : state.sstStopTrials;
  const stopSuccess = trialType === "stop" && result.isCorrect ? state.sstStopSuccess + 1 : state.sstStopSuccess;
  return {
    ...updated,
    sstGoTrials: goTrials,
    sstGoCorrect: goCorrect,
    sstStopTrials: stopTrials,
    sstStopSuccess: stopSuccess,
    sstNeverStopped: stopTrials > 0 && stopSuccess === 0,
    sstAlwaysWaiting: goTrials > 0 && goCorrect === 0,
  };
}

export function evaluateSSTBlock(state: PracticeState, config: PracticeConfig): SSTPracticeEvaluation {
  if (state.totalTrialsCompleted >= config.maxTrials) {
    const goAccuracy = state.sstGoTrials > 0 ? state.sstGoCorrect / state.sstGoTrials : 0;
    if (goAccuracy < config.continueThreshold || state.sstGoCorrect === 0) {
      return {
        action: "reinstructions",
        level: "additional",
        hint: "Respond quickly on GO trials, and stop when you see the stop signal",
        state: { ...state, practiceErrorPattern: "accuracy_low" },
      };
    }
    return {
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
      state: { ...state, practiceErrorPattern: "accuracy_low" },
    };
  }

  if (state.sstNeverStopped) {
    return {
      action: "reinstructions",
      level: "additional",
      hint: "Remember to stop when you see the stop signal",
      state,
    };
  }

  if (state.sstAlwaysWaiting) {
    return {
      action: "reinstructions",
      level: "additional",
      hint: "Respond quickly on GO trials, only stop when you see the stop signal",
      state,
    };
  }

  const goAccuracy = state.sstGoTrials > 0 ? state.sstGoCorrect / state.sstGoTrials : 0;
  const pass = goAccuracy >= 0.8 && state.sstStopSuccess >= 1;
  if (pass) {
    return {
      action: "proceed_to_main",
      passed: true,
      lowConfidence: false,
      state,
    };
  }

  return { action: "continue", state };
}

export function evaluateTimeEstimationPractice(
  state: PracticeState,
  responseTimes: number[],
  config: PracticeConfig,
): TimeEstimationPracticeEvaluation {
  const validTimes = responseTimes.filter((t) => Number.isFinite(t) && t >= 0);
  const immediateCount = validTimes.filter((t) => t <= 200).length;
  const immediateRate = validTimes.length > 0 ? immediateCount / validTimes.length : 0;

  const mean = validTimes.length > 0 ? validTimes.reduce((sum, t) => sum + t, 0) / validTimes.length : 0;
  const variance = validTimes.length > 1
    ? validTimes.reduce((sum, t) => sum + (t - mean) ** 2, 0) / validTimes.length
    : 0;
  const stdDev = Math.sqrt(variance);
  const cov = mean > 0 ? stdDev / mean : 0;
  const flagged = immediateRate > 0.5 || cov > 1.0;

  if (flagged) {
    const nextState = { ...state, practiceErrorPattern: "timing_misunderstanding" };
    if (state.totalTrialsCompleted >= config.maxTrials) {
      return {
        action: "proceed_to_main",
        passed: false,
        lowConfidence: true,
        feedback: "Try to press the button when you think the requested amount of time has passed.",
        state: nextState,
      };
    }
    return {
      action: "continue",
      feedback: "Try to press the button when you think the requested amount of time has passed.",
      state: nextState,
    };
  }

  if (state.totalTrialsCompleted >= config.minTrials) {
    return { action: "proceed_to_main", passed: true, lowConfidence: false, state };
  }
  return { action: "continue", state };
}

export function evaluateDelayDiscountingPractice(
  state: PracticeState,
  choices: DelayDiscountingChoice[],
  config: PracticeConfig,
): DelayDiscountingPracticeEvaluation {
  const valid = choices.filter((c) => Number.isFinite(c.reactionTimeMs) && c.reactionTimeMs >= 0);
  const sides = valid.map((c) => c.side);

  const alternating = sides.length > 1
    ? sides.slice(1).every((side, idx) => side !== sides[idx])
    : false;
  const fastRate = valid.length > 0
    ? valid.filter((c) => c.reactionTimeMs < 300).length / valid.length
    : 0;
  const sideBias = sides.length > 0 && sides.every((side) => side === sides[0]);
  const flagged = alternating || fastRate > 0.7 || sideBias;

  if (flagged) {
    const nextState = { ...state, practiceErrorPattern: "random_responding" };
    if (state.totalTrialsCompleted >= config.maxTrials) {
      return {
        action: "proceed_to_main",
        passed: false,
        lowConfidence: true,
        feedback: "You are choosing between a smaller reward now or a larger reward later.",
        state: nextState,
      };
    }
    return {
      action: "continue",
      feedback: "You are choosing between a smaller reward now or a larger reward later.",
      state: nextState,
    };
  }

  if (state.totalTrialsCompleted >= config.minTrials) {
    return { action: "proceed_to_main", passed: true, lowConfidence: false, state };
  }

  return { action: "continue", state };
}

export type WMDistractionEvaluation =
  | { action: "continue"; state: PracticeState }
  | { action: "proceed_to_main"; passed: boolean; lowConfidence: boolean; state: PracticeState };

export function evaluateWMDistraction(
  state: PracticeState,
  config: PracticeConfig,
): WMDistractionEvaluation {
  const accEval = evaluatePracticeBlock(state, config);
  const spanEval = evaluateSpanPractice(state, config);

  const accuracyPass = accEval.action === "proceed_to_main" && accEval.passed;
  const spanPass = spanEval.action === "proceed_to_main" && spanEval.passed;

  if (accuracyPass && spanPass) {
    return {
      action: "proceed_to_main",
      passed: true,
      lowConfidence: false,
      state,
    };
  }

  if (state.totalTrialsCompleted >= config.maxTrials) {
    const pattern = !spanPass ? "span_failure" : "accuracy_low";
    return {
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
      state: { ...state, practiceErrorPattern: pattern },
    };
  }

  return { action: "continue", state };
}
