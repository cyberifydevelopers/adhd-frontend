import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import {
  createPerformanceModel,
  updatePerformanceModel,
  clamp,
  type PerformanceModel,
} from "@/lib/adaptiveEngine";
import { ADAPTIVE_DEFAULTS, getMainTrialLimits, IRT_CONFIG, PRACTICE_CONFIG } from "@/config/catConfig";
import {
  createIRTState,
  updateIRTState,
  selectNextItem,
  type IRTState,
  type IRTItem,
} from "@/lib/irtEngine";
import { CPT_ITEM_BANK } from "@/lib/itemBanks";
import { scoreCPT } from "@/lib/irtScoring";
import {
  createPracticeState,
  recordPracticeTrial,
  evaluatePracticeBlock,
  shouldShowFeedback,
  getPracticeMetadata,
  PRACTICE_FEEDBACK_FINISH_DELAY_MS,
  type PracticeReinstructionLevel,
  type PracticeState,
  type PracticeConfig,
  type PracticeEvent,
} from "@/lib/practiceEngine";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { getSessionAdaptiveBounds, resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildCptCheckpoint } from "@/lib/mainAdaptiveBridge";
import { scheduleCptBlockEndCompletion } from "@/lib/cptBlockEnd";
import { isTaskPaused } from "@/lib/taskPauseGuard";

const TARGET_LETTER = "X";
const NON_TARGET_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWYZ".split("");
const MAIN_LIMITS = getMainTrialLimits("cpt");
const MAIN_BLOCK_SIZE = MAIN_LIMITS.maxTrials;
const EXTENSION_BLOCK_SIZE = 25;
const FATIGUE_SLOPE_THRESHOLD_MS = 5;
/** Spec MVP: stimulus duration 250 ms (fixed block). */
const CPT_STIMULUS_MS = 250;
/**
 * When false (MVP): fixed target probability / ISI / response window from config; no `adaptCPT`; no IRT-shaped trials.
 * When true: restores adaptive difficulty + IRT item bank after warmup (optional extended / fatigue-style analyses).
 */
const CPT_EXTENDED_MODE = false;
const WARMUP_TRIALS = ADAPTIVE_DEFAULTS.warmupTrials;

function computeCptMetrics(
  events: Record<string, unknown>[],
  irtState?: IRTState,
): Record<string, unknown> {
  const targets = events.filter((e) => e.event_type === "target");
  const nonTargets = events.filter((e) => e.event_type === "nontarget");
  const omissions = targets.filter((e) => e.reaction_time_ms == null);
  const commissions = nonTargets.filter((e) => e.reaction_time_ms != null);
  const targetRTs = targets
    .map((e) => e.reaction_time_ms as number | null)
    .filter((rt): rt is number => rt != null);
  const mean = targetRTs.length > 0 ? targetRTs.reduce((a, b) => a + b, 0) / targetRTs.length : 0;
  const sd = targetRTs.length > 1
    ? Math.sqrt(targetRTs.reduce((a, b) => a + (b - mean) ** 2, 0) / (targetRTs.length - 1))
    : 0;
  return {
    omission_rate: targets.length > 0 ? omissions.length / targets.length : 0,
    commission_rate: nonTargets.length > 0 ? commissions.length / nonTargets.length : 0,
    median_rt: targetRTs.length > 0 ? targetRTs.sort((a, b) => a - b)[Math.floor(targetRTs.length / 2)] : 0,
    rt_sd: sd,
    rt_cov: mean > 0 ? sd / mean : 0,
    accuracy: events.length > 0 ? events.filter((e) => e.is_correct === true).length / events.length : 0,
    ...(irtState && {
      irt_theta: irtState.theta,
      irt_se: irtState.seTh,
      irt_responses_count: irtState.responses.length,
    }),
  };
}

export type CPTTrial = { letter: string; type: "target" | "nontarget"; isi_ms: number };

export type CPTPhase = "instructions" | "practice" | "main" | "extension" | "complete";

type CPTAdaptiveParams = {
  targetRatio: number;
  isiMin: number;
  isiMax: number;
  responseWindow: number;
};

function buildOneTrial(params: CPTAdaptiveParams): CPTTrial {
  const isTarget = Math.random() < params.targetRatio;
  const letter = isTarget
    ? TARGET_LETTER
    : NON_TARGET_LETTERS[Math.floor(Math.random() * NON_TARGET_LETTERS.length)];
  return {
    letter,
    type: isTarget ? "target" : "nontarget",
    isi_ms: params.isiMin + Math.random() * (params.isiMax - params.isiMin),
  };
}

export function buildCPTTrials(count: number): CPTTrial[] {
  const defaultParams: CPTAdaptiveParams = {
    targetRatio: ADAPTIVE_DEFAULTS.cpt.targetRatio,
    isiMin: ADAPTIVE_DEFAULTS.cpt.isiMin,
    isiMax: ADAPTIVE_DEFAULTS.cpt.isiMax,
    responseWindow: ADAPTIVE_DEFAULTS.cpt.responseWindow,
  };
  return Array.from({ length: count }, () => buildOneTrial(defaultParams));
}

function adaptCPT(params: CPTAdaptiveParams, perf: PerformanceModel): CPTAdaptiveParams {
  if (perf.totalTrials < WARMUP_TRIALS) return params;

  let { targetRatio, isiMin, isiMax, responseWindow } = params;

  // Ceiling: very low omission + fast RT → harder
  if (perf.omissionRate < 0.05 && perf.meanRT > 0 && perf.meanRT < 400) {
    targetRatio = clamp(targetRatio + 0.05, 0.1, 0.4);
    isiMin = clamp(isiMin - 100, 500, 2000);
    isiMax = clamp(isiMax - 100, 800, 3000);
  }

  // Floor: high omission → easier
  if (perf.omissionRate > 0.3) {
    targetRatio = clamp(targetRatio - 0.05, 0.1, 0.4);
    isiMin = clamp(isiMin + 100, 500, 2000);
    isiMax = clamp(isiMax + 100, 800, 3000);
  }

  // Response window based on RT / omission
  if (perf.meanRT > 0 && perf.meanRT < 500) {
    responseWindow = clamp(responseWindow - 100, 800, 2000);
  }
  if (perf.omissionRate > 0.2) {
    responseWindow = clamp(responseWindow + 100, 800, 2000);
  }

  return { targetRatio, isiMin, isiMax, responseWindow };
}

type Refs = {
  blockStart: number;
  frameCount: number;
  events: Record<string, unknown>[];
  responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
  nextTrialTimeoutId: ReturnType<typeof setTimeout> | undefined;
  stimulusTimeoutId: ReturnType<typeof setTimeout> | undefined;
  /** Active Space handler for current trial — must detach on cleanup / re-advance so one keypress can't score twice */
  keydownHandler: ((e: KeyboardEvent) => void) | null;
  rafId: number;
  perfModel: PerformanceModel;
  adaptiveParams: CPTAdaptiveParams;
  maxTrials: number;
  irtState: IRTState;
  currentIRTItem: IRTItem | null;
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  mainAdaptiveHistory: AdaptiveHistory;
};

type CPTState = {
  phase: CPTPhase;
  practiceAttempt: number;
  sessionId: string | null;
  trialIndex: number;
  trials: CPTTrial[];
  maxTrials: number;
  currentLetter: string | null;
  events: Record<string, unknown>[];
  droppedFrames: number;
  additionalTrials: number;
  practiceState: PracticeState | null;
  lastPracticeFeedback: PracticeEvent["errorType"] | null;
  practiceReinstruction: boolean;
  practiceReinstructionLevel: PracticeReinstructionLevel | null;
  practiceReinstructionHint: string | null;
  mainReinstruction: boolean;
  _refs: Refs;
  addEvent: (ev: Record<string, unknown>) => void;
  addPracticeEvent: (ev: Record<string, unknown>) => void;
  advanceTrial: () => void;
  startPractice: () => Promise<void>;
  resumePractice: () => void;
  restartMain: () => void;
  startExtension: (trialsToAdd: number) => void;
  finishPractice: () => Promise<void>;
  finishMain: () => Promise<boolean>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

const defaultAdaptiveParams: CPTAdaptiveParams = {
  targetRatio: ADAPTIVE_DEFAULTS.cpt.targetRatio,
  isiMin: ADAPTIVE_DEFAULTS.cpt.isiMin,
  isiMax: ADAPTIVE_DEFAULTS.cpt.isiMax,
  responseWindow: ADAPTIVE_DEFAULTS.cpt.responseWindow,
};

export const cptStore = create<CPTState>((set, get) => ({
  phase: "instructions",
  practiceAttempt: 0,
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: MAIN_BLOCK_SIZE,
  currentLetter: null,
  events: [],
  droppedFrames: 0,
  additionalTrials: 0,
  practiceState: null,
  lastPracticeFeedback: null,
  practiceReinstruction: false,
  practiceReinstructionLevel: null,
  practiceReinstructionHint: null,
  mainReinstruction: false,
  _refs: {
    blockStart: 0,
    frameCount: 0,
    events: [],
    responseTimeoutId: undefined,
    nextTrialTimeoutId: undefined,
    stimulusTimeoutId: undefined,
    keydownHandler: null,
    rafId: 0,
    perfModel: createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize),
    adaptiveParams: { ...defaultAdaptiveParams },
    maxTrials: MAIN_BLOCK_SIZE,
    irtState: createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD),
    currentIRTItem: null,
    practiceEvents: [],
    practiceConfig: { ...PRACTICE_CONFIG },
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
  },

  addEvent: (ev) => {
    const { sessionId, trialIndex, phase } = get();
    catStore.getState().addTrial({
      reaction_time_ms: (ev.reaction_time_ms as number | null | undefined) ?? null,
      expected_response: ev.event_type === "target",
    });
    set((s) => {
      const next = [...s.events, ev];
      get()._refs.events = next;
      return { events: next };
    });
    if (phase === "main" || phase === "extension") {
      const r = get()._refs;
      const completed = r.events.length;
      const durMin = (performance.now() - r.blockStart) / 60_000;
      const cp = buildCptCheckpoint(r.events, get().maxTrials, durMin, {
        fatigueSlopeAnalysisActive: CPT_EXTENDED_MODE,
        droppedFrames: get().droppedFrames,
      });
      const stopResult = tryMainAdaptiveStop(
        "cpt",
        cp,
        r.mainAdaptiveHistory,
        getSessionAdaptiveBounds("cpt", r.maxTrials),
      );
      r.mainAdaptiveHistory = stopResult.history;

      const cat = catStore.getState();
      if (!cat.shouldTriggerBlockEnd && completed >= r.maxTrials) {
        cat.setBlockEndTrigger("session_max_trials");
      }

      if (catStore.getState().shouldTriggerBlockEnd) {
        get().cleanup();
        set({ currentLetter: null });
        scheduleCptBlockEndCompletion();
        return;
      }
    }

    // Check for mid-task LLM checkpoint
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "cpt", trialIndex + 1, computeCptMetrics(events, get()._refs.irtState));
    }

    // Per-trial adaptation + IRT (extended mode only — MVP keeps fixed params)
    if (phase === "main" || phase === "extension") {
      const refs = get()._refs;
      refs.perfModel = updatePerformanceModel(refs.perfModel, ev);
      if (CPT_EXTENDED_MODE) {
        refs.adaptiveParams = adaptCPT(refs.adaptiveParams, refs.perfModel);
      }

      // IRT: dichotomize, update theta
      if (refs.currentIRTItem) {
        const score = scoreCPT(ev);
        refs.irtState = updateIRTState(
          refs.irtState,
          refs.currentIRTItem.id,
          refs.currentIRTItem.difficulty,
          refs.currentIRTItem.discrimination,
          score,
        );
        // No SE-theta early stop in simple threshold mode.
      }

      // CPT appends trials in advanceTrial, not here — IRT item selection happens there
    }
  },

  addPracticeEvent: (ev) => {
    const { practiceState, _refs } = get();
    if (!practiceState) return;
    const config = _refs.practiceConfig;

    // Classify error
    const rt = ev.reaction_time_ms as number | null;
    const eventType = ev.event_type as string;
    const isCorrect = ev.is_correct === true;
    let errorType: PracticeEvent["errorType"] = "correct";
    if (!isCorrect) {
      if (eventType === "target" && rt == null) errorType = "omission";
      else if (eventType === "nontarget" && rt != null) errorType = "premature";
      else if (rt != null && rt < 100) errorType = "premature";
      else errorType = "incorrect";
    }

    // Record in engine
    const updated = recordPracticeTrial(practiceState, { isCorrect, errorType, reactionTimeMs: rt });

    // Store event
    _refs.practiceEvents.push(ev);

    // Set feedback if in early sub-phase
    const feedback = shouldShowFeedback(updated) ? errorType : null;
    set({ practiceState: updated, lastPracticeFeedback: feedback });

    // Evaluate at block boundaries
    if (
      updated.totalTrialsCompleted >= config.maxTrials
      || updated.currentBlockTrials % config.evaluationInterval === 0
      || (updated.subPhase === "final" && updated.currentBlockTrials >= config.finalTrialCount)
    ) {
      const shouldCountBlock =
        updated.totalTrialsCompleted % config.evaluationInterval === 0 || updated.totalTrialsCompleted >= config.maxTrials;
      const counted = shouldCountBlock
        ? { ...updated, blocksCompleted: updated.blocksCompleted + 1 }
        : updated;
      const evaluation = evaluatePracticeBlock(counted, config);

      switch (evaluation.action) {
        case "continue": {
          const remaining = config.maxTrials - updated.totalTrialsCompleted;
          const nextBlockSize = Math.min(config.evaluationInterval, remaining);
          set({
            trials: [...get().trials, ...buildCPTTrials(nextBlockSize)],
            practiceState: { ...counted, currentBlockCorrect: 0, currentBlockTrials: 0 },
          });
          break;
        }
        case "reinstructions":
          set({
            phase: "instructions",
            practiceReinstruction: true,
            practiceReinstructionLevel: evaluation.level,
            practiceReinstructionHint: evaluation.level === "simplified"
              ? "Press SPACE only for X. Do nothing for other letters."
              : "Tip: keep your finger ready, but only press when you actually see X.",
            practiceState: {
              ...counted,
              subPhase: "reinstructions",
              instructionRedisplays: updated.instructionRedisplays + 1,
              currentBlockCorrect: 0,
              currentBlockTrials: 0,
              practiceErrorPattern: "accuracy_low",
            },
            lastPracticeFeedback: null,
          });
          break;
        case "start_final":
          set({
            trials: [...get().trials, ...buildCPTTrials(config.finalTrialCount)],
            practiceState: { ...counted, subPhase: "final", currentBlockCorrect: 0, currentBlockTrials: 0 },
            lastPracticeFeedback: null,
          });
          break;
        case "proceed_to_main":
          set({
            practiceState: {
              ...counted,
              passed: evaluation.passed,
              lowConfidence: evaluation.lowConfidence,
            },
          });
          get().finishPractice();
          break;
      }
    }
  },

  advanceTrial: () => {
    if (isTaskPaused()) return;
    const { phase, trials, trialIndex, _refs, addEvent, addPracticeEvent } = get();

    if (phase === "main" || phase === "extension") {
      if (catStore.getState().shouldTriggerBlockEnd) return;
      if (_refs.events.length >= _refs.maxTrials) {
        if (!catStore.getState().shouldTriggerBlockEnd) {
          catStore.getState().setBlockEndTrigger("session_max_trials");
        }
        get().cleanup();
        set({ currentLetter: null });
        scheduleCptBlockEndCompletion();
        return;
      }
    }

    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;

    // Drop any overlapping schedule/listener before starting this trial (avoids duplicate scoring from double advanceTrial).
    if (_refs.stimulusTimeoutId) clearTimeout(_refs.stimulusTimeoutId);
    if (_refs.responseTimeoutId) clearTimeout(_refs.responseTimeoutId);
    if (_refs.nextTrialTimeoutId) clearTimeout(_refs.nextTrialTimeoutId);
    _refs.stimulusTimeoutId = undefined;
    _refs.responseTimeoutId = undefined;
    _refs.nextTrialTimeoutId = undefined;
    if (_refs.keydownHandler) {
      window.removeEventListener("keydown", _refs.keydownHandler);
      _refs.keydownHandler = null;
    }

    if ((phase === "main" || phase === "extension") && catStore.getState().shouldTriggerBlockEnd) return;

    // Dynamically append next trial if needed (per-trial generation)
    if (
      !catStore.getState().shouldTriggerBlockEnd &&
      (phase === "main" || phase === "extension") &&
      trialIndex >= trials.length &&
      trialIndex < _refs.maxTrials
    ) {
      let nextTrial: CPTTrial;

      if (
        CPT_EXTENDED_MODE &&
        _refs.irtState.responses.length >= IRT_CONFIG.irtWarmupTrials
      ) {
        const item = selectNextItem(CPT_ITEM_BANK, _refs.irtState.theta, _refs.irtState.administeredItemIds);
        _refs.currentIRTItem = item;
        const targetRatio = item.params.targetRatio as number;
        const isiCenter = item.params.isiCenter as number;
        const isiJitter = (Math.random() - 0.5) * 200;
        const isTarget = Math.random() < targetRatio;
        const letter = isTarget
          ? TARGET_LETTER
          : NON_TARGET_LETTERS[Math.floor(Math.random() * NON_TARGET_LETTERS.length)];
        nextTrial = {
          letter,
          type: isTarget ? "target" : "nontarget",
          isi_ms: Math.max(400, isiCenter + isiJitter),
        };
      } else {
        _refs.currentIRTItem = null;
        nextTrial = buildOneTrial(_refs.adaptiveParams);
      }

      set((prev) => ({ trials: [...prev.trials, nextTrial] }));
    }

    const currentTrials = get().trials;
    if (trialIndex >= currentTrials.length || trialIndex >= _refs.maxTrials) return;

    const blockIndex = phase === "extension" ? 1 : 0;
    const trial = currentTrials[trialIndex];
    const onset = performance.now();
    const responseWindow = _refs.adaptiveParams.responseWindow;

    set({ currentLetter: trial.letter });

    _refs.stimulusTimeoutId = setTimeout(() => {
      _refs.stimulusTimeoutId = undefined;
      set({ currentLetter: null });
      let responded = false;

      const baseIndex = blockIndex > 0 ? MAIN_BLOCK_SIZE + trialIndex : trialIndex;
      const makeEvent = (
        keypressMs: number | null,
        rt: number | null,
        isCorrect: boolean
      ) => ({
        task_name: "cpt",
        trial_index: baseIndex,
        stimulus_onset_ms: onset,
        keypress_ms: keypressMs,
        reaction_time_ms: rt,
        response_key: keypressMs != null ? " " : null,
        correct_key: trial.type === "target" ? " " : null,
        is_correct: isCorrect,
        event_type: trial.type,
        isi_ms: trialIndex === 0 ? null : trial.isi_ms,
        expected_response: trial.type === "target",
      });

      const goNext = () => {
        if (_refs.responseTimeoutId) {
          clearTimeout(_refs.responseTimeoutId);
          _refs.responseTimeoutId = undefined;
        }
        if (
          (phase === "main" || phase === "extension") &&
          catStore.getState().shouldTriggerBlockEnd
        ) {
          return;
        }
        const s = get();
        if (s.phase !== phase) return;
        if (phase === "main" || phase === "extension") {
          if (s.trialIndex !== trialIndex) return;
          set({ trialIndex: trialIndex + 1 });
        } else {
          if (s.trialIndex !== trialIndex) return;
          set({ trialIndex: trialIndex + 1 });
        }
        _refs.nextTrialTimeoutId = setTimeout(() => {
          _refs.nextTrialTimeoutId = undefined;
          if (catStore.getState().shouldTriggerBlockEnd) return;
          get().advanceTrial();
        }, trial.isi_ms);
      };

      const finishTrialOrStop = () => {
        if (
          (phase === "main" || phase === "extension") &&
          catStore.getState().shouldTriggerBlockEnd
        ) {
          if (_refs.nextTrialTimeoutId) {
            clearTimeout(_refs.nextTrialTimeoutId);
            _refs.nextTrialTimeoutId = undefined;
          }
          get().cleanup();
          set({ currentLetter: null });
          return;
        }
        goNext();
      };

      const handleKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (e.key !== " ") return;
        if (responded) return;
        e.preventDefault();
        responded = true;
        const keypressMs = performance.now();
        const rt = keypressMs - onset;
        const correct = trial.type === "target";
        recordEvent(makeEvent(keypressMs, rt, correct));
        window.removeEventListener("keydown", handleKey);
        _refs.keydownHandler = null;
        finishTrialOrStop();
      };

      _refs.keydownHandler = handleKey;
      window.addEventListener("keydown", handleKey);

      if (trial.type === "target") {
        _refs.responseTimeoutId = setTimeout(() => {
          _refs.responseTimeoutId = undefined;
          window.removeEventListener("keydown", handleKey);
          _refs.keydownHandler = null;
          if (!responded) {
            recordEvent(makeEvent(null, null, false));
          }
          finishTrialOrStop();
        }, responseWindow);
      } else {
        _refs.responseTimeoutId = setTimeout(() => {
          _refs.responseTimeoutId = undefined;
          window.removeEventListener("keydown", handleKey);
          _refs.keydownHandler = null;
          if (!responded) {
            recordEvent(makeEvent(null, null, true));
          }
          finishTrialOrStop();
        }, responseWindow);
      }
    }, CPT_STIMULUS_MS);
  },

  startPractice: async () => {
    const { _refs } = get();
    try {
      const res = await sessionsService.create("cpt");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "cpt");

      if (taskConfig?.practice_config) {
        _refs.practiceConfig = {
          minTrials: taskConfig.practice_config.min_trials
            ?? PRACTICE_CONFIG.minTrials,
          maxTrials: taskConfig.practice_config.max_trials
            ?? PRACTICE_CONFIG.maxTrials,
          evaluationInterval: taskConfig.practice_config.evaluation_interval
            ?? PRACTICE_CONFIG.evaluationInterval,
          passThreshold: taskConfig.practice_config.pass_threshold
            ?? PRACTICE_CONFIG.passThreshold,
          continueThreshold: taskConfig.practice_config.continue_threshold
            ?? PRACTICE_CONFIG.continueThreshold,
          finalTrialCount: taskConfig.practice_config.final_trial_count ?? 0,
        };
      }

      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceEvents = [];
      catStore.getState().resetForNewTask();
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
      set({
        sessionId: res.session_id,
        phase: "practice",
        trials: buildCPTTrials(initialPracticeBlockSize),
        trialIndex: 0,
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
      });
    } catch {
      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceEvents = [];
      catStore.getState().resetForNewTask();
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
      set({
        phase: "practice",
        trials: buildCPTTrials(initialPracticeBlockSize),
        trialIndex: 0,
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
      });
    }
  },

  resumePractice: () => {
    const { _refs } = get();
    catStore.getState().resetForNewTask();
    const config = _refs.practiceConfig;
    _refs.practiceEvents = [];
    _refs.blockStart = performance.now();
    const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
    set({
      phase: "practice",
      trials: buildCPTTrials(initialPracticeBlockSize),
      trialIndex: 0,
      practiceState: {
        ...createPracticeState(),
        subPhase: "early",
      },
      practiceReinstruction: false,
      lastPracticeFeedback: null,
      practiceReinstructionLevel: null,
      practiceReinstructionHint: null,
    });
  },

  finishPractice: async () => {
    const { _refs, practiceState } = get();
    get().cleanup();
    await new Promise((r) => setTimeout(r, PRACTICE_FEEDBACK_FINISH_DELAY_MS));
    set({ trials: [], trialIndex: 0 });

    try {
      let sid = get().sessionId;
      if (!sid) {
        const res = await sessionsService.create("cpt");
        sid = res.session_id;
        set({ sessionId: sid });
      }

      // Post practice events with is_practice flag
      if (_refs.practiceEvents.length > 0) {
        const practiceEventsWithFlag = _refs.practiceEvents.map((ev) => ({
          ...ev,
          extra_data: { ...(ev.extra_data as Record<string, unknown> || {}), is_practice: true },
        }));
        await sessionsService.postEvents(sid, practiceEventsWithFlag);
      }

      // Post practice metadata in block
      const meta = practiceState ? getPracticeMetadata(practiceState) : null;
      if (meta) {
        await sessionsService.postBlocks(sid, {
          task_name: "cpt",
          block_index: -1,
          practice_pass: meta.practice_passed,
          practice_accuracy: meta.practice_accuracy,
          practice_trial_count: meta.total_practice_trials,
          low_confidence_flag: meta.low_confidence_flag,
          practice_blocks_completed: meta.practice_blocks_completed,
          practice_error_pattern: meta.practice_error_pattern ?? undefined,
          block_start_ts: _refs.blockStart,
          block_end_ts: performance.now(),
        });
      }

      _refs.blockStart = performance.now();
      _refs.frameCount = 0;
      _refs.events = [];
      _refs.practiceEvents = [];
      _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
      _refs.adaptiveParams = { ...defaultAdaptiveParams };
      _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
      _refs.currentIRTItem = null;
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      catStore.getState().resetForNewTask();

      // Load dynamic trial count from backend config
      const config = await catStore.getState().loadTaskConfig(sid, "cpt");
      const trialCount = config?.max_trials ?? MAIN_BLOCK_SIZE;
      _refs.maxTrials = trialCount;

      // Seed a small batch; advanceTrial appends up to maxTrials (early adaptive stop).
      const initialMainTrials = Math.min(WARMUP_TRIALS, trialCount);
      set({
        phase: "main",
        trials: Array.from({ length: initialMainTrials }, () => buildOneTrial(_refs.adaptiveParams)),
        maxTrials: trialCount,
        trialIndex: 0,
        events: [],
        droppedFrames: 0,
        mainReinstruction: false,
      });
      toast.success("Practice complete. Starting main task.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start task");
    }
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.maxTrials = trialsToAdd;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();

    const warmupCount = Math.min(WARMUP_TRIALS, trialsToAdd);
    set({
      events: [],
      trials: Array.from({ length: warmupCount }, () => buildOneTrial(_refs.adaptiveParams)),
      maxTrials: trialsToAdd,
      trialIndex: 0,
      additionalTrials: trialsToAdd,
      phase: "extension",
    });
  },

  restartMain: () => {
    const { _refs, maxTrials } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.frameCount = 0;
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.maxTrials = maxTrials;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    const initialMainTrials = Math.min(WARMUP_TRIALS, maxTrials);
    set({
      phase: "main",
      trialIndex: 0,
      trials: Array.from({ length: initialMainTrials }, () => buildOneTrial(_refs.adaptiveParams)),
      events: [],
      droppedFrames: 0,
      mainReinstruction: false,
    });
  },

  finishMain: async () => {
    const { sessionId, droppedFrames, _refs, phase } = get();
    if (phase !== "main" && phase !== "extension") {
      return false;
    }
    if (!sessionId) {
      set({ phase: "complete" });
      return false;
    }
    const adaptiveStop = catStore.getState().blockEndTriggerReason === "main_adaptive_stop";

    if (_refs.events.length > 0) {
      try {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send events");
      }
    }

    try {
      await sessionsService.scoreCpt(sessionId);
      const check = await sessionsService.getCptStoppingCheck(sessionId);
      const slope = check.time_on_task_slope_ms_per_quarter ?? 0;
      const fatigueUnclear =
        !check.should_stop && check.met_floor && slope > FATIGUE_SLOPE_THRESHOLD_MS;

      if (!adaptiveStop && fatigueUnclear) {
        const blockEnd = performance.now();
        await sessionsService.postBlocks(sessionId, {
          task_name: "cpt",
          block_index: 0,
          practice_pass: false,
          dropped_frame_count: droppedFrames,
          block_start_ts: _refs.blockStart,
          block_end_ts: blockEnd,
        });
        _refs.events = [];
        _refs.blockStart = performance.now();
        _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
        _refs.adaptiveParams = { ...defaultAdaptiveParams };
        _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
        _refs.currentIRTItem = null;
        _refs.maxTrials = EXTENSION_BLOCK_SIZE;
        catStore.getState().resetForNewTask();

        const warmupCount = Math.min(WARMUP_TRIALS, EXTENSION_BLOCK_SIZE);
        set({
          events: [],
          trialIndex: 0,
          trials: Array.from({ length: warmupCount }, () => buildOneTrial(_refs.adaptiveParams)),
          phase: "extension",
        });
        toast.info("Fatigue detected — running extension block for better estimate.");
        return false;
      }

      if (check.should_stop && check.met_floor) {
        toast.success("Task completed early — sufficient precision reached.");
      }
    } catch {
      /* non-fatal */
    }

    const blockEnd = performance.now();
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "cpt",
        block_index: 0,
        practice_pass: false,
        dropped_frame_count: droppedFrames,
        block_start_ts: _refs.blockStart,
        block_end_ts: blockEnd,
      });
      await sessionsService.scoreCpt(sessionId);
      toast.success("Results saved successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save block");
    }
    _refs.events = [];
    set({ events: [], phase: "complete", mainReinstruction: false });
    return true;
  },

  finishExtension: async () => {
    const { sessionId, droppedFrames, _refs } = get();
    if (!sessionId) {
      set({ phase: "complete" });
      return;
    }
    if (_refs.events.length > 0) {
      try {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send events");
      }
    }
    const blockEnd = performance.now();
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "cpt",
        block_index: 1,
        practice_pass: false,
        dropped_frame_count: droppedFrames,
        block_start_ts: _refs.blockStart,
        block_end_ts: blockEnd,
      });
      await sessionsService.scoreCpt(sessionId);
      toast.success("Extension block complete. Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.responseTimeoutId) clearTimeout(_refs.responseTimeoutId);
    if (_refs.nextTrialTimeoutId) clearTimeout(_refs.nextTrialTimeoutId);
    if (_refs.stimulusTimeoutId) clearTimeout(_refs.stimulusTimeoutId);
    if (_refs.rafId) cancelAnimationFrame(_refs.rafId);
    _refs.responseTimeoutId = undefined;
    _refs.nextTrialTimeoutId = undefined;
    _refs.stimulusTimeoutId = undefined;
    if (_refs.keydownHandler) {
      window.removeEventListener("keydown", _refs.keydownHandler);
      _refs.keydownHandler = null;
    }
  },

  resumeAfterPause: () => {
    queueMicrotask(() => {
      if (isTaskPaused()) return;
      const { phase, trialIndex, maxTrials, _refs } = get();
      if (phase !== "practice" && phase !== "main" && phase !== "extension") return;
      if ((phase === "main" || phase === "extension") && catStore.getState().shouldTriggerBlockEnd) {
        return;
      }
      if (phase === "practice") {
        if (trialIndex >= _refs.practiceConfig.maxTrials) return;
        const state = get();
        const ps = state.practiceState;
        const cap = _refs.practiceConfig.maxTrials;
        if (
          ps &&
          trialIndex >= state.trials.length &&
          ps.totalTrialsCompleted < cap
        ) {
          const remaining = cap - ps.totalTrialsCompleted;
          const nextBlockSize = Math.min(_refs.practiceConfig.evaluationInterval, remaining);
          set({ trials: [...state.trials, ...buildCPTTrials(nextBlockSize)] });
        }
      } else if (trialIndex >= maxTrials) {
        return;
      }
      // Clear stale stimulus; advanceTrial clears any leftover timers/handlers and reschedules.
      set({ currentLetter: null });
      get().advanceTrial();
    });
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.blockStart = 0;
    _refs.frameCount = 0;
    _refs.events = [];
    _refs.responseTimeoutId = undefined;
    _refs.nextTrialTimeoutId = undefined;
    _refs.stimulusTimeoutId = undefined;
    _refs.keydownHandler = null;
    _refs.rafId = 0;
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.maxTrials = MAIN_BLOCK_SIZE;
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.practiceEvents = [];
    _refs.practiceConfig = { ...PRACTICE_CONFIG };
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      practiceAttempt: 0,
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: MAIN_BLOCK_SIZE,
      currentLetter: null,
      events: [],
      droppedFrames: 0,
      additionalTrials: 0,
      practiceState: null,
      lastPracticeFeedback: null,
      practiceReinstruction: false,
      mainReinstruction: false,
    });
  },
}));
