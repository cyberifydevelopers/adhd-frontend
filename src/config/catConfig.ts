/** CAT per-trial config — used by catStore for threshold checks. */

export const CAT_CONFIG = {
  /** Number of trials to keep in rolling buffer for CI/SD calculations */
  trialBufferSize: 30,
  /** Min trials before any block-end trigger can fire */
  minTrialsBeforeTrigger: 20,
  /** CI width threshold — trigger when 95% CI < this (ms) */
  ciWidthThresholdMs: 25,
  /** Consecutive omissions to trigger lapse_streak */
  lapseStreakThreshold: 5,
  /** RT below this (ms) = anticipatory (spec: exclude RT &lt; 120 ms) */
  anticipatoryRtMs: 120,
  /** Anticipatory count to trigger */
  anticipatoryTriggerCount: 3,
  /** RT SD below this across buffer = random responding */
  randomRespondingSdMs: 20,
  /** Min trials for random responding check */
  randomRespondingMinTrials: 20,
} as const;

/* ------------------------------------------------------------------ */
/*  IRT-based CAT configuration                                        */
/* ------------------------------------------------------------------ */

export const IRT_CONFIG = {
  /** SE(theta) below this → stop (precision sufficient) */
  seThetaThreshold: 0.35,
  /** Safety floor: min trials before SE-based stopping can fire */
  minTrialsForIRTStopping: 15,
  /** Prior ability mean (standard normal) */
  priorMean: 0,
  /** Prior ability SD */
  priorSD: 1,
  /** Number of warmup trials using heuristic-only (before IRT item selection) */
  irtWarmupTrials: 5,
} as const;

/* ------------------------------------------------------------------ */
/*  Per-trial adaptive defaults (used by each task store)              */
/* ------------------------------------------------------------------ */

export const ADAPTIVE_DEFAULTS = {
  /** Sliding window size for PerformanceModel */
  windowSize: 15,
  /** Number of warmup trials generated with default params before adaptation kicks in */
  warmupTrials: 5,

  /** Simple RT scored block: random fixation 500–1500 ms (no adaptive foreperiod on main). */
  srt: {
    foreperiodMin: 500,
    foreperiodMax: 1500,
    catchTrialRate: 0,
  },

  flanker: {
    incongruentRatio: 0.5,
    foreperiodMin: 800,
    foreperiodMax: 2500,
  },

  taskSwitching: {
    switchRatio: 0.5,
    foreperiodMin: 800,
    foreperiodMax: 2500,
  },

  crt: {
    foreperiodMin: 800,
    foreperiodMax: 2500,
    directionWeights: { left: 1, right: 1, up: 1, down: 1 } as Record<string, number>,
  },

  cpt: {
    /** Spec MVP: fixed 20–25% target probability (use midpoint). */
    targetRatio: 0.225,
    isiMin: 1000,
    isiMax: 2000,
    responseWindow: 1500,
  },

  sst: {
    goRatio: 0.75,
    responseDeadline: 2000,
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Main-test adaptive trial bounds (evaluateMainAdaptiveCheckpoint)   */
/*  Edit here to change floors/ceilings; merged in mainAdaptiveEngine. */
/* ------------------------------------------------------------------ */

/** Per-task main-block min/max trial counts (`task_name` keys match backend CAT). */
export const MAIN_TASK_ADAPTIVE_TRIAL_LIMITS = {
  simple_rt: { minTrials: 25, maxTrials: 60 },
  choice_rt: { minTrials: 30, maxTrials: 80 },
  flanker: { minTrials: 40, maxTrials: 100 },
  sst: { minTrials: 120, maxTrials: 200 },
  cpt: { minTrials: 150, maxTrials: 360 },
  /** Forward/back span trials are counted in-task; counts are span-level rounds. */
  digit_span: { minTrials: 4, maxTrials: 24 },
  task_switching: { minTrials: 48, maxTrials: 120 },
  time_estimation: { minTrials: 12, maxTrials: 30 },
  delay_discounting: { minTrials: 12, maxTrials: 30 },
  set_shifting_mini: { minTrials: 20, maxTrials: 80 },
  substance_dd: { minTrials: 12, maxTrials: 30 },
  psychomotor_speed: { minTrials: 30, maxTrials: 80 },
  /** WM load × condition rounds; task enforces per-load rules. */
  wm_distraction: { minTrials: 4, maxTrials: 32 },
} as const;

export type MainAdaptiveTrialTaskKey = keyof typeof MAIN_TASK_ADAPTIVE_TRIAL_LIMITS;

/** Per-task main scored trial bounds (single source for stores + adaptive engine). */
export function getMainTrialLimits(taskKey: MainAdaptiveTrialTaskKey) {
  return MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[taskKey];
}

/** Default min/max maps for admin CAT config when no active row exists. */
export function buildSpecMinTrialsPerTask(): Record<MainAdaptiveTrialTaskKey, number> {
  return Object.fromEntries(
    (Object.keys(MAIN_TASK_ADAPTIVE_TRIAL_LIMITS) as MainAdaptiveTrialTaskKey[]).map((k) => [
      k,
      MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[k].minTrials,
    ]),
  ) as Record<MainAdaptiveTrialTaskKey, number>;
}

export function buildSpecMaxTrialsPerTask(): Record<MainAdaptiveTrialTaskKey, number> {
  return Object.fromEntries(
    (Object.keys(MAIN_TASK_ADAPTIVE_TRIAL_LIMITS) as MainAdaptiveTrialTaskKey[]).map((k) => [
      k,
      MAIN_TASK_ADAPTIVE_TRIAL_LIMITS[k].maxTrials,
    ]),
  ) as Record<MainAdaptiveTrialTaskKey, number>;
}

export function buildSpecPracticeConfigPerTask(): Record<
  string,
  {
    min_trials: number;
    max_trials: number;
    evaluation_interval: number;
    pass_threshold: number;
    continue_threshold: number;
    final_trial_count: number;
  }
> {
  const base = {
    min_trials: PRACTICE_CONFIG.minTrials,
    max_trials: PRACTICE_CONFIG.maxTrials,
    evaluation_interval: PRACTICE_CONFIG.evaluationInterval,
    pass_threshold: PRACTICE_CONFIG.passThreshold,
    continue_threshold: PRACTICE_CONFIG.continueThreshold,
    final_trial_count: PRACTICE_CONFIG.finalTrialCount,
  };
  return Object.fromEntries(
    (Object.keys(MAIN_TASK_ADAPTIVE_TRIAL_LIMITS) as MainAdaptiveTrialTaskKey[]).map((k) => [k, { ...base }]),
  );
}

/* ------------------------------------------------------------------ */
/*  Practice engine defaults                                           */
/* ------------------------------------------------------------------ */

export const PRACTICE_CONFIG = {
  /** Minimum trials before pass can be evaluated */
  minTrials: 5,
  /** Hard cap on practice trials */
  maxTrials: 20,
  /** How often (in trials) to evaluate progress */
  evaluationInterval: 5,
  /** Accuracy required to pass */
  passThreshold: 0.8,
  /** Accuracy below which triggers reinstructions */
  continueThreshold: 0.5,
  /** Number of final (no-feedback) trials */
  finalTrialCount: 0,
} as const;
