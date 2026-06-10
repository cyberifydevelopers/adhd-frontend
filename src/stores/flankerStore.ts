import { create } from "zustand";
import { sessionsService, usersMeService } from "@/services";
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
import { FLANKER_ITEM_BANK } from "@/lib/itemBanks";
import { scoreFlanker } from "@/lib/irtScoring";
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
import {
  getSessionAdaptiveBounds,
  resetMainAdaptiveHistory,
  tryMainAdaptiveStop,
} from "@/lib/mainAdaptiveIntegration";
import { buildFlankerCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused, rtTrialStateAfterPauseCleanup } from "@/lib/taskPauseGuard";
import { ageFromIsoDateOfBirth } from "@/lib/digitSpanSpec";
import { flankerLargeStimulusFromAge } from "@/lib/mainTestAgeDefaults";

const MAIN_LIMITS = getMainTrialLimits("flanker");
const MAIN_TRIALS = MAIN_LIMITS.maxTrials;
const RESPONSE_TIMEOUT_MS = 2000;
const MIN_READY_DISPLAY_MS = 800;
const WARMUP_TRIALS = ADAPTIVE_DEFAULTS.warmupTrials;
/** Spec stable-stop: need ≥15 trials per congruence cell before adaptive stop can fire. */
const FLANKER_MIN_CELL_TRIALS = 15;

const CONGRUENCE = ["congruent", "incongruent"] as const;
const DIRECTIONS = ["left", "right"] as const;
type Congruence = (typeof CONGRUENCE)[number];
type Direction = (typeof DIRECTIONS)[number];

const CORRECT_KEYS: Record<Direction, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
};

function computeFlankerMetrics(
  events: Record<string, unknown>[],
  irtState?: IRTState,
): Record<string, unknown> {
  const congRTs = events.filter((e) => e.event_type === "congruent" && e.reaction_time_ms != null)
    .map((e) => e.reaction_time_ms as number);
  const incongRTs = events.filter((e) => e.event_type === "incongruent" && e.reaction_time_ms != null)
    .map((e) => e.reaction_time_ms as number);
  const meanCong = congRTs.length > 0 ? congRTs.reduce((a, b) => a + b, 0) / congRTs.length : 0;
  const meanIncong = incongRTs.length > 0 ? incongRTs.reduce((a, b) => a + b, 0) / incongRTs.length : 0;
  const allRTs = [...congRTs, ...incongRTs];
  const mean = allRTs.length > 0 ? allRTs.reduce((a, b) => a + b, 0) / allRTs.length : 0;
  const sd = allRTs.length > 1
    ? Math.sqrt(allRTs.reduce((a, b) => a + (b - mean) ** 2, 0) / (allRTs.length - 1))
    : 0;
  return {
    congruent_rt: meanCong,
    incongruent_rt: meanIncong,
    interference_cost: meanIncong - meanCong,
    accuracy: events.length > 0 ? events.filter((e) => e.is_correct === true).length / events.length : 0,
    rt_cov: mean > 0 ? sd / mean : 0,
    ...(irtState && {
      irt_theta: irtState.theta,
      irt_se: irtState.seTh,
      irt_responses_count: irtState.responses.length,
    }),
  };
}

export type FlankerPhase = "instructions" | "practice" | "main" | "extension" | "complete";

export type FlankerTrial = {
  foreperiod: number;
  congruence: Congruence;
  centerDirection: Direction;
};

type FlankerAdaptiveParams = {
  incongruentRatio: number;
  foreperiodMin: number;
  foreperiodMax: number;
};

function countFlankerCells(events: Record<string, unknown>[]): { cong: number; incong: number } {
  return {
    cong: events.filter((e) => e.event_type === "congruent").length,
    incong: events.filter((e) => e.event_type === "incongruent").length,
  };
}

/** Prefer under-filled cells so ≥15 congruent & ≥15 incongruent can be met before max trials. */
function pickFlankerCongruence(
  events: Record<string, unknown>[],
  params: FlankerAdaptiveParams,
): Congruence {
  const { cong, incong } = countFlankerCells(events);
  if (cong < FLANKER_MIN_CELL_TRIALS) return "congruent";
  if (incong < FLANKER_MIN_CELL_TRIALS) return "incongruent";
  return Math.random() < params.incongruentRatio ? "incongruent" : "congruent";
}

function buildOneTrial(params: FlankerAdaptiveParams, priorEvents: Record<string, unknown>[] = []): FlankerTrial {
  const congruence = pickFlankerCongruence(priorEvents, params);
  return {
    foreperiod: params.foreperiodMin + Math.random() * (params.foreperiodMax - params.foreperiodMin),
    congruence,
    centerDirection: DIRECTIONS[Math.floor(Math.random() * 2)] as Direction,
  };
}

function buildTrials(count: number, params: FlankerAdaptiveParams): FlankerTrial[] {
  const pseudoEvents: Record<string, unknown>[] = [];
  const trials: FlankerTrial[] = [];
  for (let i = 0; i < count; i += 1) {
    const trial = buildOneTrial(params, pseudoEvents);
    trials.push(trial);
    pseudoEvents.push({ event_type: trial.congruence });
  }
  return trials;
}

function applyFlankerCellBalance(trial: FlankerTrial, events: Record<string, unknown>[]): FlankerTrial {
  const { cong, incong } = countFlankerCells(events);
  if (cong < FLANKER_MIN_CELL_TRIALS) return { ...trial, congruence: "congruent" };
  if (incong < FLANKER_MIN_CELL_TRIALS) return { ...trial, congruence: "incongruent" };
  return trial;
}

function adaptFlanker(params: FlankerAdaptiveParams, perf: PerformanceModel): FlankerAdaptiveParams {
  if (perf.totalTrials < WARMUP_TRIALS) return params;

  let { incongruentRatio, foreperiodMin, foreperiodMax } = params;

  // Incongruent ratio based on incongruent accuracy
  const incongAcc = perf.conditionAccuracy["incongruent"] ?? 0;
  if (incongAcc > 0.9) {
    incongruentRatio = clamp(incongruentRatio + 0.02, 0.3, 0.8);
  } else if (incongAcc < 0.6) {
    incongruentRatio = clamp(incongruentRatio - 0.02, 0.3, 0.8);
  }

  // Foreperiod range based on rtCoV
  if (perf.rtCoV > 0.3) {
    foreperiodMax = clamp(foreperiodMax + 50, foreperiodMin + 300, 3500);
    foreperiodMin = clamp(foreperiodMin + 50, 400, foreperiodMax - 300);
  } else if (perf.rtCoV < 0.15) {
    foreperiodMin = clamp(foreperiodMin - 50, 400, foreperiodMax - 300);
    foreperiodMax = clamp(foreperiodMax - 50, foreperiodMin + 300, 3500);
  }

  return { incongruentRatio, foreperiodMin, foreperiodMax };
}

/** Bucketed params so micro ratio steps (0.02) do not reset the trials-at-difficulty counter every trial. */
function flankerDifficultySnapshot(params: FlankerAdaptiveParams): string {
  const ratioBand = Math.round(params.incongruentRatio * 10) / 10;
  const fpMinBand = Math.round(params.foreperiodMin / 100) * 100;
  const fpMaxBand = Math.round(params.foreperiodMax / 100) * 100;
  return `${ratioBand}|${fpMinBand}|${fpMaxBand}`;
}

type Refs = {
  stimulusOnset: number;
  activeStimulusTrialIndex: number | null;
  stimulusOutcomeRecorded: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  blockStart: number;
  events: Record<string, unknown>[];
  perfModel: PerformanceModel;
  adaptiveParams: FlankerAdaptiveParams;
  maxTrials: number;
  irtState: IRTState;
  currentIRTItem: IRTItem | null;
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  mainAdaptiveHistory: AdaptiveHistory;
  /** Event count when incongruent ratio last changed (for trials-at-difficulty gate). */
  difficultyEpochEventCount: number;
};

type FlankerState = {
  phase: FlankerPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: FlankerTrial[];
  maxTrials: number;
  status: "waiting" | "stimulus" | "responded";
  events: Record<string, unknown>[];
  _refs: Refs;
  additionalTrials: number;
  practiceState: PracticeState | null;
  lastPracticeFeedback: PracticeEvent["errorType"] | null;
  practiceReinstruction: boolean;
  practiceReinstructionLevel: PracticeReinstructionLevel | null;
  practiceReinstructionHint: string | null;
  mainReinstruction: boolean;
  /** Age-based larger arrows (younger children). */
  largeMainStimulus: boolean;
  addEvent: (ev: Record<string, unknown>) => void;
  addPracticeEvent: (ev: Record<string, unknown>) => void;
  scheduleStimulus: (trial: FlankerTrial, idx: number) => void;
  recordResponse: (responseKey: string, isCorrect: boolean) => void;
  startPractice: () => Promise<void>;
  resumePractice: () => void;
  restartMain: () => void;
  finishPractice: () => Promise<void>;
  startExtension: (trialsToAdd: number) => void;
  finishMain: () => Promise<boolean>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

const defaultAdaptiveParams: FlankerAdaptiveParams = {
  incongruentRatio: ADAPTIVE_DEFAULTS.flanker.incongruentRatio,
  foreperiodMin: ADAPTIVE_DEFAULTS.flanker.foreperiodMin,
  foreperiodMax: ADAPTIVE_DEFAULTS.flanker.foreperiodMax,
};

export const flankerStore = create<FlankerState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: MAIN_TRIALS,
  status: "waiting",
  events: [],
  additionalTrials: 0,
  practiceState: null,
  lastPracticeFeedback: null,
  practiceReinstruction: false,
  practiceReinstructionLevel: null,
  practiceReinstructionHint: null,
  mainReinstruction: false,
  largeMainStimulus: false,
  _refs: {
    stimulusOnset: 0,
    activeStimulusTrialIndex: null,
    stimulusOutcomeRecorded: false,
    timeoutId: null,
    blockStart: 0,
    events: [],
    perfModel: createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize),
    adaptiveParams: { ...defaultAdaptiveParams },
    maxTrials: MAIN_TRIALS,
    irtState: createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD),
    currentIRTItem: null,
    practiceEvents: [],
    practiceConfig: { ...PRACTICE_CONFIG },
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    difficultyEpochEventCount: 0,
  },

  addEvent: (ev) => {
    const { phase } = get();
    catStore.getState().addTrial({
      reaction_time_ms: (ev.reaction_time_ms as number | null | undefined) ?? null,
      expected_response: true,
    });
    set((s) => {
      const next = [...s.events, ev];
      get()._refs.events = next;
      return { events: next };
    });

    // Check for mid-task LLM checkpoint
    const { sessionId, trialIndex } = get();
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "flanker", trialIndex + 1, computeFlankerMetrics(events, get()._refs.irtState));
    }

    // Per-trial adaptation + IRT, then adaptive stop (same order as scored metrics)
    if (phase === "main" || phase === "extension") {
      const refs = get()._refs;
      refs.perfModel = updatePerformanceModel(refs.perfModel, ev);
      const difficultyBefore = flankerDifficultySnapshot(refs.adaptiveParams);
      refs.adaptiveParams = adaptFlanker(refs.adaptiveParams, refs.perfModel);
      if (flankerDifficultySnapshot(refs.adaptiveParams) !== difficultyBefore) {
        refs.difficultyEpochEventCount = refs.events.length;
      }

      if (refs.currentIRTItem) {
        const score = scoreFlanker(ev);
        refs.irtState = updateIRTState(
          refs.irtState,
          refs.currentIRTItem.id,
          refs.currentIRTItem.difficulty,
          refs.currentIRTItem.discrimination,
          score,
        );
      }

      const trialsAtLevel = Math.max(0, refs.events.length - refs.difficultyEpochEventCount);
      const stopResult = tryMainAdaptiveStop(
        "flanker",
        buildFlankerCheckpoint(refs.events, get().maxTrials, {
          trialsAtCurrentDifficulty: trialsAtLevel,
        }),
        refs.mainAdaptiveHistory,
        getSessionAdaptiveBounds("flanker", refs.maxTrials),
      );
      refs.mainAdaptiveHistory = stopResult.history;
      if (
        !catStore.getState().shouldTriggerBlockEnd &&
        refs.events.length >= refs.maxTrials
      ) {
        catStore.getState().setBlockEndTrigger("session_max_trials");
      }

      const s = get();
      const nextIdx = s.trialIndex + 1;
      if (
        !catStore.getState().shouldTriggerBlockEnd &&
        nextIdx < refs.maxTrials &&
        s.trials.length <= nextIdx
      ) {
        let nextTrial: FlankerTrial;

        if (refs.irtState.responses.length >= IRT_CONFIG.irtWarmupTrials) {
          const item = selectNextItem(FLANKER_ITEM_BANK, refs.irtState.theta, refs.irtState.administeredItemIds);
          refs.currentIRTItem = item;
          const fpCenter = item.params.foreperiodCenter as number;
          const congruence = item.params.congruence as Congruence;
          const jitterRange = (refs.adaptiveParams.foreperiodMax - refs.adaptiveParams.foreperiodMin) * 0.15;
          const jitter = (Math.random() - 0.5) * jitterRange;
          nextTrial = applyFlankerCellBalance(
            {
              foreperiod: Math.max(300, fpCenter + jitter),
              congruence,
              centerDirection: DIRECTIONS[Math.floor(Math.random() * 2)] as Direction,
            },
            refs.events,
          );
        } else {
          refs.currentIRTItem = null;
          nextTrial = buildOneTrial(refs.adaptiveParams, refs.events);
        }

        set((prev) => ({ trials: [...prev.trials, nextTrial] }));
      }
    }
  },

  addPracticeEvent: (ev) => {
    const { practiceState, _refs } = get();
    if (!practiceState) return;
    const config = _refs.practiceConfig;

    const rt = ev.reaction_time_ms as number | null;
    const isCorrect = ev.is_correct === true;
    let errorType: PracticeEvent["errorType"] = "correct";
    if (!isCorrect) {
      if (rt == null) errorType = "omission";
      else errorType = "incorrect";
    }

    const updated = recordPracticeTrial(practiceState, { isCorrect, errorType, reactionTimeMs: rt });
    _refs.practiceEvents.push(ev);
    const feedback = shouldShowFeedback(updated) ? errorType : null;
    set({ practiceState: updated, lastPracticeFeedback: feedback });


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
      const evaluation = evaluatePracticeBlock(updated, config);
      switch (evaluation.action) {
        case "continue": {
          const remaining = config.maxTrials - updated.totalTrialsCompleted;
          const nextBlockSize = Math.min(config.evaluationInterval, remaining);
          set({
            trials: [...get().trials, ...buildTrials(nextBlockSize, defaultAdaptiveParams)],
            status: "waiting",
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
              ? "Only the CENTER arrow matters. Ignore the side arrows."
              : "Tip: say the center arrow direction to yourself, then press the matching key.",
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
            trials: [...get().trials, ...buildTrials(config.finalTrialCount, defaultAdaptiveParams)],
            status: "waiting",
            practiceState: { ...counted, subPhase: "final", currentBlockCorrect: 0, currentBlockTrials: 0 },
            lastPracticeFeedback: null,
          });
          break;
        case "proceed_to_main":
          set({
            practiceState: { ...counted, passed: evaluation.passed, lowConfidence: evaluation.lowConfidence },
          });
          get().finishPractice();
          break;
      }
    }
  },

  scheduleStimulus: (trial, idx) => {
    if (isTaskPaused()) return;
    const { _refs, phase } = get();
    if (_refs.timeoutId) clearTimeout(_refs.timeoutId);
    if (
      (phase === "main" || phase === "extension") &&
      catStore.getState().shouldTriggerBlockEnd
    ) {
      return;
    }

    const totalReadyMs = MIN_READY_DISPLAY_MS + trial.foreperiod;
    _refs.timeoutId = setTimeout(() => {
      _refs.stimulusOnset = performance.now();
      _refs.activeStimulusTrialIndex = idx;
      _refs.stimulusOutcomeRecorded = false;
      set({ status: "stimulus" });

      _refs.timeoutId = setTimeout(() => {
        const { phase, addEvent, addPracticeEvent } = get();
        const latest = get();
        const r = latest._refs;
        if (latest.phase !== phase || latest.trialIndex !== idx) return;
        if (latest.status === "responded") {
          set({ status: "waiting", trialIndex: idx + 1 });
          _refs.timeoutId = null;
          return;
        }
        if (r.activeStimulusTrialIndex !== idx || r.stimulusOutcomeRecorded) return;
        r.stimulusOutcomeRecorded = true;
        const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
        recordEvent({
          task_name: "flanker",
          trial_index: idx,
          stimulus_onset_ms: _refs.stimulusOnset,
          keypress_ms: null,
          reaction_time_ms: null,
          response_key: null,
          correct_key: CORRECT_KEYS[trial.centerDirection],
          is_correct: false,
          event_type: trial.congruence,
          isi_ms: trial.foreperiod,
        });
        const s = get();
        if (s.phase !== phase || s.trialIndex !== idx) return;
        if (
          (phase === "main" || phase === "extension") &&
          catStore.getState().shouldTriggerBlockEnd
        ) {
          set({ status: "waiting" });
        } else {
          set({ status: "waiting", trialIndex: idx + 1 });
        }
        const afterAdvance = get();
        const nextIdx = idx + 1;
        if (
          !catStore.getState().shouldTriggerBlockEnd &&
          (phase === "main" || phase === "extension") &&
          nextIdx < afterAdvance._refs.maxTrials &&
          afterAdvance.trials.length <= nextIdx
        ) {
          const nextTrial = buildOneTrial(afterAdvance._refs.adaptiveParams, afterAdvance._refs.events);
          set((prev) => ({ trials: [...prev.trials, nextTrial] }));
        }
        _refs.timeoutId = null;
      }, RESPONSE_TIMEOUT_MS);
    }, totalReadyMs);
  },

  recordResponse: (responseKey, isCorrect) => {
    const { _refs, trials, trialIndex, phase, status, addEvent, addPracticeEvent } = get();
    const trial = trials[trialIndex];
    if (!trial || status !== "stimulus") return;
    if (_refs.activeStimulusTrialIndex !== trialIndex || _refs.stimulusOutcomeRecorded) return;
    _refs.stimulusOutcomeRecorded = true;

    if (_refs.timeoutId) {
      clearTimeout(_refs.timeoutId);
      _refs.timeoutId = null;
    }

    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
    recordEvent({
      task_name: "flanker",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: performance.now(),
      reaction_time_ms: performance.now() - _refs.stimulusOnset,
      response_key: responseKey,
      correct_key: CORRECT_KEYS[trial.centerDirection],
      is_correct: isCorrect,
      event_type: trial.congruence,
      isi_ms: trial.foreperiod,
    });

    const s = get();
    if (s.phase !== phase || s.trialIndex !== trialIndex) return;
    if (phase === "main" || phase === "extension") {
      if (!catStore.getState().shouldTriggerBlockEnd) {
        set({ status: "waiting", trialIndex: trialIndex + 1 });
      } else {
        set({ status: "waiting" });
      }
    } else {
      set({ status: "waiting", trialIndex: trialIndex + 1 });
    }
    const afterAdvance = get();
    const nextIdx = trialIndex + 1;
    if (
      !catStore.getState().shouldTriggerBlockEnd &&
      (phase === "main" || phase === "extension") &&
      nextIdx < afterAdvance._refs.maxTrials &&
      afterAdvance.trials.length <= nextIdx
    ) {
      const nextTrial = buildOneTrial(afterAdvance._refs.adaptiveParams, afterAdvance._refs.events);
      set((prev) => ({ trials: [...prev.trials, nextTrial] }));
    }
  },

  startPractice: async () => {
    const { _refs } = get();
    catStore.getState().resetForNewTask();
    try {
      const res = await sessionsService.create("flanker");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "flanker");

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
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);

      let largeMainStimulus = false;
      try {
        const intake = await usersMeService.getIntake();
        const dob =
          (intake.intake_data?.date_of_birth as string | undefined) ??
          (intake as { date_of_birth?: string }).date_of_birth;
        largeMainStimulus = flankerLargeStimulusFromAge(ageFromIsoDateOfBirth(dob));
      } catch {
        /* ignore */
      }

      set({
        sessionId: res.session_id,
        trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams),
        trialIndex: 0,
        phase: "practice",
        status: "waiting",
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
        largeMainStimulus,
      });
    } catch {
      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceEvents = [];
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);

      let largeMainStimulus = false;
      try {
        const intake = await usersMeService.getIntake();
        const dob =
          (intake.intake_data?.date_of_birth as string | undefined) ??
          (intake as { date_of_birth?: string }).date_of_birth;
        largeMainStimulus = flankerLargeStimulusFromAge(ageFromIsoDateOfBirth(dob));
      } catch {
        /* ignore */
      }

      set({
        trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams),
        trialIndex: 0,
        phase: "practice",
        status: "waiting",
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
        largeMainStimulus,
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
      trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams),
      trialIndex: 0,
      status: "waiting",
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
        const res = await sessionsService.create("flanker");
        sid = res.session_id;
        set({ sessionId: sid });
      }

      if (_refs.practiceEvents.length > 0) {
        const practiceEventsWithFlag = _refs.practiceEvents.map((ev) => ({
          ...ev,
          extra_data: { ...(ev.extra_data as Record<string, unknown> || {}), is_practice: true },
        }));
        await sessionsService.postEvents(sid, practiceEventsWithFlag);
      }

      const meta = practiceState ? getPracticeMetadata(practiceState) : null;
      if (meta) {
        await sessionsService.postBlocks(sid, {
          task_name: "flanker",
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
      _refs.events = [];
      _refs.practiceEvents = [];
      _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
      _refs.adaptiveParams = { ...defaultAdaptiveParams };
      _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
      _refs.currentIRTItem = null;
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      _refs.difficultyEpochEventCount = 0;
      catStore.getState().resetForNewTask();

      const config = await catStore.getState().loadTaskConfig(sid, "flanker");
      const trialCount = config?.max_trials ?? MAIN_TRIALS;
      const initialTrials = Math.min(WARMUP_TRIALS, trialCount);
      _refs.maxTrials = trialCount;

      set({
        phase: "main",
        trials: buildTrials(initialTrials, _refs.adaptiveParams),
        maxTrials: trialCount,
        trialIndex: 0,
        status: "waiting",
        events: [],
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
    _refs.difficultyEpochEventCount = 0;
    catStore.getState().resetForNewTask();

    const warmupCount = Math.min(WARMUP_TRIALS, trialsToAdd);
    set({
      events: [],
      trials: buildTrials(warmupCount, _refs.adaptiveParams),
      maxTrials: trialsToAdd,
      trialIndex: 0,
      additionalTrials: trialsToAdd,
      status: "waiting",
      phase: "extension",
    });
  },

  restartMain: () => {
    const { _refs, maxTrials } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.maxTrials = maxTrials;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.difficultyEpochEventCount = 0;
    catStore.getState().resetForNewTask();
    const initialMainTrials = Math.min(WARMUP_TRIALS, maxTrials);
    set({
      phase: "main",
      status: "waiting",
      trialIndex: 0,
      trials: buildTrials(initialMainTrials, _refs.adaptiveParams),
      events: [],
      mainReinstruction: false,
    });
  },

  finishMain: async () => {
    const { sessionId, _refs, phase } = get();
    if (phase !== "main" && phase !== "extension") {
      return false;
    }
    if (!sessionId) {
      set({ phase: "complete" });
      return false;
    }
    const nDone = Math.max(1, _refs.events.length);
    const correct = _refs.events.filter((ev) => ev.is_correct === true).length;
    const accuracy = correct / nDone;
    /** Engine already validated Wilson error CI + cells before main_adaptive_stop; do not re-gate on cumulative accuracy. */
    const skipAccuracyGate = catStore.getState().blockEndTriggerReason === "main_adaptive_stop";
    if (!skipAccuracyGate && accuracy < 0.8) {
      if (accuracy < 0.5) {
        set({ phase: "instructions", mainReinstruction: false, practiceReinstruction: true });
        toast.error("Main accuracy below 50%. Instructions shown again before practice.");
      } else {
        get().resumePractice();
        toast.info("Main accuracy between 50% and 79%. Returning to practice.");
      }
      return false;
    }
    try {
      if (_refs.events.length > 0) {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      }
      await sessionsService.postBlocks(sessionId, {
        task_name: "flanker",
        block_index: 0,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreFlanker(sessionId);
      toast.success("Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    set({ phase: "complete", mainReinstruction: false });
    return true;
  },

  finishExtension: async () => {
    const { sessionId, _refs } = get();
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
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "flanker",
        block_index: 1,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreFlanker(sessionId);
      toast.success("Extension block complete. Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  cleanup: () => {
    const pauseAdvance = rtTrialStateAfterPauseCleanup(get());
    if (pauseAdvance) set(pauseAdvance);
    const { _refs } = get();
    if (_refs.timeoutId) {
      clearTimeout(_refs.timeoutId);
      _refs.timeoutId = null;
    }
    _refs.activeStimulusTrialIndex = null;
    _refs.stimulusOutcomeRecorded = false;
  },

  resumeAfterPause: () => {
    const s = get();
    if (s.phase !== "practice" && s.phase !== "main" && s.phase !== "extension") return;
    if (s.status !== "waiting") return;
    const trial = s.trials[s.trialIndex];
    if (trial) s.scheduleStimulus(trial, s.trialIndex);
  },

  prepareForFreshRun: () => {
    if (get().phase !== "complete") return;
    get().cleanup();
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.activeStimulusTrialIndex = null;
    _refs.stimulusOutcomeRecorded = false;
    _refs.timeoutId = null;
    _refs.blockStart = 0;
    _refs.events = [];
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.maxTrials = MAIN_TRIALS;
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.practiceEvents = [];
    _refs.practiceConfig = { ...PRACTICE_CONFIG };
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.difficultyEpochEventCount = 0;

    catStore.getState().resetForNewTask();

    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: MAIN_TRIALS,
      status: "waiting",
      events: [],
      additionalTrials: 0,
      practiceState: null,
      lastPracticeFeedback: null,
      practiceReinstruction: false,
      mainReinstruction: false,
      largeMainStimulus: false,
    });
  },
}));

export const CORRECT_KEYS_FLANKER = CORRECT_KEYS;
