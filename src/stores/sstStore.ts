import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
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
import {
  buildSstCheckpoint,
  buildSstMainTrialSchedule,
  median,
  sstMinStopTrialsForSession,
  SST_SSD_SPEC_MAX_MS,
  SST_SSD_SPEC_MIN_MS,
} from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";

const GO_KEYS = ["ArrowLeft", "ArrowRight"];
const MAIN_LIMITS = getMainTrialLimits("sst");
const MAIN_TRIALS = MAIN_LIMITS.maxTrials;
const SSD_INITIAL_MS = 250;
const SSD_STEP_MS = 50;
/** Staircase clamp — spec 50–900 ms (same symbols as mainAdaptiveBridge SST_SSD_SPEC_*). */
const SSD_MIN_MS = SST_SSD_SPEC_MIN_MS;
const SSD_MAX_MS = SST_SSD_SPEC_MAX_MS;

function randomDirection(): "left" | "right" {
  return Math.random() < 0.5 ? "left" : "right";
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export type SSTTrial = { type: "go" | "stop"; direction: "left" | "right"; isi_ms: number };

type SSTAdaptiveParams = {
  goRatio: number;
  responseDeadline: number;
};

function buildOneTrial(params: SSTAdaptiveParams): SSTTrial {
  const isGo = Math.random() < params.goRatio;
  return {
    type: isGo ? "go" : "stop",
    direction: randomDirection(),
    isi_ms: randomBetween(1200, 1800),
  };
}

export function buildSSTTrials(count: number, params?: SSTAdaptiveParams): SSTTrial[] {
  const p = params ?? { goRatio: ADAPTIVE_DEFAULTS.sst.goRatio, responseDeadline: ADAPTIVE_DEFAULTS.sst.responseDeadline };
  return Array.from({ length: count }, () => buildOneTrial(p));
}

function buildPracticeMixedTrials(count: number): SSTTrial[] {
  // Ensure stop trials appear (understanding inhibition is required).
  const trials = Array.from({ length: count }, () => buildOneTrial({ ...defaultAdaptiveParams, goRatio: 0.75 }));
  if (trials.length >= 5 && !trials.some((t) => t.type === "stop")) {
    // Force at least one stop trial in the block.
    const idx = Math.floor(Math.random() * trials.length);
    trials[idx] = { ...trials[idx], type: "stop" };
  }
  return trials;
}

function computeSstMetrics(events: Record<string, unknown>[]): Record<string, unknown> {
  const goEvents = events.filter((e) => e.event_type === "go");
  const stopEvents = events.filter((e) => e.event_type === "stop");
  const goRTs = goEvents
    .map((e) => e.reaction_time_ms as number | null)
    .filter((rt): rt is number => rt != null);
  const meanGoRt = goRTs.length > 0 ? goRTs.reduce((a, b) => a + b, 0) / goRTs.length : 0;
  const stopSuccess = stopEvents.filter((e) => e.is_correct === true).length;
  const ssds = stopEvents
    .map((e) => e.isi_ms as number | null)
    .filter((s): s is number => s != null);
  const meanSsd = ssds.length > 0 ? ssds.reduce((a, b) => a + b, 0) / ssds.length : 0;
  const sd = goRTs.length > 1
    ? Math.sqrt(goRTs.reduce((a, b) => a + (b - meanGoRt) ** 2, 0) / (goRTs.length - 1))
    : 0;
  return {
    mean_go_rt: meanGoRt,
    stop_success_rate: stopEvents.length > 0 ? stopSuccess / stopEvents.length : 0,
    mean_ssd: meanSsd,
    rt_cov: meanGoRt > 0 ? sd / meanGoRt : 0,
    accuracy: goEvents.length > 0 ? goEvents.filter((e) => e.is_correct === true).length / goEvents.length : 0,
  };
}

export type SSTPhase = "instructions" | "practice" | "main" | "extension" | "complete";

type Refs = {
  blockStart: number;
  ssd: number;
  events: Record<string, unknown>[];
  /** Active keydown handler for the current trial — must detach when timers are cleared or trial changes (React effect cleanup only cleared timeouts, leaving duplicate listeners). */
  keydownHandler: ((e: KeyboardEvent) => void) | null;
  responseTimeoutId: ReturnType<typeof setTimeout> | undefined;
  stopSignalTimeoutId: ReturnType<typeof setTimeout> | undefined;
  nextTrialTimeoutId: ReturnType<typeof setTimeout> | undefined;
  maxTrials: number;
  practiceEvents: Record<string, unknown>[];
  practiceConfig: PracticeConfig;
  mainAdaptiveHistory: AdaptiveHistory;
  /** First stable median go RT for waiting-strategy check */
  sstBaselineMedianGoRtMs: number | null;
};

type SSTState = {
  phase: SSTPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: SSTTrial[];
  maxTrials: number;
  currentStimulus: "left" | "right" | "stop" | null;
  events: Record<string, unknown>[];
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
  finishPractice: () => void;
  finishMain: () => Promise<boolean>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  /** Reset after a terminal completion so a new assignment/battery session can start (in-memory store otherwise stays on `complete`). */
  prepareForFreshRun: () => void;
};

const defaultAdaptiveParams: SSTAdaptiveParams = {
  goRatio: ADAPTIVE_DEFAULTS.sst.goRatio,
  responseDeadline: ADAPTIVE_DEFAULTS.sst.responseDeadline,
};

export const sstStore = create<SSTState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: MAIN_TRIALS,
  currentStimulus: null,
  events: [],
  additionalTrials: 0,
  practiceState: null,
  lastPracticeFeedback: null,
  practiceReinstruction: false,
  practiceReinstructionLevel: null,
  practiceReinstructionHint: null,
  mainReinstruction: false,
  _refs: {
    blockStart: 0,
    ssd: SSD_INITIAL_MS,
    events: [],
    keydownHandler: null,
    responseTimeoutId: undefined,
    stopSignalTimeoutId: undefined,
    nextTrialTimeoutId: undefined,
    maxTrials: MAIN_TRIALS,
    practiceEvents: [],
    practiceConfig: { ...PRACTICE_CONFIG },
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    sstBaselineMedianGoRtMs: null,
  },

  addEvent: (ev) => {
    const { phase } = get();
    if (ev.event_type === "go") {
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

    // Main / extension pass gate + main adaptive engine (not practice).
    if (phase === "main" || phase === "extension") {
      const r = get()._refs;
      const completed = r.events.length;
      const goEvents = r.events.filter((event) => event.event_type === "go");
      /** Spec: no early CAT exit from go accuracy alone — only session length or main-adaptive stop. */
      if (completed >= Math.max(1, get().maxTrials)) {
        catStore.getState().setBlockEndTrigger("session_max_trials");
      }
      const goRts = goEvents
        .filter((e) => typeof e.reaction_time_ms === "number")
        .map((e) => e.reaction_time_ms as number);
      if (r.sstBaselineMedianGoRtMs == null && goEvents.length >= 15) {
        const m = median(goRts);
        if (m != null) r.sstBaselineMedianGoRtMs = m;
      }
      const cp = buildSstCheckpoint(r.events, get().maxTrials, r.sstBaselineMedianGoRtMs);
      r.mainAdaptiveHistory = tryMainAdaptiveStop(
        "sst",
        cp,
        r.mainAdaptiveHistory,
        r.maxTrials,
      ).history;
    }

    // Check for mid-task LLM checkpoint
    const { sessionId, trialIndex } = get();
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialIndex + 1)) {
      const events = get()._refs.events;
      cat.requestCheckpoint(sessionId, "sst", trialIndex + 1, computeSstMetrics(events));
    }

    /** Main trial list is pre-built with guaranteed stop-trial quota (see `finishPractice`). */
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

    // SST special handling: must show GO speed/accuracy and some STOP success.
    const lastFiveGo = _refs.practiceEvents
      .filter((e) => e.event_type === "go")
      .slice(-5);
    const goAcc =
      lastFiveGo.length > 0 ? lastFiveGo.filter((e) => e.is_correct === true).length / lastFiveGo.length : 0;
    const totalStop = _refs.practiceEvents.filter((e) => e.event_type === "stop").length;
    const stopSuccess = _refs.practiceEvents.filter((e) => e.event_type === "stop" && e.is_correct === true).length;
    const anyStopSuccess = stopSuccess > 0;
    const goTrialsEnough = lastFiveGo.length >= 5;
    const sstPassed = goTrialsEnough && goAcc >= 0.8 && totalStop > 0 && anyStopSuccess;

    if (
      updated.totalTrialsCompleted >= config.maxTrials
      || updated.currentBlockTrials % config.evaluationInterval === 0
      || (updated.subPhase === "final" && updated.currentBlockTrials >= config.finalTrialCount)
    ) {
      // Increment blocks completed at evaluation points.
      const shouldCountBlock =
        updated.totalTrialsCompleted % config.evaluationInterval === 0 || updated.totalTrialsCompleted >= config.maxTrials;
      const withBlocks = shouldCountBlock ? { ...updated, blocksCompleted: updated.blocksCompleted + 1 } : updated;

      if (sstPassed) {
        set({
          practiceState: { ...withBlocks, passed: true, lowConfidence: false },
          lastPracticeFeedback: null,
        });
        get().finishPractice();
        return;
      }

      // SST edge-case instructions (practice-only).
      const goTrials = _refs.practiceEvents.filter((e) => e.event_type === "go").length;
      const goResponses = _refs.practiceEvents.filter((e) => e.event_type === "go" && e.reaction_time_ms != null).length;
      const neverStopped = totalStop > 0 && stopSuccess === 0;
      const withheldEveryGo = goTrials >= 5 && goResponses === 0;

      if (neverStopped || withheldEveryGo) {
        set({
          phase: "instructions",
          practiceReinstruction: true,
          practiceReinstructionLevel: "additional",
          practiceReinstructionHint: neverStopped
            ? "When the STOP signal appears, do not press any key. Otherwise respond quickly on GO trials."
            : "Respond quickly on GO trials. Only stop when the STOP signal appears.",
          practiceState: {
            ...withBlocks,
            subPhase: "reinstructions",
            instructionRedisplays: updated.instructionRedisplays + 1,
            currentBlockCorrect: 0,
            currentBlockTrials: 0,
            practiceErrorPattern: "accuracy_low",
          },
          lastPracticeFeedback: null,
        });
        return;
      }

      if (withBlocks.totalTrialsCompleted >= config.maxTrials) {
        set({
          practiceState: { ...withBlocks, passed: false, lowConfidence: true, practiceErrorPattern: "accuracy_low" },
          lastPracticeFeedback: null,
        });
        get().finishPractice();
        return;
      }

      const evaluation = evaluatePracticeBlock(updated, config);
      switch (evaluation.action) {
        case "continue": {
          const remaining = config.maxTrials - updated.totalTrialsCompleted;
          const nextBlockSize = Math.min(config.evaluationInterval, remaining);
          set({
            trials: [...get().trials, ...buildPracticeMixedTrials(nextBlockSize)],
            practiceState: { ...withBlocks, currentBlockCorrect: 0, currentBlockTrials: 0 },
          });
          break;
        }
        case "reinstructions":
          set({
            phase: "instructions",
            practiceReinstruction: true,
            practiceReinstructionLevel: evaluation.level,
            practiceReinstructionHint: evaluation.level === "simplified"
              ? "Press ← for left, → for right. If the STOP signal appears, don’t press."
              : "Tip: respond quickly on GO trials, and only stop when the STOP signal appears.",
            practiceState: {
              ...withBlocks,
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
            trials: [...get().trials, ...buildPracticeMixedTrials(config.finalTrialCount)],
            practiceState: { ...withBlocks, subPhase: "final", currentBlockCorrect: 0, currentBlockTrials: 0 },
            lastPracticeFeedback: null,
          });
          break;
        case "proceed_to_main":
          set({
            practiceState: { ...withBlocks, passed: evaluation.passed, lowConfidence: evaluation.lowConfidence },
          });
          get().finishPractice();
          break;
      }
    }
  },

  advanceTrial: () => {
    if (isTaskPaused()) return;
    const { trials, trialIndex, _refs, addEvent, addPracticeEvent, phase } = get();
    if (
      (phase === "main" || phase === "extension") &&
      catStore.getState().shouldTriggerBlockEnd
    ) {
      return;
    }
    const recordEvent = phase === "practice" ? addPracticeEvent : addEvent;

    // Drop overlapping schedule/listener before this trial (effect cleanup clears timeouts only; leaked keydown caused double scoring).
    if (_refs.keydownHandler) {
      window.removeEventListener("keydown", _refs.keydownHandler);
      _refs.keydownHandler = null;
    }
    if (_refs.responseTimeoutId) {
      clearTimeout(_refs.responseTimeoutId);
      _refs.responseTimeoutId = undefined;
    }
    if (_refs.stopSignalTimeoutId) {
      clearTimeout(_refs.stopSignalTimeoutId);
      _refs.stopSignalTimeoutId = undefined;
    }
    if (_refs.nextTrialTimeoutId) {
      clearTimeout(_refs.nextTrialTimeoutId);
      _refs.nextTrialTimeoutId = undefined;
    }

    if (trialIndex >= trials.length) return;

    const trial = trials[trialIndex];
    const onset = performance.now();
    const currentSsd = _refs.ssd;
    const responseDeadline = defaultAdaptiveParams.responseDeadline;

    if (trial.type === "go") {
      set({ currentStimulus: trial.direction });
      let responded = false;
      let pressedKey: string | null = null;
      let pressedAt: number | null = null;

      const finishGoTrial = () => {
        window.removeEventListener("keydown", handleKey);
        if (_refs.keydownHandler === handleKey) _refs.keydownHandler = null;
        if (_refs.responseTimeoutId) {
          clearTimeout(_refs.responseTimeoutId);
          _refs.responseTimeoutId = undefined;
        }
        const correctKey = trial.direction === "left" ? "ArrowLeft" : "ArrowRight";
        if (responded && pressedKey && pressedAt) {
          recordEvent({
            task_name: "sst",
            trial_index: trialIndex,
            stimulus_onset_ms: onset,
            keypress_ms: pressedAt,
            reaction_time_ms: pressedAt - onset,
            response_key: pressedKey,
            correct_key: correctKey,
            is_correct: pressedKey === correctKey,
            event_type: "go",
            isi_ms: trialIndex === 0 ? null : trial.isi_ms,
          });
        } else {
          recordEvent({
            task_name: "sst",
            trial_index: trialIndex,
            stimulus_onset_ms: onset,
            keypress_ms: null,
            reaction_time_ms: null,
            response_key: null,
            correct_key: correctKey,
            is_correct: false,
            event_type: "go",
            isi_ms: trialIndex === 0 ? null : trial.isi_ms,
          });
        }
        const s = get();
        if (s.phase !== phase || s.trialIndex !== trialIndex) return;
        const stopHere = catStore.getState().shouldTriggerBlockEnd;
        if (!stopHere) {
          /** Keep last stimulus during ISI — blank/+ fixation telegraphs upcoming stop trials. */
          set({ trialIndex: trialIndex + 1 });
          _refs.nextTrialTimeoutId = setTimeout(() => {
            _refs.nextTrialTimeoutId = undefined;
            get().advanceTrial();
          }, trial.isi_ms);
        } else {
          set({ currentStimulus: null });
        }
      };

      const handleKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (!GO_KEYS.includes(e.key)) return;
        if (responded) return;
        e.preventDefault();
        responded = true;
        pressedKey = e.key;
        pressedAt = performance.now();
        // Fast-path: once user responded, finalize trial immediately.
        finishGoTrial();
      };
      _refs.keydownHandler = handleKey;
      window.addEventListener("keydown", handleKey);
      _refs.responseTimeoutId = setTimeout(() => {
        finishGoTrial();
      }, responseDeadline);
    } else {
      _refs.stopSignalTimeoutId = setTimeout(() => set({ currentStimulus: "stop" }), currentSsd);
      let responded = false;
      let pressedKey: string | null = null;
      let pressedAt: number | null = null;

      const handleKey = (e: KeyboardEvent) => {
        if (e.repeat) return;
        if (!GO_KEYS.includes(e.key)) return;
        if (responded) return;
        e.preventDefault();
        responded = true;
        pressedKey = e.key;
        pressedAt = performance.now();
      };
      _refs.keydownHandler = handleKey;
      window.addEventListener("keydown", handleKey);

      _refs.responseTimeoutId = setTimeout(() => {
        window.removeEventListener("keydown", handleKey);
        if (_refs.keydownHandler === handleKey) _refs.keydownHandler = null;
        if (_refs.stopSignalTimeoutId) clearTimeout(_refs.stopSignalTimeoutId);
        if (responded && pressedKey && pressedAt) {
          recordEvent({
            task_name: "sst",
            trial_index: trialIndex,
            stimulus_onset_ms: onset,
            keypress_ms: pressedAt,
            reaction_time_ms: pressedAt - onset,
            response_key: pressedKey,
            correct_key: "NO_KEY",
            is_correct: false,
            event_type: "stop",
            isi_ms: currentSsd,
          });
          _refs.ssd = Math.max(SSD_MIN_MS, currentSsd - SSD_STEP_MS);
        } else {
          recordEvent({
            task_name: "sst",
            trial_index: trialIndex,
            stimulus_onset_ms: onset,
            keypress_ms: null,
            reaction_time_ms: null,
            response_key: null,
            correct_key: null,
            is_correct: true,
            event_type: "stop",
            isi_ms: currentSsd,
          });
          _refs.ssd = Math.min(SSD_MAX_MS, currentSsd + SSD_STEP_MS);
        }
        const s = get();
        if (s.phase !== phase || s.trialIndex !== trialIndex) return;
        const stopHere = catStore.getState().shouldTriggerBlockEnd;
        if (!stopHere) {
          set({ trialIndex: trialIndex + 1 });
          _refs.stopSignalTimeoutId = undefined;
          _refs.responseTimeoutId = undefined;
          _refs.nextTrialTimeoutId = setTimeout(() => {
            _refs.nextTrialTimeoutId = undefined;
            get().advanceTrial();
          }, trial.isi_ms);
        } else {
          set({ currentStimulus: null });
          _refs.stopSignalTimeoutId = undefined;
          _refs.responseTimeoutId = undefined;
        }
      }, currentSsd + 800);
    }
  },

  startPractice: async () => {
    const { _refs } = get();
    catStore.getState().resetForNewTask();
    try {
      const res = await sessionsService.create("sst");
      const taskConfig = await catStore.getState().loadTaskConfig(res.session_id, "sst");

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
      _refs.ssd = SSD_INITIAL_MS;
      _refs.events = [];
      _refs.practiceEvents = [];
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
      set({
        sessionId: res.session_id,
        phase: "practice",
        trials: buildPracticeMixedTrials(initialPracticeBlockSize),
        trialIndex: 0,
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
      });
      toast.info("Practice: press ← or → for arrow direction.");
    } catch {
      const config = _refs.practiceConfig;
      _refs.blockStart = performance.now();
      _refs.ssd = SSD_INITIAL_MS;
      _refs.events = [];
      _refs.practiceEvents = [];
      const initialPracticeBlockSize = Math.min(config.evaluationInterval, config.maxTrials);
      set({
        phase: "practice",
        trials: buildPracticeMixedTrials(initialPracticeBlockSize),
        trialIndex: 0,
        events: [],
        practiceState: createPracticeState(),
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        practiceReinstructionLevel: null,
        practiceReinstructionHint: null,
      });
      toast.info("Practice: press ← or → for arrow direction.");
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
      trials: buildPracticeMixedTrials(initialPracticeBlockSize),
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

  finishPractice: () => {
    const { _refs, practiceState } = get();

    (async () => {
      await new Promise((r) => setTimeout(r, PRACTICE_FEEDBACK_FINISH_DELAY_MS));
      set({ trials: [], trialIndex: 0 });

      let sid = get().sessionId;
      if (!sid) {
        const res = await sessionsService.create("sst");
        sid = res.session_id;
        set({ sessionId: sid });
      }

      // Post practice events
      if (_refs.practiceEvents.length > 0) {
        const practiceEventsWithFlag = _refs.practiceEvents.map((ev) => ({
          ...ev,
          extra_data: { ...(ev.extra_data as Record<string, unknown> || {}), is_practice: true },
        }));
        await sessionsService.postEvents(sid, practiceEventsWithFlag);
      }

      // Post practice metadata
      const meta = practiceState ? getPracticeMetadata(practiceState) : null;
      if (meta) {
        await sessionsService.postBlocks(sid, {
          task_name: "sst",
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
      _refs.sstBaselineMedianGoRtMs = null;
      catStore.getState().resetForNewTask();

      const config = await catStore.getState().loadTaskConfig(sid, "sst");
      const trialCount = config?.max_trials ?? MAIN_TRIALS;
      _refs.maxTrials = trialCount;
      const minStop = sstMinStopTrialsForSession(trialCount);

      set({
        phase: "main",
        trials: buildSstMainTrialSchedule(trialCount, minStop),
        maxTrials: trialCount,
        trialIndex: 0,
        events: [],
        mainReinstruction: false,
      });
      toast.success("Practice complete. Starting main task.");
    })().catch((err) => toast.error(err instanceof Error ? err.message : "Failed to start"));
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    _refs.events = [];
    _refs.blockStart = performance.now();
    _refs.maxTrials = trialsToAdd;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.sstBaselineMedianGoRtMs = null;
    catStore.getState().resetForNewTask();

    const minStop = sstMinStopTrialsForSession(trialsToAdd);
    set({
      events: [],
      trials: buildSstMainTrialSchedule(trialsToAdd, minStop),
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
    _refs.maxTrials = maxTrials;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.sstBaselineMedianGoRtMs = null;
    catStore.getState().resetForNewTask();
    const minStop = sstMinStopTrialsForSession(maxTrials);
    set({
      trials: buildSstMainTrialSchedule(maxTrials, minStop),
      maxTrials,
      trialIndex: 0,
      phase: "main",
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
    if (_refs.events.length > 0) {
      try {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
        _refs.events = [];
        set({ events: [] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send events");
      }
    }
    try {
      const check = await sessionsService.getSstStoppingCheck(sessionId);
      if (check.should_stop && check.met_floor) toast.success("Task completed early.");
    } catch {
      /* non-fatal */
    }
    const blockEnd = performance.now();
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "sst",
        block_index: 0,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: blockEnd,
      });
      await sessionsService.scoreSst(sessionId);
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
    const blockEnd = performance.now();
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "sst",
        block_index: 1,
        practice_pass: false,
        block_start_ts: _refs.blockStart,
        block_end_ts: blockEnd,
      });
      await sessionsService.scoreSst(sessionId);
      toast.success("Extension block complete. Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.keydownHandler) {
      window.removeEventListener("keydown", _refs.keydownHandler);
      _refs.keydownHandler = null;
    }
    if (_refs.responseTimeoutId) clearTimeout(_refs.responseTimeoutId);
    if (_refs.stopSignalTimeoutId) clearTimeout(_refs.stopSignalTimeoutId);
    if (_refs.nextTrialTimeoutId) clearTimeout(_refs.nextTrialTimeoutId);
    _refs.responseTimeoutId = undefined;
    _refs.stopSignalTimeoutId = undefined;
    _refs.nextTrialTimeoutId = undefined;
  },

  resumeAfterPause: () => {
    const { phase, trials, trialIndex, _refs } = get();
    if (phase !== "practice" && phase !== "main" && phase !== "extension") return;
    if (catStore.getState().shouldTriggerBlockEnd) return;
    if (trialIndex >= trials.length) return;
    if (
      !_refs.responseTimeoutId &&
      !_refs.stopSignalTimeoutId &&
      !_refs.nextTrialTimeoutId
    ) {
      get().advanceTrial();
    }
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.blockStart = 0;
    _refs.ssd = SSD_INITIAL_MS;
    _refs.events = [];
    _refs.keydownHandler = null;
    _refs.responseTimeoutId = undefined;
    _refs.stopSignalTimeoutId = undefined;
    _refs.nextTrialTimeoutId = undefined;
    _refs.maxTrials = MAIN_TRIALS;
    _refs.practiceEvents = [];
    _refs.practiceConfig = { ...PRACTICE_CONFIG };
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.sstBaselineMedianGoRtMs = null;

    catStore.getState().resetForNewTask();

    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: MAIN_TRIALS,
      currentStimulus: null,
      events: [],
      additionalTrials: 0,
      practiceState: null,
      lastPracticeFeedback: null,
      practiceReinstruction: false,
      mainReinstruction: false,
    });
  },
}));
