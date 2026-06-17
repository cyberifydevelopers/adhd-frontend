import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { createPerformanceModel, type PerformanceModel } from "@/lib/adaptiveEngine";
import { ADAPTIVE_DEFAULTS, getMainTrialLimits, IRT_CONFIG, PRACTICE_CONFIG } from "@/config/catConfig";
import { createIRTState, type IRTState } from "@/lib/irtEngine";
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
import { buildSimpleRtLikeCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused, rtTrialStateAfterPauseCleanup } from "@/lib/taskPauseGuard";

const MAIN_LIMITS = getMainTrialLimits("simple_rt");
const MAIN_TRIALS = MAIN_LIMITS.maxTrials;
const RESPONSE_TIMEOUT_MS = 2000;
const WARMUP_TRIALS = ADAPTIVE_DEFAULTS.warmupTrials;

function computeSrtMetrics(
  events: Record<string, unknown>[],
  irtState?: IRTState,
): Record<string, unknown> {
  const rts = events
    .map((e) => e.reaction_time_ms as number | null)
    .filter((rt): rt is number => rt != null);
  const mean = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
  const sd = rts.length > 1
    ? Math.sqrt(rts.reduce((a, b) => a + (b - mean) ** 2, 0) / (rts.length - 1))
    : 0;
  return {
    mean_rt: mean,
    rt_cov: mean > 0 ? sd / mean : 0,
    accuracy: events.length > 0 ? events.filter((e) => e.is_correct === true).length / events.length : 0,
    ...(irtState && {
      irt_theta: irtState.theta,
      irt_se: irtState.seTh,
      irt_responses_count: irtState.responses.length,
    }),
  };
}

export type SRTPhase = "instructions" | "practice" | "main" | "extension" | "complete";

export type SRTTrial = { foreperiod: number; isCatchTrial?: boolean };

type SRTAdaptiveParams = {
  foreperiodMin: number;
  foreperiodMax: number;
  catchTrialRate: number;
};

function buildOneTrial(params: SRTAdaptiveParams): SRTTrial {
  const isCatch = Math.random() < params.catchTrialRate;
  return {
    foreperiod: params.foreperiodMin + Math.random() * (params.foreperiodMax - params.foreperiodMin),
    isCatchTrial: isCatch || undefined,
  };
}

function buildTrials(count: number, params: SRTAdaptiveParams): SRTTrial[] {
  return Array.from({ length: count }, () => buildOneTrial(params));
}

type Refs = {
  stimulusOnset: number;
  /** Current trial index while stimulus is on-screen; guards double scoring (repeat keys / overlapping timers). */
  activeStimulusTrialIndex: number | null;
  stimulusOutcomeRecorded: boolean;
  blockStart: number;
  events: Record<string, unknown>[];
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  timeoutId: ReturnType<typeof setTimeout> | null;
  perfModel: PerformanceModel;
  adaptiveParams: SRTAdaptiveParams;
  maxTrials: number;
  irtState: IRTState;
  mainAdaptiveHistory: AdaptiveHistory;
};

type SRTState = {
  phase: SRTPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: SRTTrial[];
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
  addEvent: (ev: Record<string, unknown>) => void;
  addPracticeEvent: (ev: Record<string, unknown>) => void;
  scheduleStimulus: (foreperiod: number, idx: number) => void;
  recordResponse: () => void;
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

const defaultAdaptiveParams: SRTAdaptiveParams = {
  foreperiodMin: ADAPTIVE_DEFAULTS.srt.foreperiodMin,
  foreperiodMax: ADAPTIVE_DEFAULTS.srt.foreperiodMax,
  catchTrialRate: ADAPTIVE_DEFAULTS.srt.catchTrialRate,
};

/** Scored main/extension: spec random fixation 500–1500 ms, no adaptive foreperiod or catch manipulation. */
const MAIN_SRT_TIMING: SRTAdaptiveParams = {
  foreperiodMin: 500,
  foreperiodMax: 1500,
  catchTrialRate: 0,
};

export const srtStore = create<SRTState>((set, get) => ({
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
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
  },

  addEvent: (ev) => {
    catStore.getState().addTrial({
      reaction_time_ms: (ev.reaction_time_ms as number | null | undefined) ?? null,
      expected_response: true,
    });
    set((s) => {
      const next = [...s.events, ev];
      get()._refs.events = next;
      return { events: next };
    });

    // Main / extension: main adaptive engine (not practice).
    // Do not use shouldStopEarlyAtPass here — every responded go trial is marked correct, so accuracy hits 80%+ after 1–2 trials and would falsely fire ci_converged. Early stop is tryMainAdaptiveStop only; max trials ends via trial list exhaustion.
    if (get().phase === "main" || get().phase === "extension") {
      const r = get()._refs;
      const cp = buildSimpleRtLikeCheckpoint(r.events, get().maxTrials);
      r.mainAdaptiveHistory = tryMainAdaptiveStop(
        "simple_rt",
        cp,
        r.mainAdaptiveHistory,
        r.maxTrials,
      ).history;
    }

    // Check for mid-task LLM checkpoint
    const { sessionId, trialIndex, phase } = get();
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "simple_rt", trialIndex + 1, computeSrtMetrics(events, get()._refs.irtState));
    }

    // Main/extension: fixed-spec randomized fixation only (no IRT foreperiod adaptation or performance-based timing).
    if (phase === "main" || phase === "extension") {
      const refs = get()._refs;
      const s = get();
      const nextIdx = s.trialIndex + 1;
      if (
        !catStore.getState().shouldTriggerBlockEnd &&
        nextIdx < refs.maxTrials &&
        s.trials.length <= nextIdx
      ) {
        refs.adaptiveParams = { ...MAIN_SRT_TIMING };
        const nextTrial = buildOneTrial(MAIN_SRT_TIMING);
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
      else if (rt < 100) errorType = "premature";
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
              ? "Wait for the stimulus before responding."
              : "Remember: press only when the stimulus appears (don’t guess).",
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

  scheduleStimulus: (foreperiod, idx) => {
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
          set({ status: "waiting", trialIndex: idx + 1 });
          _refs.timeoutId = null;
          return;
        }
        if (r.activeStimulusTrialIndex !== idx || r.stimulusOutcomeRecorded) return;
        r.stimulusOutcomeRecorded = true;
        const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
        recordEvent({
          task_name: "simple_rt",
          trial_index: idx,
          stimulus_onset_ms: _refs.stimulusOnset,
          keypress_ms: null,
          reaction_time_ms: null,
          response_key: null,
          correct_key: " ",
          is_correct: false,
          event_type: "go",
          isi_ms: foreperiod,
        });
        const s = get();
        // If practice evaluation already advanced/reset phase or trial index, do not overwrite it.
        if (s.phase !== phase || s.trialIndex !== idx) return;
        if (
          (phase === "main" || phase === "extension") &&
          catStore.getState().shouldTriggerBlockEnd
        ) {
          set({ status: "waiting" });
        } else {
          set({ status: "waiting", trialIndex: idx + 1 });
        }
      }, RESPONSE_TIMEOUT_MS);
    }, foreperiod);
  },

  recordResponse: () => {
    const { _refs, trials, trialIndex, phase, status, addEvent, addPracticeEvent } = get();
    const trial = trials[trialIndex];
    if (!trial || status !== "stimulus") return;
    if (_refs.activeStimulusTrialIndex !== trialIndex || _refs.stimulusOutcomeRecorded) return;
    _refs.stimulusOutcomeRecorded = true;

    const keypressMs = performance.now();
    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;
    recordEvent({
      task_name: "simple_rt",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: keypressMs,
      reaction_time_ms: keypressMs - _refs.stimulusOnset,
      response_key: " ",
      correct_key: " ",
      is_correct: true,
      event_type: "go",
      isi_ms: trial.foreperiod,
    });

    const s = get();
    // Guard against stale write after practice engine changes phase/block.
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
      const res = await sessionsService.create("simple_rt");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "simple_rt");

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
      // Fallback: use static PRACTICE_CONFIG if API fails
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
    await new Promise((r) => setTimeout(r, PRACTICE_FEEDBACK_FINISH_DELAY_MS));
    set({ trials: [], trialIndex: 0 });
    try {
      // Use existing session or create one if startPractice failed
      let sid = get().sessionId;
      if (!sid) {
        const res = await sessionsService.create("simple_rt");
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
          task_name: "simple_rt",
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
      _refs.adaptiveParams = { ...MAIN_SRT_TIMING };
      _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      catStore.getState().resetForNewTask();

      const config = await catStore.getState().loadTaskConfig(sid, "simple_rt");
      const trialCount = config?.max_trials ?? MAIN_TRIALS;
      const initialTrials = Math.min(WARMUP_TRIALS, trialCount);
      _refs.maxTrials = trialCount;

      set({
        phase: "main",
        trials: buildTrials(initialTrials, MAIN_SRT_TIMING),
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
    _refs.adaptiveParams = { ...MAIN_SRT_TIMING };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.maxTrials = trialsToAdd;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();

    const warmupCount = Math.min(WARMUP_TRIALS, trialsToAdd);
    set({
      events: [],
      trials: buildTrials(warmupCount, MAIN_SRT_TIMING),
      maxTrials: trialsToAdd,
      trialIndex: 0,
      additionalTrials: trialsToAdd,
      status: "waiting",
      phase: "extension",
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
        task_name: "simple_rt",
        block_index: 0,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreSimpleRt(sessionId);
      toast.success("Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    set({ phase: "complete", mainReinstruction: false });
    return true;
  },

  restartMain: () => {
    const { _refs, maxTrials } = get();
    _refs.blockStart = performance.now();
    _refs.events = [];
    _refs.perfModel = createPerformanceModel(ADAPTIVE_DEFAULTS.windowSize);
    _refs.adaptiveParams = { ...MAIN_SRT_TIMING };
    _refs.irtState = createIRTState(IRT_CONFIG.priorMean, IRT_CONFIG.priorSD);
    _refs.maxTrials = maxTrials;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    const initialMainTrials = Math.min(WARMUP_TRIALS, maxTrials);
    set({
      phase: "main",
      status: "waiting",
      trialIndex: 0,
      trials: buildTrials(initialMainTrials, MAIN_SRT_TIMING),
      events: [],
      mainReinstruction: false,
    });
  },

  finishExtension: async () => {
    const { sessionId, _refs } = get();
    if (!sessionId) {
      set({ phase: "complete" });
      return;
    }
    try {
      if (_refs.events.length > 0) {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
      }
      await sessionsService.postBlocks(sessionId, {
        task_name: "simple_rt",
        block_index: 1,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreSimpleRt(sessionId);
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
    if (trial) s.scheduleStimulus(trial.foreperiod, s.trialIndex);
  },

  prepareForFreshRun: () => {
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
      practiceState: null,
      lastPracticeFeedback: null,
      practiceReinstruction: false,
      mainReinstruction: false,
    });
  },
}));
