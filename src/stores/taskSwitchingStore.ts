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
import { TASK_SWITCHING_ITEM_BANK } from "@/lib/itemBanks";
import { scoreTaskSwitching } from "@/lib/irtScoring";
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
import { buildTaskSwitchingCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused, rtTrialStateAfterPauseCleanup } from "@/lib/taskPauseGuard";

const MAIN_LIMITS = getMainTrialLimits("task_switching");
const MAIN_TRIALS = MAIN_LIMITS.maxTrials;
const RESPONSE_TIMEOUT_MS = 3000;
const WARMUP_TRIALS = ADAPTIVE_DEFAULTS.warmupTrials;

type TaskType = "letter" | "number";

const LETTER_LEFT = ["A", "E", "I", "O", "U"];
const LETTER_RIGHT = ["B", "C", "D", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "S", "T", "V", "W", "X", "Y", "Z"];
const NUMBER_LEFT = ["0", "2", "4", "6", "8"];
const NUMBER_RIGHT = ["1", "3", "5", "7", "9"];

function computeTaskSwitchingMetrics(
  events: Record<string, unknown>[],
  irtState?: IRTState,
): Record<string, unknown> {
  const switchEvents = events.filter((e) => typeof e.event_type === "string" && (e.event_type as string).includes("_switch"));
  const repeatEvents = events.filter((e) => typeof e.event_type === "string" && (e.event_type as string).includes("_repeat"));
  const switchRTs = switchEvents.filter((e) => e.reaction_time_ms != null).map((e) => e.reaction_time_ms as number);
  const repeatRTs = repeatEvents.filter((e) => e.reaction_time_ms != null).map((e) => e.reaction_time_ms as number);
  const meanSwitch = switchRTs.length > 0 ? switchRTs.reduce((a, b) => a + b, 0) / switchRTs.length : 0;
  const meanRepeat = repeatRTs.length > 0 ? repeatRTs.reduce((a, b) => a + b, 0) / repeatRTs.length : 0;
  const allRTs = [...switchRTs, ...repeatRTs];
  const mean = allRTs.length > 0 ? allRTs.reduce((a, b) => a + b, 0) / allRTs.length : 0;
  const sd = allRTs.length > 1
    ? Math.sqrt(allRTs.reduce((a, b) => a + (b - mean) ** 2, 0) / (allRTs.length - 1))
    : 0;
  return {
    switch_cost: meanSwitch - meanRepeat,
    switch_accuracy: switchEvents.length > 0 ? switchEvents.filter((e) => e.is_correct === true).length / switchEvents.length : 0,
    repeat_accuracy: repeatEvents.length > 0 ? repeatEvents.filter((e) => e.is_correct === true).length / repeatEvents.length : 0,
    accuracy: events.length > 0 ? events.filter((e) => e.is_correct === true).length / events.length : 0,
    rt_cov: mean > 0 ? sd / mean : 0,
    ...(irtState && {
      irt_theta: irtState.theta,
      irt_se: irtState.seTh,
      irt_responses_count: irtState.responses.length,
    }),
  };
}

export type TaskSwitchingPhase = "instructions" | "practice" | "main" | "extension" | "complete";

export type TaskSwitchingTrial = {
  foreperiod: number;
  task: TaskType;
  stimulus: string;
  correctKey: "ArrowLeft" | "ArrowRight";
  eventType: string;
};

type TSAdaptiveParams = {
  switchRatio: number;
  foreperiodMin: number;
  foreperiodMax: number;
};

/** Shared mutable state for tracking previous task across per-trial generation. */
let _prevTask: TaskType = Math.random() < 0.5 ? "letter" : "number";

function buildOneTrial(params: TSAdaptiveParams): TaskSwitchingTrial {
  const foreperiod = params.foreperiodMin + Math.random() * (params.foreperiodMax - params.foreperiodMin);
  const shouldSwitch = Math.random() < params.switchRatio;
  const task: TaskType = shouldSwitch ? (_prevTask === "letter" ? "number" : "letter") : _prevTask;
  const isSwitch = task !== _prevTask;
  _prevTask = task;

  const eventType = `${task}_${isSwitch ? "switch" : "repeat"}`;
  const goLeft = Math.random() < 0.5;
  let stimulus: string;
  let correctKey: "ArrowLeft" | "ArrowRight";

  if (task === "letter") {
    stimulus = goLeft
      ? LETTER_LEFT[Math.floor(Math.random() * LETTER_LEFT.length)]
      : LETTER_RIGHT[Math.floor(Math.random() * LETTER_RIGHT.length)];
    correctKey = goLeft ? "ArrowLeft" : "ArrowRight";
  } else {
    stimulus = goLeft
      ? NUMBER_LEFT[Math.floor(Math.random() * NUMBER_LEFT.length)]
      : NUMBER_RIGHT[Math.floor(Math.random() * NUMBER_RIGHT.length)];
    correctKey = goLeft ? "ArrowLeft" : "ArrowRight";
  }

  return { foreperiod, task, stimulus, correctKey, eventType };
}

function buildTrials(count: number, params: TSAdaptiveParams): TaskSwitchingTrial[] {
  _prevTask = Math.random() < 0.5 ? "letter" : "number";
  return Array.from({ length: count }, () => buildOneTrial(params));
}

function adaptTS(params: TSAdaptiveParams, perf: PerformanceModel): TSAdaptiveParams {
  if (perf.totalTrials < WARMUP_TRIALS) return params;

  let { switchRatio, foreperiodMin, foreperiodMax } = params;

  // Switch accuracy across all switch event types
  const switchKeys = Object.keys(perf.conditionAccuracy).filter((k) => k.includes("_switch"));
  if (switchKeys.length > 0) {
    const switchAccSum = switchKeys.reduce((s, k) => s + (perf.conditionAccuracy[k] ?? 0), 0);
    const switchAcc = switchAccSum / switchKeys.length;
    if (switchAcc > 0.85) {
      switchRatio = clamp(switchRatio + 0.02, 0.3, 0.8);
    } else if (switchAcc < 0.6) {
      switchRatio = clamp(switchRatio - 0.02, 0.3, 0.8);
    }
  }

  // Foreperiod based on rtCoV
  if (perf.rtCoV > 0.3) {
    foreperiodMax = clamp(foreperiodMax + 50, foreperiodMin + 300, 3500);
    foreperiodMin = clamp(foreperiodMin + 50, 400, foreperiodMax - 300);
  } else if (perf.rtCoV < 0.15) {
    foreperiodMin = clamp(foreperiodMin - 50, 400, foreperiodMax - 300);
    foreperiodMax = clamp(foreperiodMax - 50, foreperiodMin + 300, 3500);
  }

  return { switchRatio, foreperiodMin, foreperiodMax };
}

type Refs = {
  stimulusOnset: number;
  activeStimulusTrialIndex: number | null;
  stimulusOutcomeRecorded: boolean;
  blockStart: number;
  events: Record<string, unknown>[];
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  timeoutId: ReturnType<typeof setTimeout> | null;
  perfModel: PerformanceModel;
  adaptiveParams: TSAdaptiveParams;
  maxTrials: number;
  irtState: IRTState;
  currentIRTItem: IRTItem | null;
  mainAdaptiveHistory: AdaptiveHistory;
  /** Main/extension trials since last adaptive difficulty change (≥24 required before stable stop). */
  trialsSinceDifficultyChange: number;
  /** Clears {@link TaskSwitchingState.specReinstructionBanner} after this many scored trials. */
  reinstructionBannerRemaining: number;
};

type TaskSwitchingState = {
  phase: TaskSwitchingPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: TaskSwitchingTrial[];
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
  /** Brief rule reminder after engine lowers difficulty */
  specReinstructionBanner: string | null;
  addEvent: (ev: Record<string, unknown>) => void;
  addPracticeEvent: (ev: Record<string, unknown>) => void;
  scheduleStimulus: (trial: TaskSwitchingTrial, idx: number) => void;
  recordResponse: (responseKey: string, isCorrect: boolean) => void;
  startPractice: () => Promise<void>;
  resumePractice: () => void;
  finishPractice: () => Promise<void>;
  startMain: () => Promise<void>;
  restartMain: () => void;
  startExtension: (trialsToAdd: number) => void;
  finishMain: () => Promise<boolean>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

const defaultAdaptiveParams: TSAdaptiveParams = {
  switchRatio: ADAPTIVE_DEFAULTS.taskSwitching.switchRatio,
  foreperiodMin: ADAPTIVE_DEFAULTS.taskSwitching.foreperiodMin,
  foreperiodMax: ADAPTIVE_DEFAULTS.taskSwitching.foreperiodMax,
};

export const taskSwitchingStore = create<TaskSwitchingState>((set, get) => ({
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
  specReinstructionBanner: null,
  _refs: {
    stimulusOnset: 0,
    activeStimulusTrialIndex: null,
    stimulusOutcomeRecorded: false,
    blockStart: 0,
    events: [],
    practiceEvents: [],
    practiceConfig: { ...PRACTICE_CONFIG },
    timeoutId: null,
    perfModel: createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize),
    adaptiveParams: { ...defaultAdaptiveParams },
    maxTrials: MAIN_TRIALS,
    irtState: createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD),
    currentIRTItem: null,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    trialsSinceDifficultyChange: 0,
    reinstructionBannerRemaining: 0,
  },

  addEvent: (ev) => {
    const { sessionId, trialIndex, phase } = get();
    catStore.getState().addTrial({
      reaction_time_ms: (ev.reaction_time_ms as number | null | undefined) ?? null,
      expected_response: true,
    });
    set((s) => {
      const next = [...s.events, ev];
      get()._refs.events = next;
      return { events: next };
    });

    if (phase === "main" || phase === "extension") {
      const r = get()._refs;
      r.trialsSinceDifficultyChange += 1;
      if (r.reinstructionBannerRemaining > 0) {
        r.reinstructionBannerRemaining -= 1;
        if (r.reinstructionBannerRemaining === 0) {
          set({ specReinstructionBanner: null });
        }
      }

      const cp = buildTaskSwitchingCheckpoint(r.events, get().maxTrials, {
        trialsAtCurrentDifficulty: r.trialsSinceDifficultyChange,
      });
      const stopResult = tryMainAdaptiveStop(
        "task_switching",
        cp,
        r.mainAdaptiveHistory,
        getSessionAdaptiveBounds("task_switching", r.maxTrials),
      );
      r.mainAdaptiveHistory = stopResult.history;

      const decision = stopResult.evaluation?.decision;
      if (decision === "adjust_difficulty_up") {
        r.adaptiveParams.switchRatio = clamp(r.adaptiveParams.switchRatio + 0.05, 0.35, 0.75);
        r.trialsSinceDifficultyChange = 0;
      } else if (decision === "adjust_difficulty_down") {
        r.adaptiveParams.switchRatio = clamp(r.adaptiveParams.switchRatio - 0.05, 0.35, 0.75);
        r.trialsSinceDifficultyChange = 0;
        r.reinstructionBannerRemaining = 10;
        set({
          specReinstructionBanner:
            "Reminder: ← vowels or even digits; → consonants or odd digits. Decide letter vs number on each trial before responding.",
        });
      }

      if (catStore.getState().shouldTriggerBlockEnd) {
        return;
      }
    }

    // Check for mid-task LLM checkpoint
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "task_switching", trialIndex + 1, computeTaskSwitchingMetrics(events, get()._refs.irtState));
    }

    // Per-trial adaptation + IRT
    if (phase === "main" || phase === "extension") {
      const refs = get()._refs;
      refs.perfModel = updatePerformanceModel(refs.perfModel, ev);
      refs.adaptiveParams = adaptTS(refs.adaptiveParams, refs.perfModel);

      // IRT: dichotomize, update theta
      if (refs.currentIRTItem) {
        const score = scoreTaskSwitching(ev);
        refs.irtState = updateIRTState(
          refs.irtState,
          refs.currentIRTItem.id,
          refs.currentIRTItem.difficulty,
          refs.currentIRTItem.discrimination,
          score,
        );
        // No SE-theta early stop in simple threshold mode.
      }

      const s = get();
      const nextIdx = s.trialIndex + 1;
      if (
        !catStore.getState().shouldTriggerBlockEnd &&
        nextIdx < refs.maxTrials &&
        s.trials.length <= nextIdx
      ) {
        let nextTrial: TaskSwitchingTrial;

        if (refs.irtState.responses.length >= IRT_CONFIG.irtWarmupTrials) {
          const item = selectNextItem(TASK_SWITCHING_ITEM_BANK, refs.irtState.theta, refs.irtState.administeredItemIds);
          refs.currentIRTItem = item;
          const fpCenter = item.params.foreperiodCenter as number;
          const isSwitch = item.params.isSwitch as boolean;
          // Determine task: if isSwitch, flip from _prevTask; otherwise use _prevTask
          const task: TaskType = isSwitch
            ? (_prevTask === "letter" ? "number" : "letter")
            : _prevTask;
          _prevTask = task;
          const eventType = `${task}_${isSwitch ? "switch" : "repeat"}`;
          const goLeft = Math.random() < 0.5;
          let stimulus: string;
          let correctKey: "ArrowLeft" | "ArrowRight";
          if (task === "letter") {
            stimulus = goLeft
              ? LETTER_LEFT[Math.floor(Math.random() * LETTER_LEFT.length)]
              : LETTER_RIGHT[Math.floor(Math.random() * LETTER_RIGHT.length)];
            correctKey = goLeft ? "ArrowLeft" : "ArrowRight";
          } else {
            stimulus = goLeft
              ? NUMBER_LEFT[Math.floor(Math.random() * NUMBER_LEFT.length)]
              : NUMBER_RIGHT[Math.floor(Math.random() * NUMBER_RIGHT.length)];
            correctKey = goLeft ? "ArrowLeft" : "ArrowRight";
          }
          const jitterRange = (refs.adaptiveParams.foreperiodMax - refs.adaptiveParams.foreperiodMin) * 0.15;
          const jitter = (Math.random() - 0.5) * jitterRange;
          nextTrial = {
            foreperiod: Math.max(300, fpCenter + jitter),
            task,
            stimulus,
            correctKey,
            eventType,
          };
        } else {
          refs.currentIRTItem = null;
          nextTrial = buildOneTrial(refs.adaptiveParams);
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
              ? "Use ← for vowel/even, → for consonant/odd."
              : "Tip: pay attention to which rule applies on this trial before responding.",
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
          if (!catStore.getState().shouldTriggerBlockEnd) {
            set({ status: "waiting", trialIndex: idx + 1 });
          } else {
            set({ status: "waiting" });
          }
          _refs.timeoutId = null;
          return;
        }
        if (r.activeStimulusTrialIndex !== idx || r.stimulusOutcomeRecorded) return;
        r.stimulusOutcomeRecorded = true;
        const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
        recordEvent({
          task_name: "task_switching",
          trial_index: idx,
          stimulus_onset_ms: _refs.stimulusOnset,
          keypress_ms: null,
          reaction_time_ms: null,
          response_key: null,
          correct_key: trial.correctKey,
          is_correct: false,
          event_type: trial.eventType,
          isi_ms: trial.foreperiod,
        });
        const s = get();
        if (s.phase !== phase || s.trialIndex !== idx) return;
        if (!catStore.getState().shouldTriggerBlockEnd) {
          set({ status: "waiting", trialIndex: idx + 1 });
        } else {
          set({ status: "waiting" });
        }
        const afterAdvance = get();
        const nextIdx = idx + 1;
        if (
          (phase === "main" || phase === "extension")
          && !catStore.getState().shouldTriggerBlockEnd
          && nextIdx < afterAdvance._refs.maxTrials
          && afterAdvance.trials.length <= nextIdx
        ) {
          const nextTrial = buildOneTrial(afterAdvance._refs.adaptiveParams);
          set((prev) => ({ trials: [...prev.trials, nextTrial] }));
        }
        _refs.timeoutId = null;
      }, RESPONSE_TIMEOUT_MS);
    }, trial.foreperiod);
  },

  recordResponse: (responseKey, isCorrect) => {
    const { _refs, trials, trialIndex, phase, status, addEvent, addPracticeEvent } = get();
    const trial = trials[trialIndex];
    if (!trial || status !== "stimulus") return;
    if (_refs.activeStimulusTrialIndex !== trialIndex || _refs.stimulusOutcomeRecorded) return;
    _refs.stimulusOutcomeRecorded = true;

    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
    recordEvent({
      task_name: "task_switching",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: performance.now(),
      reaction_time_ms: performance.now() - _refs.stimulusOnset,
      response_key: responseKey,
      correct_key: trial.correctKey,
      is_correct: isCorrect,
      event_type: trial.eventType,
      isi_ms: trial.foreperiod,
    });

    const s = get();
    if (s.phase !== phase || s.trialIndex !== trialIndex) return;
    if (phase === "main" || phase === "extension") {
      if (_refs.timeoutId) {
        clearTimeout(_refs.timeoutId);
        _refs.timeoutId = null;
      }
      if (!catStore.getState().shouldTriggerBlockEnd) {
        set({ status: "waiting", trialIndex: trialIndex + 1 });
      } else {
        set({ status: "waiting" });
      }
    } else {
      set({ status: "responded" });
    }

    const afterAdvance = get();
    const nextIdx = trialIndex + 1;
    if (
      (phase === "main" || phase === "extension")
      && !catStore.getState().shouldTriggerBlockEnd
      && nextIdx < afterAdvance._refs.maxTrials
      && afterAdvance.trials.length <= nextIdx
    ) {
      const nextTrial = buildOneTrial(afterAdvance._refs.adaptiveParams);
      set((prev) => ({ trials: [...prev.trials, nextTrial] }));
    }
  },

  startPractice: async () => {
    const { _refs } = get();
    catStore.getState().resetForNewTask();
    try {
      const res = await sessionsService.create("task_switching");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "task_switching");

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
      });
    } catch {
      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceEvents = [];
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
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
        const res = await sessionsService.create("task_switching");
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
          task_name: "task_switching",
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
      _refs.trialsSinceDifficultyChange = 0;
      _refs.reinstructionBannerRemaining = 0;
      catStore.getState().resetForNewTask();

      const config = await catStore.getState().loadTaskConfig(sid, "task_switching");
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
        specReinstructionBanner: null,
      });
      toast.success("Practice complete. Starting main task.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start task");
    }
  },

  startMain: async () => {
    const { _refs, sessionId } = get();
    _refs.events = [];
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.trialsSinceDifficultyChange = 0;
    _refs.reinstructionBannerRemaining = 0;
    catStore.getState().resetForNewTask();

    let trialCount: number = MAIN_TRIALS;
    let initialTrials = Math.min(WARMUP_TRIALS, MAIN_TRIALS);
    if (sessionId) {
      const config = await catStore.getState().loadTaskConfig(sessionId, "task_switching");
      if (config) {
        trialCount = config.max_trials;
        initialTrials = Math.min(WARMUP_TRIALS, config.max_trials);
      }
    }
    _refs.maxTrials = trialCount;

    set({
      trials: buildTrials(initialTrials, _refs.adaptiveParams),
      maxTrials: trialCount,
      trialIndex: 0,
      phase: "main",
      status: "waiting",
      events: [],
      mainReinstruction: false,
      specReinstructionBanner: null,
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
    _refs.trialsSinceDifficultyChange = 0;
    _refs.reinstructionBannerRemaining = 0;
    catStore.getState().resetForNewTask();
    const initialMainTrials = Math.min(WARMUP_TRIALS, maxTrials);
    set({
      trials: buildTrials(initialMainTrials, _refs.adaptiveParams),
      maxTrials,
      trialIndex: 0,
      phase: "main",
      status: "waiting",
      events: [],
      mainReinstruction: false,
      specReinstructionBanner: null,
    });
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
    _refs.trialsSinceDifficultyChange = 0;
    _refs.reinstructionBannerRemaining = 0;
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
      specReinstructionBanner: null,
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
    try {
      if (_refs.events.length > 0) {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      }
      await sessionsService.postBlocks(sessionId, {
        task_name: "task_switching",
        block_index: 0,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreTaskSwitching(sessionId);
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
        task_name: "task_switching",
        block_index: 1,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreTaskSwitching(sessionId);
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
    _prevTask = Math.random() < 0.5 ? "letter" : "number";
    get().cleanup();
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.activeStimulusTrialIndex = null;
    _refs.stimulusOutcomeRecorded = false;
    _refs.blockStart = 0;
    _refs.events = [];
    _refs.practiceEvents = [];
    _refs.timeoutId = null;
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...defaultAdaptiveParams };
    _refs.maxTrials = MAIN_TRIALS;
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.currentIRTItem = null;
    _refs.practiceConfig = { ...PRACTICE_CONFIG };
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.trialsSinceDifficultyChange = 0;
    _refs.reinstructionBannerRemaining = 0;

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
      specReinstructionBanner: null,
    });
  },
}));
