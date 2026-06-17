import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS } from "@/config/catConfig";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildSimpleRtLikeCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";

const TASK_NAME = "psychomotor_speed";
const MIN_FOREPERIOD_MS = 1000;
const MAX_FOREPERIOD_MS = 3000;
const MISS_TIMEOUT_MS = 1500;
/** Non-anticipatory responses for median RT / spec validity (matches simple RT bridge). */
const ANT_MS = 120;

export type PsychomotorPhase = "instructions" | "practice" | "main" | "complete";
export type PsychomotorStage = "get_ready" | "waiting" | "stimulus" | "feedback";

type TrialResult = {
  trial: number;
  reaction_time_ms: number | null;
  valid: boolean;
  false_start: boolean;
  missed: boolean;
};

type Refs = {
  practiceResults: TrialResult[];
  mainResults: TrialResult[];
  events: Record<string, unknown>[];
  blockStart: number;
  currentStimulusAt: number | null;
  currentWaitStart: number | null;
  trialTimerId: ReturnType<typeof setTimeout> | null;
  missTimerId: ReturnType<typeof setTimeout> | null;
  feedbackTimerId: ReturnType<typeof setTimeout> | null;
  practiceTrials: number;
  mainTrials: number;
  /** One response per stimulus / wait window — blocks double taps and key repeats. */
  waitingTapCommitted: boolean;
  stimulusTapCommitted: boolean;
  practicePassThreshold: number;
  practiceContinueThreshold: number;
  mainPassThreshold: number;
  mainContinueThreshold: number;
  practiceSaved: boolean;
  mainAdaptiveHistory: AdaptiveHistory;
  /** User noted motor limitation — forwarded to adaptive checkpoints / events. */
  motorImpairmentNoted: boolean;
};

type PsychomotorSpeedState = {
  phase: PsychomotorPhase;
  stage: PsychomotorStage;
  sessionId: string | null;
  trialIndex: number;
  totalTrials: number;
  latestMessage: string | null;
  practiceSummary: string | null;
  lastResult: TrialResult | null;
  _refs: Refs;
  startSession: () => Promise<void>;
  handleTap: () => void;
  _startNextTrial: () => void;
  _recordAndAdvance: (result: TrialResult) => void;
  startMainPhase: () => void;
  finishAndSave: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
  markMotorImpairment: () => void;
};

export const psychomotorSpeedStore = create<PsychomotorSpeedState>((set, get) => ({
  phase: "instructions",
  stage: "get_ready",
  sessionId: null,
  trialIndex: 0,
  totalTrials: 0,
  latestMessage: null,
  practiceSummary: null,
  lastResult: null,
  _refs: {
    practiceResults: [],
    mainResults: [],
    events: [],
    blockStart: 0,
    currentStimulusAt: null,
    currentWaitStart: null,
    trialTimerId: null,
    missTimerId: null,
    feedbackTimerId: null,
    practiceTrials: 0,
    mainTrials: 0,
    waitingTapCommitted: false,
    stimulusTapCommitted: false,
    practicePassThreshold: 0.8,
    practiceContinueThreshold: 0.5,
    mainPassThreshold: 0.8,
    mainContinueThreshold: 0.5,
    practiceSaved: false,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    motorImpairmentNoted: false,
  },

  startSession: async () => {
    try {
      const res = await sessionsService.create(TASK_NAME);
      catStore.getState().resetForNewTask();
      const config = await catStore.getState().loadTaskConfig(res.session_id, TASK_NAME);
      const practiceTrials = Math.floor(Number(config?.practice_config?.max_trials));
      let mainTrials = Math.floor(Number(config?.max_trials));
      if (!Number.isFinite(practiceTrials) || practiceTrials < 1) {
        throw new Error("Missing CAT practice max_trials for psychomotor_speed.");
      }
      if (!Number.isFinite(mainTrials) || mainTrials < 1) {
        throw new Error("Missing CAT main max_trials for psychomotor_speed.");
      }
      const pmLimits = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.psychomotor_speed;
      mainTrials = Math.min(pmLimits.maxTrials, Math.max(pmLimits.minTrials, mainTrials));
      const { _refs } = get();
      get().cleanup();
      _refs.practiceResults = [];
      _refs.mainResults = [];
      _refs.events = [];
      _refs.blockStart = performance.now();
      _refs.currentStimulusAt = null;
      _refs.currentWaitStart = null;
      _refs.practiceTrials = practiceTrials;
      _refs.mainTrials = mainTrials;
      _refs.practicePassThreshold = Number(config?.practice_config?.pass_threshold ?? 0.8);
      _refs.practiceContinueThreshold = Number(config?.practice_config?.continue_threshold ?? 0.5);
      _refs.mainPassThreshold = _refs.practicePassThreshold;
      _refs.mainContinueThreshold = _refs.practiceContinueThreshold;
      _refs.practiceSaved = false;
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      _refs.motorImpairmentNoted = false;

      set({
        sessionId: res.session_id,
        phase: "practice",
        stage: "get_ready",
        trialIndex: 0,
        totalTrials: practiceTrials,
        latestMessage: "Practice round (not scored).",
        practiceSummary: null,
        lastResult: null,
      });
      get()._startNextTrial();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  handleTap: () => {
    if (isTaskPaused()) return;
    const { phase, stage, trialIndex, _refs } = get();
    if (phase !== "practice" && phase !== "main") return;
    if (stage !== "waiting" && stage !== "stimulus") return;

    const now = performance.now();
    if (stage === "waiting") {
      if (_refs.waitingTapCommitted) return;
      _refs.waitingTapCommitted = true;
      get()._recordAndAdvance({
        trial: trialIndex + 1,
        reaction_time_ms: null,
        valid: false,
        false_start: true,
        missed: false,
      });
      if (phase === "main") {
        _refs.events.push({
          task_name: TASK_NAME,
          trial_index: trialIndex,
          stimulus_onset_ms: _refs.currentWaitStart ?? now,
          keypress_ms: now,
          reaction_time_ms: null,
          event_type: "false_start",
          extra_data: { motor_impairment_noted: _refs.motorImpairmentNoted },
        });
      }
      return;
    }

    if (_refs.stimulusTapCommitted) return;
    _refs.stimulusTapCommitted = true;
    const stimulusAt = _refs.currentStimulusAt ?? now;
    const rt = Math.max(0, now - stimulusAt);
    const roundedRt = Math.round(rt);
    const nonAnticipatory = roundedRt >= ANT_MS;
    const withinTarget =
      phase === "practice"
        ? nonAnticipatory && roundedRt <= MISS_TIMEOUT_MS + 300
        : nonAnticipatory;
    get()._recordAndAdvance({
      trial: trialIndex + 1,
      reaction_time_ms: roundedRt,
      valid: withinTarget,
      false_start: false,
      missed: false,
    });
    if (phase === "main") {
      _refs.events.push({
        task_name: TASK_NAME,
        trial_index: trialIndex,
        stimulus_onset_ms: stimulusAt,
        keypress_ms: now,
        reaction_time_ms: Math.round(rt),
        event_type: "valid",
        is_correct: nonAnticipatory,
        extra_data: { motor_impairment_noted: _refs.motorImpairmentNoted },
      });
    }
  },

  _startNextTrial: () => {
    if (isTaskPaused()) return;
    const { phase, trialIndex, totalTrials, _refs } = get();
    const sid = get().sessionId;
    if (phase !== "practice" && phase !== "main") return;
    if (trialIndex >= totalTrials) {
      if (phase === "practice") {
          const valid = _refs.practiceResults.filter((r) => r.valid).length;
          const recentPractice = _refs.practiceResults.slice(-5);
          const recentValid = recentPractice.filter((r) => r.valid).length;
          const lastFiveAccuracy = recentPractice.length > 0 ? recentValid / recentPractice.length : 0;
        const savePracticeBlock = async (passed: boolean, lowConfidence: boolean, pattern: string | null) => {
          if (!sid || _refs.practiceSaved) return;
          _refs.practiceSaved = true;
          try {
            await sessionsService.postBlocks(sid, {
              task_name: TASK_NAME,
              block_index: -1,
              practice_pass: passed,
                practice_accuracy: lastFiveAccuracy,
              practice_trial_count: _refs.practiceResults.length,
              low_confidence_flag: lowConfidence,
              practice_blocks_completed: Math.ceil(_refs.practiceResults.length / 5),
              practice_error_pattern: pattern ?? undefined,
              block_start_ts: _refs.blockStart,
              block_end_ts: performance.now(),
            });
          } catch {
            _refs.practiceSaved = false;
          }
        };
          const passed = recentPractice.length >= 5 && lastFiveAccuracy >= _refs.practicePassThreshold;
        const lowConfidence = !passed;
        void savePracticeBlock(passed, lowConfidence, passed ? null : "accuracy_low");
        if (!passed) {
          set({
              latestMessage: lastFiveAccuracy >= _refs.practiceContinueThreshold
              ? "Additional instruction: respond only when the stimulus appears."
              : "Simplified instruction: wait for CLICK NOW, then tap immediately.",
          });
        }
        set({
          phase: "main",
          stage: "get_ready",
          trialIndex: 0,
          totalTrials: _refs.mainTrials,
          practiceSummary: `Practice done: ${valid}/${_refs.practiceTrials} valid clicks (last5 ${(lastFiveAccuracy * 100).toFixed(0)}%)${lowConfidence ? " (low confidence)" : ""}`,
          latestMessage: "Main test starts now.",
          lastResult: null,
        });
        return;
      }
      if (phase === "main") {
        set({ phase: "complete" });
        return;
      }
    }

    // Always reset tap guards at the start of each trial cycle.
    _refs.waitingTapCommitted = false;
    _refs.stimulusTapCommitted = false;
    set({ stage: "get_ready", latestMessage: "Get Ready...", lastResult: null });
    _refs.currentStimulusAt = null;
    _refs.currentWaitStart = performance.now();

    _refs.trialTimerId = setTimeout(() => {
      _refs.waitingTapCommitted = false;
      set({ stage: "waiting", latestMessage: "Wait..." });
      const delay = Math.floor(Math.random() * (MAX_FOREPERIOD_MS - MIN_FOREPERIOD_MS + 1)) + MIN_FOREPERIOD_MS;
      _refs.trialTimerId = setTimeout(() => {
        const stimulusAt = performance.now();
        _refs.currentStimulusAt = stimulusAt;
        _refs.stimulusTapCommitted = false;
        set({ stage: "stimulus", latestMessage: "CLICK NOW!" });
        _refs.missTimerId = setTimeout(() => {
          get()._recordAndAdvance({
            trial: get().trialIndex + 1,
            reaction_time_ms: null,
            valid: false,
            false_start: false,
            missed: true,
          });
          if (get().phase === "main") {
            _refs.events.push({
              task_name: TASK_NAME,
              trial_index: get().trialIndex,
              stimulus_onset_ms: stimulusAt,
              keypress_ms: null,
              reaction_time_ms: null,
              event_type: "miss",
              is_correct: false,
              extra_data: { motor_impairment_noted: _refs.motorImpairmentNoted },
            });
          }
        }, MISS_TIMEOUT_MS);
      }, delay);
    }, 500);
  },

  _recordAndAdvance: (result: TrialResult) => {
    const { phase, _refs } = get();
    if (_refs.missTimerId) clearTimeout(_refs.missTimerId);
    if (_refs.trialTimerId) clearTimeout(_refs.trialTimerId);
    _refs.missTimerId = null;
    _refs.trialTimerId = null;

    if (phase === "practice") _refs.practiceResults.push(result);
    if (phase === "main") _refs.mainResults.push(result);

    if (phase === "practice") {
      const recentPractice = _refs.practiceResults.slice(-5);
      const recentValid = recentPractice.filter((r) => r.valid).length;
      const lastFiveAccuracy = recentPractice.length > 0 ? recentValid / recentPractice.length : 0;
      if (recentPractice.length >= 5 && lastFiveAccuracy >= _refs.practicePassThreshold) {
        if (get().sessionId && !_refs.practiceSaved) {
          _refs.practiceSaved = true;
          void sessionsService.postBlocks(get().sessionId!, {
            task_name: TASK_NAME,
            block_index: -1,
            practice_pass: true,
            practice_accuracy: lastFiveAccuracy,
            practice_trial_count: _refs.practiceResults.length,
            low_confidence_flag: false,
            practice_blocks_completed: Math.ceil(_refs.practiceResults.length / 5),
            practice_error_pattern: undefined,
            block_start_ts: _refs.blockStart,
            block_end_ts: performance.now(),
          }).catch(() => {
            _refs.practiceSaved = false;
          });
        }
        _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
        set({
          phase: "main",
          stage: "get_ready",
          trialIndex: 0,
          totalTrials: _refs.mainTrials,
          practiceSummary: `Practice done: ${recentValid}/${_refs.practiceTrials} valid clicks`,
          latestMessage: "Main test starts now.",
          lastResult: null,
        });
        return;
      }
    }
    if (phase === "main") {
      const pseudoEvents = _refs.mainResults.map((r) => {
        if (r.false_start || r.missed) {
          return { is_correct: false, reaction_time_ms: null } as Record<string, unknown>;
        }
        const rt = r.reaction_time_ms;
        const hasRt = typeof rt === "number";
        const nonAnt = hasRt && rt >= ANT_MS;
        return {
          is_correct: nonAnt,
          reaction_time_ms: hasRt ? rt : null,
        } as Record<string, unknown>;
      });
      const cp = buildSimpleRtLikeCheckpoint(pseudoEvents, _refs.mainTrials, {
        validTrialsCounter: "responded_ge_ant",
        psychomotorMotorImpairmentNoted: _refs.motorImpairmentNoted,
      });
      _refs.mainAdaptiveHistory = tryMainAdaptiveStop(
        "psychomotor_speed",
        cp,
        _refs.mainAdaptiveHistory,
        _refs.mainTrials,
      ).history;
    }

    const feedback = result.false_start
      ? "Too early!"
      : result.missed
        ? "Missed"
        : phase === "practice" || phase === "main"
          ? result.valid
            ? "Good"
            : result.reaction_time_ms != null && result.reaction_time_ms < ANT_MS
              ? "Too fast — wait for the cue, then tap."
              : `Try again — response was ${((result.reaction_time_ms ?? 0) / 1000).toFixed(2)} s`
          : `${result.reaction_time_ms} ms`;

    set((s) => ({
      stage: "feedback",
      latestMessage: feedback,
      lastResult: result,
      trialIndex: s.trialIndex + 1,
    }));

    _refs.feedbackTimerId = setTimeout(() => {
      const r = get()._refs;
      r.waitingTapCommitted = false;
      r.stimulusTapCommitted = false;
      if (get().phase === "main" && catStore.getState().shouldTriggerBlockEnd) {
        catStore.getState().clearTrigger();
        set({ phase: "complete" });
        return;
      }
      get()._startNextTrial();
    }, 700);
  },

  markMotorImpairment: () => {
    get()._refs.motorImpairmentNoted = true;
    toast.info("Noted: motor limitation flagged for this session.");
  },

  startMainPhase: () => {
    const { phase, stage } = get();
    if (phase !== "main") return;
    if (stage !== "get_ready") return;
    get()._startNextTrial();
  },

  finishAndSave: async () => {
    const { sessionId, _refs } = get();
    if (!sessionId) return;
    try {
      if (_refs.events.length > 0) await sessionsService.postEvents(sessionId, [..._refs.events]);
      await sessionsService.postBlocks(sessionId, {
        task_name: TASK_NAME,
        block_index: 0,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scorePsychomotorSpeed(sessionId);
      toast.success("Psychomotor speed results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.trialTimerId) clearTimeout(_refs.trialTimerId);
    if (_refs.missTimerId) clearTimeout(_refs.missTimerId);
    if (_refs.feedbackTimerId) clearTimeout(_refs.feedbackTimerId);
    _refs.trialTimerId = null;
    _refs.missTimerId = null;
    _refs.feedbackTimerId = null;
  },

  resumeAfterPause: () => {
    const { phase } = get();
    if (phase !== "practice" && phase !== "main") return;
    if (catStore.getState().shouldTriggerBlockEnd) return;
    get()._startNextTrial();
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.practiceResults = [];
    _refs.mainResults = [];
    _refs.events = [];
    _refs.blockStart = 0;
    _refs.currentStimulusAt = null;
    _refs.currentWaitStart = null;
    _refs.trialTimerId = null;
    _refs.missTimerId = null;
    _refs.feedbackTimerId = null;
    _refs.practiceTrials = 0;
    _refs.mainTrials = 0;
    _refs.waitingTapCommitted = false;
    _refs.stimulusTapCommitted = false;
    _refs.practicePassThreshold = 0.8;
    _refs.practiceContinueThreshold = 0.5;
    _refs.mainPassThreshold = 0.8;
    _refs.mainContinueThreshold = 0.5;
    _refs.practiceSaved = false;
    _refs.motorImpairmentNoted = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      stage: "get_ready",
      sessionId: null,
      trialIndex: 0,
      totalTrials: 0,
      latestMessage: null,
      practiceSummary: null,
      lastResult: null,
    });
  },
}));
