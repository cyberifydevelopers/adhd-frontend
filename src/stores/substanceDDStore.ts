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

type SubstanceDdTaskConfigExt = TaskTrialConfig & {
  delayed_amount?: unknown;
  delay_days?: unknown;
  staircase_step?: unknown;
};

export type SubDDPhase = "instructions" | "practice" | "running" | "complete";

export type SubDDTrial = {
  immediateAmount: number;
  delayedAmount: number;
  delayDays: number;
  immediateOnLeft: boolean;
};

function makeTrial(
  imm: number,
  delayedAmount: number,
  delayDays: number,
  minImmediate: number,
  maxImmediate: number,
): SubDDTrial {
  const clamped = clampImmediateAmount(imm, minImmediate, maxImmediate);
  return {
    immediateAmount: clamped,
    delayedAmount,
    delayDays,
    immediateOnLeft: Math.random() < 0.5,
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
  lastCommittedChoiceTrialIndex: number | null;
  /** Avoid duplicate persist (e.g. React StrictMode double effect). */
  saveCommitted: boolean;
  practiceBlockStart: number;
  mainAdaptiveHistory: AdaptiveHistory;
  /** User tapped distress control — stamped on events and checkpoints. */
  userReportedDistress: boolean;
};

type SubstanceDDState = {
  phase: SubDDPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: SubDDTrial[];
  maxTrials: number;
  events: Record<string, unknown>[];
  _refs: Refs;
  addEvent: (ev: Record<string, unknown>) => void;
  recordChoice: (responseKey: string) => void;
  startSession: () => Promise<void>;
  finishAndSave: () => Promise<void>;
  setStimulusOnset: () => void;
  prepareForFreshRun: () => void;
  markDistress: () => void;
  cleanup: () => void;
  resumeAfterPause: () => void;
};

export const substanceDDStore = create<SubstanceDDState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: 0,
  events: [],
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
    saveCommitted: false,
    practiceBlockStart: 0,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    userReportedDistress: false,
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
      cat.requestCheckpoint(sessionId, "substance_dd", trialIndex + 1, {
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
      task_name: "substance_dd",
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: keypressMs,
      reaction_time_ms: reactionTimeMs,
      response_key: responseKey,
      event_type: `${trial.immediateAmount}_${trial.delayedAmount}_${trial.delayDays}_${trial.immediateOnLeft ? "L" : "R"}`,
      isi_ms: null,
      extra_data: {
        chose_immediate: choseImmediate,
        immediate_amount: trial.immediateAmount,
        delayed_amount: trial.delayedAmount,
        delay_days: trial.delayDays,
        immediate_on_left: trial.immediateOnLeft,
        is_practice: phase === "practice",
        user_reported_distress: _refs.userReportedDistress,
        distress_flag: _refs.userReportedDistress,
      },
    });

    if (phase === "running") {
      const metrics = computeDelayDiscountingCheckpointFields(get()._refs.events);
      _refs.mainAdaptiveHistory = tryMainAdaptiveStop(
        "substance_dd",
        buildDelayDiscountingCheckpoint({
          trialsCompleted: metrics.trialsCompleted,
          indifferencePoint: metrics.indifferencePoint,
          consistencyScore: metrics.consistencyScore,
          minCellTrials: metrics.minCellTrials,
          immediateChoiceRate: metrics.immediateChoiceRate,
          fastChoiceRate: metrics.fastChoiceRate,
          dominantSideShare: metrics.dominantSideShare,
          nowVsLaterMisunderstanding: metrics.nowVsLaterMisunderstanding,
          substanceDdDistressReported: metrics.distressReported,
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
                task_name: "substance_dd",
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
        _refs.lastCommittedChoiceTrialIndex = null;
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
        _refs.saveCommitted = false;
        set({
          phase: "running",
          trials: mainTrials,
          maxTrials: mainTrialCount,
          trialIndex: 0,
          events: [],
        });
        toast.success("Practice complete. Starting main task.");
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
      const res = await sessionsService.create("substance_dd");
      const { _refs } = get();
      _refs.blockStart = performance.now();
      _refs.stimulusOnset = performance.now();
      _refs.userReportedDistress = false;
      catStore.getState().resetForNewTask();
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();

      // Load dynamic trial count from backend config
      const config = (await catStore
        .getState()
        .loadTaskConfig(res.session_id, "substance_dd")) as SubstanceDdTaskConfigExt | null;
      const limits = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.substance_dd;
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
        throw new Error("Missing CAT main max_trials for substance_dd.");
      }
      if (!Number.isFinite(practiceCount) || practiceCount < practiceMin) {
        throw new Error("Missing CAT practice max_trials for substance_dd.");
      }

      applySessionParams(_refs, resolveDelayDiscountingSessionParams(config));

      _refs.mainTrialCount = trialCount;
      _refs.lastCommittedChoiceTrialIndex = null;
      _refs.saveCommitted = false;
      _refs.practiceBlockStart = performance.now();

      set({
        sessionId: res.session_id,
        trials: Array.from({ length: practiceCount }, () =>
          makeTrial(
            _refs.initialImmediate,
            _refs.delayedAmount,
            _refs.delayDays,
            _refs.minImmediate,
            _refs.maxImmediate,
          ),
        ),
        maxTrials: practiceCount,
        trialIndex: 0,
        phase: "practice",
        events: [],
      });
      _refs.events = [];
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  finishAndSave: async () => {
    const { sessionId, _refs, events } = get();
    if (!sessionId || _refs.saveCommitted) return;
    const eventsToSave = _refs.events.length > 0 ? _refs.events : events;
    if (eventsToSave.length === 0) return;
    _refs.saveCommitted = true;
    try {
      await sessionsService.postEvents(sessionId, [...eventsToSave]);
      await sessionsService.postBlocks(sessionId, {
        task_name: "substance_dd",
        block_index: 0,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreSubstanceModule(sessionId, "substance_dd");
      _refs.events = [];
      set({ events: [] });
      toast.success("Results saved.");
    } catch (err) {
      _refs.saveCommitted = false;
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  },

  setStimulusOnset: () => {
    get()._refs.stimulusOnset = performance.now();
  },

  markDistress: () => {
    get()._refs.userReportedDistress = true;
    toast.info("Noted for review. Pause or stop if you need to; wording here stays neutral.");
  },

  prepareForFreshRun: () => {
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.blockStart = 0;
    _refs.events = [];
    applySessionParams(_refs, defaultDelayDiscountingSessionParams());
    _refs.mainTrialCount = 0;
    _refs.lastCommittedChoiceTrialIndex = null;
    _refs.saveCommitted = false;
    _refs.userReportedDistress = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: 0,
      events: [],
    });
  },

  cleanup: () => {},

  resumeAfterPause: () => {},
}));
