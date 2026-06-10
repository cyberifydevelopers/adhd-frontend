import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS, PRACTICE_CONFIG } from "@/config/catConfig";
import type { TaskTrialConfig } from "@/types/cat";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import {
  buildDelayDiscountingCheckpoint,
  computeDelayDiscountingCheckpointFields,
} from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";
import {
  clampImmediateAmount,
  defaultDelayDiscountingSessionParams,
  resolveDelayDiscountingSessionParams,
  type DelayDiscountingSessionParams,
} from "@/lib/delayDiscountingRandom";

const MIN_DECISION_MS = 350;

type DelayDiscountingTaskConfigExt = TaskTrialConfig & {
  delayed_amount?: unknown;
  delay_days?: unknown;
  staircase_step?: unknown;
};

export type DelayDiscountingPhase = "instructions" | "practice" | "running" | "extension" | "complete";

export type DelayTrial = {
  immediateAmount: number;
  delayedAmount: number;
  delayDays: number;
  immediateOnLeft: boolean;
  eventType: string;
};

function makeTrial(
  imm: number,
  delayedAmount: number,
  delayDays: number,
  minImmediate: number,
  maxImmediate: number,
): DelayTrial {
  const clamped = clampImmediateAmount(imm, minImmediate, maxImmediate);
  const immediateOnLeft = Math.random() < 0.5;
  return {
    immediateAmount: clamped,
    delayedAmount,
    delayDays,
    immediateOnLeft,
    eventType: `${clamped}_${delayedAmount}_${delayDays}_${immediateOnLeft ? "L" : "R"}`,
  };
}

function applySessionParams(refs: Refs, params: DelayDiscountingSessionParams) {
  refs.delayedAmount = params.delayedAmount;
  refs.delayDays = params.delayDays;
  refs.staircaseStep = params.staircaseStep;
  refs.initialImmediate = params.initialImmediate;
  refs.currentAmount = params.initialImmediate;
  refs.minImmediate = params.minImmediate;
  refs.maxImmediate = params.maxImmediate;
}

type Refs = {
  stimulusOnset: number;
  blockStart: number;
  events: Record<string, unknown>[];
  staircaseStep: number;
  delayedAmount: number;
  delayDays: number;
  initialImmediate: number;
  minImmediate: number;
  maxImmediate: number;
  currentAmount: number;
  mainTrialCount: number;
  /** Prevents double advance from key repeat or duplicate handlers on the same choice. */
  lastCommittedChoiceTrialIndex: number | null;
  practiceBlockStart: number;
  mainAdaptiveHistory: AdaptiveHistory;
};

type DelayDiscountingState = {
  phase: DelayDiscountingPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: DelayTrial[];
  maxTrials: number;
  events: Record<string, unknown>[];
  additionalTrials: number;
  _refs: Refs;
  addEvent: (ev: Record<string, unknown>) => void;
  recordChoice: (responseKey: string) => void;
  startSession: () => Promise<void>;
  startExtension: (trialsToAdd: number) => void;
  finishAndSave: () => Promise<void>;
  finishExtension: () => Promise<void>;
  setStimulusOnset: () => void;
  prepareForFreshRun: () => void;
};

export const delayDiscountingStore = create<DelayDiscountingState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: 0,
  events: [],
  additionalTrials: 0,
  _refs: {
    stimulusOnset: 0,
    blockStart: 0,
    events: [],
    ...(() => {
      const p = defaultDelayDiscountingSessionParams();
      return {
        staircaseStep: p.staircaseStep,
        delayedAmount: p.delayedAmount,
        delayDays: p.delayDays,
        initialImmediate: p.initialImmediate,
        minImmediate: p.minImmediate,
        maxImmediate: p.maxImmediate,
        currentAmount: p.initialImmediate,
      };
    })(),
    mainTrialCount: 0,
    lastCommittedChoiceTrialIndex: null,
    practiceBlockStart: 0,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
  },

  addEvent: (ev) => {
    const { phase } = get();
    if (phase !== "practice") {
      catStore.getState().addTrial({
        reaction_time_ms: (ev.reaction_time_ms as number | null | undefined) ?? null,
        expected_response: true,
      });
    }
    set((s) => {
      const next = [...s.events, ev];
      get()._refs.events = next;
      return { events: next };
    });

    // Mid-task LLM checkpoint
    const { sessionId, trialIndex } = get();
    const cat = catStore.getState();
    if (phase !== "practice" && sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      cat.requestCheckpoint(sessionId, "delay_discounting", trialIndex + 1, {
        trials_completed: trialIndex + 1,
        current_amount: get()._refs.currentAmount,
      });
    }
  },

  recordChoice: (responseKey) => {
    if (isTaskPaused()) return;
    const { phase, _refs, trials, trialIndex, addEvent } = get();
    const trial = trials[trialIndex];
    if (!trial) return;

    const keypressMs = performance.now();
    if (_refs.stimulusOnset <= 0) return;
    const reactionTimeMs = keypressMs - _refs.stimulusOnset;
    // Guard against key-mash speedruns and accidental carry-over keypresses.
    if (reactionTimeMs < MIN_DECISION_MS) return;
    if (_refs.lastCommittedChoiceTrialIndex === trialIndex) return;
    _refs.lastCommittedChoiceTrialIndex = trialIndex;
    const choseImmediate =
      (trial.immediateOnLeft && responseKey === "ArrowLeft") ||
      (!trial.immediateOnLeft && responseKey === "ArrowRight");

    addEvent({
      task_name: "delay_discounting",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: keypressMs,
      reaction_time_ms: reactionTimeMs,
      response_key: responseKey,
      correct_key: trial.immediateOnLeft ? "ArrowLeft" : "ArrowRight",
      is_correct: null,
      event_type: trial.eventType,
      isi_ms: null,
      extra_data: {
        chose_immediate: choseImmediate,
        immediate_amount: trial.immediateAmount,
        delayed_amount: trial.delayedAmount,
        delay_days: trial.delayDays,
        immediate_on_left: trial.immediateOnLeft,
      },
    });

    if (phase === "running" || phase === "extension") {
      const metrics = computeDelayDiscountingCheckpointFields(get()._refs.events);
      _refs.mainAdaptiveHistory = tryMainAdaptiveStop(
        "delay_discounting",
        buildDelayDiscountingCheckpoint({
          trialsCompleted: metrics.trialsCompleted,
          indifferencePoint: metrics.indifferencePoint,
          consistencyScore: metrics.consistencyScore,
          minCellTrials: metrics.minCellTrials,
          immediateChoiceRate: metrics.immediateChoiceRate,
          fastChoiceRate: metrics.fastChoiceRate,
          dominantSideShare: metrics.dominantSideShare,
          nowVsLaterMisunderstanding: metrics.nowVsLaterMisunderstanding,
        }),
        _refs.mainAdaptiveHistory,
        get().maxTrials,
      ).history;
    }

    const step = _refs.staircaseStep;
    if (choseImmediate) {
      _refs.currentAmount -= step;
    } else {
      _refs.currentAmount += step;
    }
    _refs.currentAmount = Math.max(
      _refs.minImmediate,
      Math.min(_refs.maxImmediate, Math.round(_refs.currentAmount)),
    );

    const nextIdx = trialIndex + 1;
    if (nextIdx >= trials.length) {
      if (phase === "practice") {
        const practiceMinTrials = Math.max(1, Number(PRACTICE_CONFIG.minTrials) || 5);
        const practiceMaxTrials = Math.max(
          practiceMinTrials,
          Number(PRACTICE_CONFIG.maxTrials) || 20,
        );
        const practiceEvents = get()._refs.events;
        const rts = practiceEvents
          .map((e) => e.reaction_time_ms as number | null)
          .filter((rt): rt is number => rt != null);
        const sides = practiceEvents
          .map((e) => e.response_key as string | null)
          .filter((k): k is string => k != null);
        const fast = rts.filter((rt) => rt < 250).length;
        const sameSide = sides.length > 0 && sides.every((s) => s === sides[0]);
        const switches = sides.slice(1).filter((s, i) => s !== sides[i]).length;
        const switchRate = sides.length > 1 ? switches / (sides.length - 1) : 0;
        const metMin = practiceEvents.length >= practiceMinTrials;
        const passed = metMin && fast === 0 && !sameSide && switchRate <= 0.8;
        const hitMax = practiceEvents.length >= practiceMaxTrials;

        if (!passed && !hitMax) {
          const remaining = practiceMaxTrials - practiceEvents.length;
          const add = Math.min(5, remaining);
          const extra = Array.from({ length: add }, () =>
            makeTrial(
              _refs.initialImmediate,
              _refs.delayedAmount,
              _refs.delayDays,
              _refs.minImmediate,
              _refs.maxImmediate,
            ),
          );
          set({ trials: [...get().trials, ...extra] });
          toast.info("You are choosing between a smaller reward now or a larger reward later.");
          return;
        }

        const sid = get().sessionId;
        const lowConfidence = !passed;
        (async () => {
          try {
            if (sid && practiceEvents.length > 0) {
              const flagged = practiceEvents.map((ev) => ({
                ...ev,
                extra_data: { ...(ev.extra_data as Record<string, unknown> || {}), is_practice: true },
              }));
              await sessionsService.postEvents(sid, flagged);
              await sessionsService.postBlocks(sid, {
                task_name: "delay_discounting",
                block_index: -1,
                practice_pass: passed,
                practice_accuracy: 0,
                practice_trial_count: practiceEvents.length,
                low_confidence_flag: lowConfidence,
                practice_blocks_completed: Math.ceil(practiceEvents.length / 5),
                practice_error_pattern: ((!passed || lowConfidence) ? "random_responding" : null) ?? undefined,
                block_start_ts: get()._refs.practiceBlockStart,
                block_end_ts: performance.now(),
              });
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save practice");
          }
        })();

        const mainTrialCount = _refs.mainTrialCount;
        _refs.currentAmount = _refs.initialImmediate;
        _refs.events = [];
        _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
        const mainTrials = Array.from({ length: mainTrialCount }, () =>
          makeTrial(
            _refs.initialImmediate,
            _refs.delayedAmount,
            _refs.delayDays,
            _refs.minImmediate,
            _refs.maxImmediate,
          ),
        );
        set({
          phase: "running",
          trials: mainTrials,
          maxTrials: mainTrialCount,
          trialIndex: 0,
          events: [],
        });
        toast.success("Practice complete. Starting main task.");
        return;
      }
      const shouldStopEarly = catStore.getState().shouldTriggerBlockEnd;
      const canContinueWithinTask = nextIdx < get().maxTrials;

      if (!shouldStopEarly && canContinueWithinTask) {
        // Continue trial-by-trial until CAT stop trigger fires or maxTrials is reached.
        const updated = [...trials, makeTrial(
          _refs.currentAmount,
          _refs.delayedAmount,
          _refs.delayDays,
          _refs.minImmediate,
          _refs.maxImmediate,
        )];
        set({ trials: updated, trialIndex: nextIdx });
      } else {
        set({ phase: "complete" });
      }
    } else {
      const updated = [...trials];
      updated[nextIdx] = makeTrial(
        _refs.currentAmount,
        _refs.delayedAmount,
        _refs.delayDays,
        _refs.minImmediate,
        _refs.maxImmediate,
      );
      set({ trials: updated, trialIndex: nextIdx });
    }
  },

  startSession: async () => {
    try {
      const res = await sessionsService.create("delay_discounting");
      const { _refs } = get();
      _refs.blockStart = performance.now();
      _refs.stimulusOnset = performance.now();
      catStore.getState().resetForNewTask();
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();

      // Load dynamic trial count from backend config
      const config = (await catStore
        .getState()
        .loadTaskConfig(res.session_id, "delay_discounting")) as DelayDiscountingTaskConfigExt | null;
      const limits = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.delay_discounting;
      const rawMain = Math.floor(Number(config?.max_trials));
      const trialCount = Math.min(limits.maxTrials, Math.max(limits.minTrials, rawMain));
      const practiceCfg = (config?.practice_config as Record<string, unknown> | undefined) ?? {};
      const configuredPracticeMin = Math.floor(Number(practiceCfg.min_trials));
      const configuredPracticeMax = Math.floor(Number(practiceCfg.max_trials));
      const practiceMin = Number.isFinite(configuredPracticeMin)
        ? configuredPracticeMin
        : Math.max(1, Number(PRACTICE_CONFIG.minTrials) || 5);
      const practiceMax = Number.isFinite(configuredPracticeMax)
        ? configuredPracticeMax
        : Math.max(practiceMin, Number(PRACTICE_CONFIG.maxTrials) || 20);
      const practiceCount = practiceMax;
      if (!Number.isFinite(rawMain) || rawMain < 1) {
        throw new Error("Missing CAT main max_trials for delay_discounting.");
      }
      if (!Number.isFinite(practiceCount) || practiceCount < practiceMin) {
        throw new Error("Missing CAT practice max_trials for delay_discounting.");
      }

      applySessionParams(_refs, resolveDelayDiscountingSessionParams(config));

      _refs.mainTrialCount = trialCount;
      _refs.practiceBlockStart = performance.now();

      const t = Array.from({ length: practiceCount }, () =>
        makeTrial(
          _refs.initialImmediate,
          _refs.delayedAmount,
          _refs.delayDays,
          _refs.minImmediate,
          _refs.maxImmediate,
        ),
      );
      _refs.lastCommittedChoiceTrialIndex = null;
      set({
        sessionId: res.session_id,
        trials: t,
        maxTrials: practiceCount,
        trialIndex: 0,
        phase: "practice",
        events: [],
      });
      _refs.events = [];
      toast.success("Practice started.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    const lim = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.delay_discounting;
    const n = Math.min(lim.maxTrials, Math.max(lim.minTrials, Math.floor(trialsToAdd)));
    _refs.lastCommittedChoiceTrialIndex = null;
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.stimulusOnset = performance.now();
    catStore.getState().resetForNewTask();
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    const t = Array.from({ length: n }, () =>
      makeTrial(
        _refs.currentAmount,
        _refs.delayedAmount,
        _refs.delayDays,
        _refs.minImmediate,
        _refs.maxImmediate,
      ),
    );
    set({
      events: [],
      trials: t,
      maxTrials: n,
      trialIndex: 0,
      additionalTrials: n,
      phase: "extension",
    });
  },

  finishAndSave: async () => {
    const { sessionId, _refs, events } = get();
    if (!sessionId) return;
    const eventsToSave = _refs.events.length > 0 ? _refs.events : events;
    if (eventsToSave.length === 0) return;
    try {
      await sessionsService.postEvents(sessionId, [...eventsToSave]);
      await sessionsService.postBlocks(sessionId, {
        task_name: "delay_discounting",
        block_index: 0,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreDelayDiscounting(sessionId);
      toast.success("Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    set({ phase: "complete" });
  },

  finishExtension: async () => {
    const { sessionId, _refs, events } = get();
    if (!sessionId) {
      set({ phase: "complete" });
      return;
    }
    const eventsToSave = _refs.events.length > 0 ? _refs.events : events;
    if (eventsToSave.length > 0) {
      try {
        await sessionsService.postEvents(sessionId, [...eventsToSave]);
        await sessionsService.postBlocks(sessionId, {
          task_name: "delay_discounting",
          block_index: 1,
          block_start_ts: _refs.blockStart,
          block_end_ts: performance.now(),
        });
        await sessionsService.scoreDelayDiscounting(sessionId);
        toast.success("Extension block complete. Results saved.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  setStimulusOnset: () => {
    get()._refs.stimulusOnset = performance.now();
  },

  prepareForFreshRun: () => {
    if (get().phase !== "complete") return;
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.blockStart = 0;
    _refs.events = [];
    applySessionParams(_refs, defaultDelayDiscountingSessionParams());
    _refs.mainTrialCount = 0;
    _refs.lastCommittedChoiceTrialIndex = null;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: 0,
      events: [],
      additionalTrials: 0,
    });
  },
}));
