import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { weightedRandomPick } from "@/lib/adaptiveEngine";
import { ADAPTIVE_DEFAULTS, getMainTrialLimits, PRACTICE_CONFIG } from "@/config/catConfig";
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
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildChoiceRtCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused, rtTrialStateAfterPauseCleanup } from "@/lib/taskPauseGuard";

const MAIN_LIMITS = getMainTrialLimits("choice_rt");
const MAIN_TRIALS = MAIN_LIMITS.maxTrials;
const RESPONSE_TIMEOUT_MS = 2000;
const WARMUP_TRIALS = ADAPTIVE_DEFAULTS.warmupTrials;

/** All scored CRT trials sample uniformly from four directions (weights from `directionWeights`). */
const CRT_DIRECTION_POOL = ["left", "right", "up", "down"] as const;
const PRACTICE_DIRECTIONS = CRT_DIRECTION_POOL;
type Direction = "left" | "right" | "up" | "down";

const CORRECT_KEYS: Record<Direction, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
};

function computeCrtMetrics(events: Record<string, unknown>[]): Record<string, unknown> {
  const rts = events
    .map((e) => e.reaction_time_ms as number | null)
    .filter((rt): rt is number => rt != null);
  const mean = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
  const sd = rts.length > 1
    ? Math.sqrt(rts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rts.length - 1))
    : 0;
  return {
    mean_rt: mean,
    accuracy: events.length > 0 ? events.filter((e) => e.is_correct === true).length / events.length : 0,
    rt_cov: mean > 0 ? sd / mean : 0,
  };
}

export type CRTPhase = "instructions" | "practice" | "main" | "extension" | "complete";

export type CRTTrial = { foreperiod: number; direction: Direction };

type CRTAdaptiveParams = {
  foreperiodMin: number;
  foreperiodMax: number;
  directionWeights: Record<string, number>;
};

function buildOneTrial(params: CRTAdaptiveParams, dirs: readonly Direction[]): CRTTrial {
  const weights = dirs.map((d) => params.directionWeights[d] ?? 1);
  const direction = weightedRandomPick([...dirs], weights) as Direction;
  return {
    foreperiod: params.foreperiodMin + Math.random() * (params.foreperiodMax - params.foreperiodMin),
    direction,
  };
}

function buildTrials(count: number, params: CRTAdaptiveParams, dirs: readonly Direction[]): CRTTrial[] {
  return Array.from({ length: count }, () => buildOneTrial(params, dirs));
}

type Refs = {
  stimulusOnset: number;
  activeStimulusTrialIndex: number | null;
  stimulusOutcomeRecorded: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  blockStart: number;
  events: Record<string, unknown>[];
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  maxTrials: number;
  mainAdaptiveHistory: AdaptiveHistory;
};

type CRTState = {
  phase: CRTPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: CRTTrial[];
  maxTrials: number;
  status: "waiting" | "stimulus" | "responded";
  events: Record<string, unknown>[];
  _refs: Refs;
  additionalTrials: number;
  /** When true, checkpoint allows engine CRT extended-mode logic (legacy; direction pool is always four-way). */
  extendedFeatureEnabled: boolean;
  /** Main/extension: true so checkpoints report expanded direction set; engine skips CRT `adjust_difficulty_up`. */
  threeChoiceActive: boolean;
  practiceState: PracticeState | null;
  lastPracticeFeedback: PracticeEvent["errorType"] | null;
  practiceReinstruction: boolean;
  practiceReinstructionLevel: PracticeReinstructionLevel | null;
  practiceReinstructionHint: string | null;
  mainReinstruction: boolean;
  addEvent: (ev: Record<string, unknown>) => void;
  addPracticeEvent: (ev: Record<string, unknown>) => void;
  scheduleStimulus: (foreperiod: number, idx: number, direction: Direction) => void;
  recordResponse: (responseKey: string, isCorrect: boolean) => void;
  startPractice: () => Promise<void>;
  resumePractice: () => void;
  restartMain: () => void;
  finishPractice: () => Promise<void>;
  startMain: () => Promise<void>;
  startExtension: (trialsToAdd: number) => void;
  finishMain: () => Promise<boolean>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

const defaultAdaptiveParams: CRTAdaptiveParams = {
  foreperiodMin: ADAPTIVE_DEFAULTS.crt.foreperiodMin,
  foreperiodMax: ADAPTIVE_DEFAULTS.crt.foreperiodMax,
  directionWeights: { ...ADAPTIVE_DEFAULTS.crt.directionWeights },
};

export const crtStore = create<CRTState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: MAIN_TRIALS,
  status: "waiting",
  events: [],
  additionalTrials: 0,
  extendedFeatureEnabled: true,
  threeChoiceActive: false,
  practiceState: null,
  lastPracticeFeedback: null,
  practiceReinstruction: false,
  practiceReinstructionLevel: null,
  practiceReinstructionHint: null,
  mainReinstruction: false,
  _refs: {
    stimulusOnset: 0,
    activeStimulusTrialIndex: null,
    stimulusOutcomeRecorded: false,
    timeoutId: null,
    blockStart: 0,
    events: [],
    practiceEvents: [],
    practiceConfig: { ...PRACTICE_CONFIG },
    maxTrials: MAIN_TRIALS,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
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
      const completed = r.events.length;
      if (completed >= Math.max(1, get().maxTrials)) {
        catStore.getState().setBlockEndTrigger("session_max_trials");
      }
      const cp = buildChoiceRtCheckpoint(r.events, get().maxTrials, {
        extendedFeatureEnabled: get().extendedFeatureEnabled,
        threeChoiceActive: get().threeChoiceActive,
      });
      const stopResult = tryMainAdaptiveStop(
        "choice_rt",
        cp,
        r.mainAdaptiveHistory,
        r.maxTrials,
      );
      r.mainAdaptiveHistory = stopResult.history;
    }

    // Check for mid-task LLM checkpoint
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "choice_rt", trialIndex + 1, computeCrtMetrics(events));
    }

    /** Fixed timing mix; four-direction trials (no IRT / foreperiod adaptation). */
    if (phase === "main" || phase === "extension") {
      const refs = get()._refs;
      const s = get();
      const nextIdx = s.trialIndex + 1;
      if (
        !catStore.getState().shouldTriggerBlockEnd &&
        nextIdx < refs.maxTrials &&
        s.trials.length <= nextIdx
      ) {
        const nextTrial = buildOneTrial(defaultAdaptiveParams, CRT_DIRECTION_POOL);
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
            trials: [...get().trials, ...buildTrials(nextBlockSize, defaultAdaptiveParams, PRACTICE_DIRECTIONS)],
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
              ? "Press the arrow key that matches the arrow direction you see."
              : "Tip: focus on accuracy first, then speed up.",
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
            trials: [...get().trials, ...buildTrials(config.finalTrialCount, defaultAdaptiveParams, PRACTICE_DIRECTIONS)],
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

  scheduleStimulus: (foreperiod, idx, direction) => {
    if (isTaskPaused()) return;
    const { phase } = get();
    if (
      (phase === "main" || phase === "extension") &&
      catStore.getState().shouldTriggerBlockEnd
    ) {
      return;
    }
    const { _refs } = get();
    if (_refs.timeoutId) clearTimeout(_refs.timeoutId);

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
          task_name: "choice_rt",
          trial_index: idx,
          stimulus_onset_ms: _refs.stimulusOnset,
          keypress_ms: null,
          reaction_time_ms: null,
          response_key: null,
          correct_key: CORRECT_KEYS[direction],
          is_correct: false,
          event_type: direction,
          isi_ms: foreperiod,
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
        _refs.timeoutId = null;
      }, RESPONSE_TIMEOUT_MS);
    }, foreperiod);
  },

  recordResponse: (responseKey, isCorrect) => {
    const { _refs, trials, trialIndex, phase, status, addEvent, addPracticeEvent } = get();
    const trial = trials[trialIndex];
    if (!trial || status !== "stimulus") return;
    if (_refs.activeStimulusTrialIndex !== trialIndex || _refs.stimulusOutcomeRecorded) return;
    _refs.stimulusOutcomeRecorded = true;

    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
    recordEvent({
      task_name: "choice_rt",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: performance.now(),
      reaction_time_ms: performance.now() - _refs.stimulusOnset,
      response_key: responseKey,
      correct_key: CORRECT_KEYS[trial.direction],
      is_correct: isCorrect,
      event_type: trial.direction,
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
  },

  startPractice: async () => {
    const { _refs } = get();
    catStore.getState().resetForNewTask();
    try {
      const res = await sessionsService.create("choice_rt");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "choice_rt");

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
        trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams, PRACTICE_DIRECTIONS),
        trialIndex: 0,
        phase: "practice",
        status: "waiting",
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
        threeChoiceActive: false,
      });
    } catch {
      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceEvents = [];
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
      set({
        trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams, PRACTICE_DIRECTIONS),
        trialIndex: 0,
        phase: "practice",
        status: "waiting",
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
        threeChoiceActive: false,
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
      trials: buildTrials(initialPracticeBlockSize, defaultAdaptiveParams, PRACTICE_DIRECTIONS),
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
      threeChoiceActive: false,
    });
  },

  finishPractice: async () => {
    const { _refs, practiceState } = get();
    await new Promise((r) => setTimeout(r, PRACTICE_FEEDBACK_FINISH_DELAY_MS));
    set({ trials: [], trialIndex: 0 });
    try {
      let sid = get().sessionId;
      if (!sid) {
        const res = await sessionsService.create("choice_rt");
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
          task_name: "choice_rt",
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
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      catStore.getState().resetForNewTask();

      const config = await catStore.getState().loadTaskConfig(sid, "choice_rt");
      const trialCount = config?.max_trials ?? MAIN_TRIALS;
      const initialTrials = Math.min(WARMUP_TRIALS, trialCount);
      _refs.maxTrials = trialCount;

      set({
        phase: "main",
        trials: buildTrials(initialTrials, defaultAdaptiveParams, CRT_DIRECTION_POOL),
        maxTrials: trialCount,
        trialIndex: 0,
        status: "waiting",
        events: [],
        mainReinstruction: false,
        threeChoiceActive: true,
      });
      toast.success("Practice complete. Starting main task.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start task");
    }
  },

  startMain: async () => {
    const { _refs, sessionId } = get();
    _refs.events = [];
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();

    let trialCount: number = MAIN_TRIALS;
    let initialTrials = Math.min(WARMUP_TRIALS, MAIN_TRIALS);
    if (sessionId) {
      const config = await catStore.getState().loadTaskConfig(sessionId, "choice_rt");
      if (config) {
        trialCount = config.max_trials;
        initialTrials = Math.min(WARMUP_TRIALS, config.max_trials);
      }
    }
    _refs.maxTrials = trialCount;

    set({
      trials: buildTrials(initialTrials, defaultAdaptiveParams, CRT_DIRECTION_POOL),
      maxTrials: trialCount,
      trialIndex: 0,
      phase: "main",
      status: "waiting",
      events: [],
      threeChoiceActive: true,
    });
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.maxTrials = trialsToAdd;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();

    set({
      events: [],
      trials: buildTrials(Math.min(WARMUP_TRIALS, trialsToAdd), defaultAdaptiveParams, CRT_DIRECTION_POOL),
      maxTrials: trialsToAdd,
      trialIndex: 0,
      additionalTrials: trialsToAdd,
      status: "waiting",
      phase: "extension",
      threeChoiceActive: true,
    });
  },

  restartMain: () => {
    const { _refs, maxTrials } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.maxTrials = maxTrials;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    set({
      trials: buildTrials(Math.min(WARMUP_TRIALS, maxTrials), defaultAdaptiveParams, CRT_DIRECTION_POOL),
      maxTrials,
      trialIndex: 0,
      phase: "main",
      status: "waiting",
      events: [],
      mainReinstruction: false,
      threeChoiceActive: true,
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
    const n = _refs.events.length;
    if (n === 0) {
      set({ phase: "complete", mainReinstruction: false });
      return false;
    }
    try {
      if (_refs.events.length > 0) {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      }
      await sessionsService.postBlocks(sessionId, {
        task_name: "choice_rt",
        block_index: 0,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreChoiceRt(sessionId);
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
        task_name: "choice_rt",
        block_index: 1,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreChoiceRt(sessionId);
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
    if (trial) s.scheduleStimulus(trial.foreperiod, s.trialIndex, trial.direction);
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.activeStimulusTrialIndex = null;
    _refs.stimulusOutcomeRecorded = false;
    _refs.timeoutId = null;
    _refs.blockStart = 0;
    _refs.events = [];
    _refs.practiceEvents = [];
    _refs.maxTrials = MAIN_TRIALS;
    _refs.practiceConfig = { ...PRACTICE_CONFIG };
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();

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
      extendedFeatureEnabled: true,
      threeChoiceActive: false,
      practiceState: null,
      lastPracticeFeedback: null,
      practiceReinstruction: false,
      mainReinstruction: false,
    });
  },
}));

export const CORRECT_KEYS_CRT = CORRECT_KEYS;
