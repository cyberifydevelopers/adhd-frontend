import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS, PRACTICE_CONFIG } from "@/config/catConfig";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildWmDistractionCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";

const TASK_NAME = "wm_distraction";
const MIN_SPAN = 3;
const MAX_SPAN = 7;
const INITIAL_SPAN = 4;
/** Mild distractor pacing (spec 13): slower tick, fewer symbols, no response required. */
const DISTRACTION_SYMBOL_TICK_MS = 760;
const FEEDBACK_MS = 600;
const MIN_DISTRACTOR_ITEMS = 4;
const MAX_DISTRACTOR_ITEMS = 6;
const CLEAN_ENCODE_SETTLE_MS = 450;
/** Matches wm-distraction task UI digit pacing. */
const DIGIT_DISPLAY_MS = 800;

export type WMDPhase =
  | "instructions"
  | "presenting"
  | "distracting"
  | "recalling"
  | "feedback"
  | "complete";

export type WmCondition = "clean" | "distracted";

export type WMDTrial = {
  span: number;
  digits: number[];
  distractors: string[];
  condition: WmCondition;
};

const DISTRACTOR_POOL = ["·", "○", "△", "◇", "□", "◦"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTrial(span: number, condition: WmCondition): WMDTrial {
  const digits: number[] = [];
  for (let i = 0; i < span; i += 1) {
    let next = randomInt(0, 9);
    while (i > 0 && next === digits[i - 1]) {
      next = randomInt(0, 9);
    }
    digits.push(next);
  }
  const distractorCount =
    condition === "distracted" ? randomInt(MIN_DISTRACTOR_ITEMS, MAX_DISTRACTOR_ITEMS) : 0;
  const distractors = Array.from(
    { length: distractorCount },
    () => DISTRACTOR_POOL[randomInt(0, DISTRACTOR_POOL.length - 1)]!,
  );
  return { span, digits, distractors, condition };
}

function getRecallTimeoutMs(span: number): number {
  return Math.max(5000, (span + 3) * 1000);
}

function getNextSpanPractice(currentSpan: number, correct: boolean): number {
  const stepped = correct
    ? Math.min(MAX_SPAN, currentSpan + 1)
    : Math.max(MIN_SPAN, currentSpan - 1);
  if (stepped !== currentSpan) return stepped;
  const candidates: number[] = [];
  for (let s = MIN_SPAN; s <= MAX_SPAN; s += 1) {
    if (s !== currentSpan) candidates.push(s);
  }
  return candidates.length > 0 ? candidates[randomInt(0, candidates.length - 1)]! : currentSpan;
}

type PendingConfirm = { condition: WmCondition; span: number };

type Refs = {
  events: Record<string, unknown>[];
  blockStart: number;
  phaseStartedAt: number;
  recallStartedAt: number;
  digitsPresentationComplete: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  distractorTimerId: ReturnType<typeof setInterval> | null;
  distractorIdx: number;
  practiceTrialsTarget: number;
  mainTrialsTarget: number;
  mainTrialsDone: number;
  practiceTrialsDone: number;
  recallSubmitCommitted: boolean;
  practiceConsecutiveCorrect: number;
  practiceBlockStart: number;
  mainAdaptiveHistory: AdaptiveHistory;
  /** Independent staircases (spec 13). */
  spanClean: number;
  spanDistracted: number;
  pairClean: boolean[];
  pairDistracted: boolean[];
  pendingConfirm: PendingConfirm | null;
  cleanPairsResolved: number;
  distractedPairsResolved: number;
  cleanReversals: number;
  distractedReversals: number;
  cleanFloor: boolean;
  distractedFloor: boolean;
  wmEarlyInputFlag: boolean;
  wmDistractorUnderstandingNoted: boolean;
  wmPracticeFloorFlag: boolean;
};

function nextMainCondition(refs: Refs, mainTrialsDone: number): WmCondition {
  if (refs.pendingConfirm) return refs.pendingConfirm.condition;
  return mainTrialsDone % 2 === 0 ? "clean" : "distracted";
}

function spanForCondition(refs: Refs, cond: WmCondition): number {
  if (refs.pendingConfirm && refs.pendingConfirm.condition === cond) return refs.pendingConfirm.span;
  return cond === "clean" ? refs.spanClean : refs.spanDistracted;
}

function setSpanForCondition(refs: Refs, cond: WmCondition, span: number): void {
  const s = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span));
  if (cond === "clean") refs.spanClean = s;
  else refs.spanDistracted = s;
}

function applyStaircaseAfterPair(
  refs: Refs,
  cond: WmCondition,
  a: boolean,
  b: boolean,
): void {
  const sum = (a ? 1 : 0) + (b ? 1 : 0);
  const span = spanForCondition(refs, cond);
  if (sum === 2) {
    setSpanForCondition(refs, cond, span + 1);
    if (cond === "clean") refs.cleanPairsResolved += 1;
    else refs.distractedPairsResolved += 1;
  } else if (sum === 0) {
    setSpanForCondition(refs, cond, span - 1);
    if (cond === "clean") {
      refs.cleanReversals += 1;
      if (refs.spanClean <= MIN_SPAN) refs.cleanFloor = true;
    } else {
      refs.distractedReversals += 1;
      if (refs.spanDistracted <= MIN_SPAN) refs.distractedFloor = true;
    }
    if (cond === "clean") refs.cleanPairsResolved += 1;
    else refs.distractedPairsResolved += 1;
  } else {
    refs.pendingConfirm = { condition: cond, span };
  }
}

function applyConfirmationResult(refs: Refs, cond: WmCondition, correct: boolean): void {
  const span = refs.pendingConfirm?.span ?? spanForCondition(refs, cond);
  refs.pendingConfirm = null;
  if (correct) {
    setSpanForCondition(refs, cond, span + 1);
  } else {
    setSpanForCondition(refs, cond, span - 1);
    if (cond === "clean") {
      refs.cleanReversals += 1;
      if (refs.spanClean <= MIN_SPAN) refs.cleanFloor = true;
    } else {
      refs.distractedReversals += 1;
      if (refs.spanDistracted <= MIN_SPAN) refs.distractedFloor = true;
    }
  }
  if (cond === "clean") refs.cleanPairsResolved += 1;
  else refs.distractedPairsResolved += 1;
}

function computeWmDistractorCost(events: Record<string, unknown>[]): number | null {
  const main = events.filter((e) => (e.extra_data as Record<string, unknown> | undefined)?.is_practice !== true);
  let cC = 0;
  let nC = 0;
  let cD = 0;
  let nD = 0;
  for (const e of main) {
    const ex = e.extra_data as Record<string, unknown> | undefined;
    const cond = ex?.wm_condition as string | undefined;
    if (cond !== "clean" && cond !== "distracted") continue;
    const ok = e.is_correct === true;
    if (cond === "clean") {
      nC += 1;
      if (ok) cC += 1;
    } else {
      nD += 1;
      if (ok) cD += 1;
    }
  }
  if (nC === 0 || nD === 0) return null;
  return cC / nC - cD / nD;
}

function maxSpanCorrect(events: Record<string, unknown>[], cond: WmCondition): number | null {
  let m = 0;
  let any = false;
  for (const e of events) {
    const ex = e.extra_data as Record<string, unknown> | undefined;
    if (ex?.is_practice === true) continue;
    if ((ex?.wm_condition as string | undefined) !== cond) continue;
    if (e.is_correct !== true) continue;
    const len = Number(ex?.sequence_length ?? 0);
    if (len > 0) {
      any = true;
      m = Math.max(m, len);
    }
  }
  return any ? m : null;
}

function computeWmBatteryComplete(refs: Refs, mainDone: number, mainTarget: number): boolean {
  if (mainDone >= mainTarget) return true;
  const minPairs = 2;
  const cleanSealed =
    refs.cleanPairsResolved >= minPairs &&
    (refs.cleanReversals >= 1 || refs.cleanFloor || refs.spanClean >= MAX_SPAN);
  const distSealed =
    refs.distractedPairsResolved >= minPairs &&
    (refs.distractedReversals >= 1 || refs.distractedFloor || refs.spanDistracted >= MAX_SPAN);
  return cleanSealed && distSealed && mainDone >= MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.wm_distraction.minTrials;
}

function buildWmCheckpointArgs(refs: Refs, mainDone: number, mainTarget: number, reachedMax: boolean) {
  const trialsClean = refs.events.filter(
    (e) => (e.extra_data as Record<string, unknown> | undefined)?.wm_condition === "clean" &&
      (e.extra_data as Record<string, unknown> | undefined)?.is_practice !== true,
  ).length;
  const trialsDistracted = refs.events.filter(
    (e) => (e.extra_data as Record<string, unknown> | undefined)?.wm_condition === "distracted" &&
      (e.extra_data as Record<string, unknown> | undefined)?.is_practice !== true,
  ).length;
  const wmMinTrialsPerConditionMet = trialsClean >= 2 && trialsDistracted >= 2;
  const batteryStrict = computeWmBatteryComplete(refs, mainDone, mainTarget);
  const cost = computeWmDistractorCost(refs.events);
  return {
    sequencesCompleted: mainDone,
    wmBatteryComplete: batteryStrict,
    wmMaxCleanLoad: maxSpanCorrect(refs.events, "clean"),
    wmMaxDistractedLoad: maxSpanCorrect(refs.events, "distracted"),
    wmDistractorCost: cost,
    wmTrialsClean: trialsClean,
    wmTrialsDistracted: trialsDistracted,
    wmMinTrialsPerConditionMet,
    wmEarlyInputFlag: refs.wmEarlyInputFlag,
    wmDistractorUnderstandingFlag: refs.wmDistractorUnderstandingNoted,
    wmFloorAfterPracticeFlag: refs.wmPracticeFloorFlag,
    wmInconsistentAtMax: reachedMax && !batteryStrict,
  };
}

type WMDistractionState = {
  phase: WMDPhase;
  sessionId: string | null;
  events: Record<string, unknown>[];
  currentSpan: number;
  trialIndex: number;
  trial: WMDTrial | null;
  displayIndex: number;
  currentDistractor: string | null;
  userInput: string;
  maxSpanReached: number;
  isPractice: boolean;
  practiceTotalTrials: number;
  mainTotalTrials: number;
  practiceDoneTrials: number;
  mainDoneTrials: number;
  lastCorrect: boolean | null;
  lastExpected: string;
  lastEntered: string;
  /** Main only: which ladder this trial used. */
  mainConditionLabel: WmCondition | null;
  _refs: Refs;
  advanceDisplay: () => void;
  setUserInput: (v: string) => void;
  submitRecall: () => void;
  startSession: () => Promise<void>;
  finishAndSave: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
  _startTrial: () => void;
  markDistractorUnderstanding: () => void;
};

export const wmDistractionStore = create<WMDistractionState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  events: [],
  currentSpan: INITIAL_SPAN,
  trialIndex: 0,
  trial: null,
  displayIndex: -1,
  currentDistractor: null,
  userInput: "",
  maxSpanReached: INITIAL_SPAN,
  isPractice: true,
  practiceTotalTrials: 0,
  mainTotalTrials: 0,
  practiceDoneTrials: 0,
  mainDoneTrials: 0,
  lastCorrect: null,
  lastExpected: "",
  lastEntered: "",
  mainConditionLabel: null,
  _refs: {
    events: [],
    blockStart: 0,
    phaseStartedAt: 0,
    recallStartedAt: 0,
    digitsPresentationComplete: false,
    timerId: null,
    distractorTimerId: null,
    distractorIdx: 0,
    practiceTrialsTarget: 0,
    mainTrialsTarget: 0,
    mainTrialsDone: 0,
    practiceTrialsDone: 0,
    recallSubmitCommitted: false,
    practiceConsecutiveCorrect: 0,
    practiceBlockStart: 0,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    spanClean: INITIAL_SPAN,
    spanDistracted: INITIAL_SPAN,
    pairClean: [],
    pairDistracted: [],
    pendingConfirm: null,
    cleanPairsResolved: 0,
    distractedPairsResolved: 0,
    cleanReversals: 0,
    distractedReversals: 0,
    cleanFloor: false,
    distractedFloor: false,
    wmEarlyInputFlag: false,
    wmDistractorUnderstandingNoted: false,
    wmPracticeFloorFlag: false,
  },

  markDistractorUnderstanding: () => {
    get()._refs.wmDistractorUnderstandingNoted = true;
    toast.info("Noted: distractor difficulty flagged for review.");
  },

  _startTrial: () => {
    const { _refs, isPractice } = get();
    const cond: WmCondition = isPractice ? "distracted" : nextMainCondition(_refs, _refs.mainTrialsDone);
    const span = isPractice ? get().currentSpan : spanForCondition(_refs, cond);
    const trial = generateTrial(span, cond);
    _refs.phaseStartedAt = performance.now();
    _refs.distractorIdx = 0;
    _refs.digitsPresentationComplete = false;
    set({
      trial,
      phase: "presenting",
      displayIndex: 0,
      currentDistractor: null,
      userInput: "",
      lastCorrect: null,
      lastExpected: "",
      lastEntered: "",
      currentSpan: span,
      trialIndex: isPractice ? _refs.practiceTrialsDone : _refs.mainTrialsDone,
      mainConditionLabel: isPractice ? null : cond,
    });
  },

  advanceDisplay: () => {
    if (isTaskPaused()) return;
    const { trial, displayIndex, isPractice, _refs } = get();
    if (!trial || displayIndex < 0) return;

    if (displayIndex >= trial.digits.length - 1) {
      _refs.digitsPresentationComplete = true;
      const goRecall = () => {
        const state = get();
        const activeTrial = state.trial;
        if (!activeTrial) return;
        if (state._refs.distractorTimerId) {
          clearInterval(state._refs.distractorTimerId);
          state._refs.distractorTimerId = null;
        }
        state._refs.recallStartedAt = performance.now();
        state._refs.recallSubmitCommitted = false;
        set({
          phase: "recalling",
          currentDistractor: null,
          userInput: "",
        });
        if (state._refs.timerId) clearTimeout(state._refs.timerId);
        // Practice recall is not time-limited — the user must click Submit.
        if (!state.isPractice) {
          state._refs.timerId = setTimeout(() => {
            state.submitRecall();
          }, getRecallTimeoutMs(activeTrial.span));
        }
      };

      if (trial.condition === "clean" && !isPractice) {
        if (_refs.timerId) clearTimeout(_refs.timerId);
        _refs.timerId = setTimeout(goRecall, CLEAN_ENCODE_SETTLE_MS);
        return;
      }

      set({
        phase: "distracting",
        currentDistractor: trial.distractors[0] ?? null,
      });

      if (_refs.distractorTimerId) clearInterval(_refs.distractorTimerId);
      _refs.distractorTimerId = setInterval(() => {
        const state = get();
        const activeTrial = state.trial;
        if (!activeTrial || activeTrial.distractors.length === 0) return;
        const idx = state._refs.distractorIdx % activeTrial.distractors.length;
        set({ currentDistractor: activeTrial.distractors[idx] });
        state._refs.distractorIdx += 1;
      }, DISTRACTION_SYMBOL_TICK_MS);

      if (_refs.timerId) clearTimeout(_refs.timerId);
      const distractionDurationMs = Math.max(
        DISTRACTION_SYMBOL_TICK_MS,
        trial.distractors.length * DISTRACTION_SYMBOL_TICK_MS,
      );
      _refs.timerId = setTimeout(goRecall, distractionDurationMs);
      return;
    }

    set({ displayIndex: displayIndex + 1 });
  },

  setUserInput: (v) => set({ userInput: v }),

  submitRecall: () => {
    if (isTaskPaused()) return;
    const { trial, userInput, maxSpanReached, isPractice, phase, _refs } = get();
    if (!trial || phase !== "recalling") return;
    if (_refs.recallSubmitCommitted) return;
    if (!_refs.digitsPresentationComplete) {
      _refs.wmEarlyInputFlag = true;
    }
    _refs.recallSubmitCommitted = true;
    if (_refs.timerId) {
      clearTimeout(_refs.timerId);
      _refs.timerId = null;
    }

    const entered = userInput.split("").map(Number);
    const expected = trial.digits;
    const correct = entered.length === expected.length && entered.every((d, i) => d === expected[i]);
    const now = performance.now();
    const responseTime = Math.max(0, now - _refs.recallStartedAt);

    const wmCondition: WmCondition = trial.condition;
    _refs.events.push({
      task_name: TASK_NAME,
      trial_index: isPractice ? _refs.practiceTrialsDone : _refs.mainTrialsDone,
      stimulus_onset_ms: _refs.phaseStartedAt,
      keypress_ms: now,
      reaction_time_ms: responseTime,
      is_correct: correct,
      correct_key: expected.join(""),
      event_type: "recall",
      extra_data: {
        trial: (isPractice ? _refs.practiceTrialsDone : _refs.mainTrialsDone) + 1,
        sequence: expected,
        user_input: entered,
        correct,
        sequence_length: trial.span,
        response_time_ms: responseTime,
        is_practice: isPractice,
        wm_condition: wmCondition,
        wm_early_input: !_refs.digitsPresentationComplete,
        distractor_understanding_noted: _refs.wmDistractorUnderstandingNoted,
      },
    });

    const nextMaxSpan = correct ? Math.max(maxSpanReached, trial.span) : maxSpanReached;

    set({
      events: [..._refs.events],
      phase: "feedback",
      lastCorrect: correct,
      lastExpected: expected.join(""),
      lastEntered: entered.join(""),
      maxSpanReached: nextMaxSpan,
    });

    _refs.timerId = setTimeout(() => {
      const state = get();
      if (state.isPractice) {
        state._refs.practiceTrialsDone += 1;
        state._refs.practiceConsecutiveCorrect = correct ? state._refs.practiceConsecutiveCorrect + 1 : 0;
        set({ practiceDoneTrials: state._refs.practiceTrialsDone });
        const practiceDone = state._refs.practiceTrialsDone;
        const practiceMin = 2;
        const practiceMax = Math.max(practiceMin, Number(PRACTICE_CONFIG.maxTrials) || 20);
        const spanPass = state._refs.practiceConsecutiveCorrect >= 2;
        const passed = practiceDone >= practiceMin && spanPass;
        const hitMax = practiceDone >= Math.min(practiceMax, state._refs.practiceTrialsTarget);

        if (passed || hitMax) {
          const practiceEvents = state._refs.events.filter(
            (e) => (e.extra_data as Record<string, unknown> | undefined)?.is_practice === true,
          );
          const practiceAccuracy = practiceEvents.length > 0
            ? practiceEvents.filter((e) => e.is_correct === true).length / practiceEvents.length
            : 0;
          const lowConfidence = !passed;
          if (!passed) state._refs.wmPracticeFloorFlag = true;
          const errorPattern = passed ? null : "span_failure";
          const sid = state.sessionId;
          (async () => {
            try {
              if (sid && practiceEvents.length > 0) {
                await sessionsService.postEvents(sid, [...practiceEvents]);
                await sessionsService.postBlocks(sid, {
                  task_name: TASK_NAME,
                  block_index: -1,
                  practice_pass: passed,
                  practice_accuracy: practiceAccuracy,
                  practice_trial_count: practiceEvents.length,
                  low_confidence_flag: lowConfidence,
                  practice_blocks_completed: Math.ceil(practiceEvents.length / 5),
                  practice_error_pattern: errorPattern ?? undefined,
                  block_start_ts: state._refs.practiceBlockStart,
                  block_end_ts: performance.now(),
                });
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to save practice");
            }
          })();

          set({
            isPractice: false,
            currentSpan: INITIAL_SPAN,
            practiceDoneTrials: state._refs.practiceTrialsDone,
            events: [],
            mainConditionLabel: null,
          });
          state._refs.events = [];
          state._refs.spanClean = INITIAL_SPAN;
          state._refs.spanDistracted = INITIAL_SPAN;
          state._refs.pairClean = [];
          state._refs.pairDistracted = [];
          state._refs.pendingConfirm = null;
          state._refs.cleanPairsResolved = 0;
          state._refs.distractedPairsResolved = 0;
          state._refs.cleanReversals = 0;
          state._refs.distractedReversals = 0;
          state._refs.cleanFloor = false;
          state._refs.distractedFloor = false;
          state._refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
          state._startTrial();
          return;
        }
        set({
          lastCorrect: null,
          lastExpected: "",
          lastEntered: "",
          currentSpan: getNextSpanPractice(state.currentSpan, correct),
          maxSpanReached: correct
            ? Math.max(state.maxSpanReached, state.trial?.span ?? 0)
            : state.maxSpanReached,
        });
      } else {
        const cond = wmCondition;
        if (state._refs.pendingConfirm && state._refs.pendingConfirm.condition === cond) {
          applyConfirmationResult(state._refs, cond, correct);
        } else {
          const buf = cond === "clean" ? state._refs.pairClean : state._refs.pairDistracted;
          buf.push(correct);
          if (buf.length >= 2) {
            const [x, y] = [buf[0]!, buf[1]!];
            buf.length = 0;
            applyStaircaseAfterPair(state._refs, cond, x, y);
          }
        }

        state._refs.mainTrialsDone += 1;
        set({
          mainDoneTrials: state._refs.mainTrialsDone,
          currentSpan: Math.max(state._refs.spanClean, state._refs.spanDistracted),
        });
        catStore.getState().addTrial({
          reaction_time_ms: responseTime,
          expected_response: true,
        });
        const done = state._refs.mainTrialsDone;
        const reachedMax = done >= state._refs.mainTrialsTarget;
        const cpArgs = buildWmCheckpointArgs(state._refs, done, state._refs.mainTrialsTarget, reachedMax);
        state._refs.mainAdaptiveHistory = tryMainAdaptiveStop(
          "wm_distraction",
          buildWmDistractionCheckpoint({
            ...cpArgs,
            wmBatteryComplete: cpArgs.wmBatteryComplete || reachedMax,
          }),
          state._refs.mainAdaptiveHistory,
          state._refs.mainTrialsTarget,
        ).history;
        if (reachedMax || cpArgs.wmBatteryComplete) {
          set({
            phase: "complete",
            currentSpan: state._refs.spanClean,
            maxSpanReached: state.maxSpanReached,
            mainConditionLabel: null,
          });
          return;
        }
      }
      state._startTrial();
    }, FEEDBACK_MS);
  },

  startSession: async () => {
    try {
      const res = await sessionsService.create(TASK_NAME);
      catStore.getState().resetForNewTask();
      const config = await catStore.getState().loadTaskConfig(res.session_id, TASK_NAME);
      const practiceTrials = Math.floor(Number(config?.practice_config?.max_trials));
      let mainTrials = Math.floor(Number(config?.max_trials));
      if (!Number.isFinite(practiceTrials) || practiceTrials < 1) {
        throw new Error("Missing CAT practice max_trials for wm_distraction.");
      }
      if (!Number.isFinite(mainTrials) || mainTrials < 1) {
        throw new Error("Missing CAT main max_trials for wm_distraction.");
      }
      const lim = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.wm_distraction;
      mainTrials = Math.min(lim.maxTrials, Math.max(lim.minTrials, mainTrials));

      const { _refs } = get();
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      get().cleanup();
      _refs.events = [];
      _refs.blockStart = performance.now();
      _refs.practiceBlockStart = performance.now();
      _refs.practiceTrialsTarget = practiceTrials;
      _refs.mainTrialsTarget = mainTrials;
      _refs.practiceTrialsDone = 0;
      _refs.mainTrialsDone = 0;
      _refs.recallSubmitCommitted = false;
      _refs.practiceConsecutiveCorrect = 0;
      _refs.spanClean = INITIAL_SPAN;
      _refs.spanDistracted = INITIAL_SPAN;
      _refs.pairClean = [];
      _refs.pairDistracted = [];
      _refs.pendingConfirm = null;
      _refs.cleanPairsResolved = 0;
      _refs.distractedPairsResolved = 0;
      _refs.cleanReversals = 0;
      _refs.distractedReversals = 0;
      _refs.cleanFloor = false;
      _refs.distractedFloor = false;
      _refs.wmEarlyInputFlag = false;
      _refs.wmDistractorUnderstandingNoted = false;
      _refs.wmPracticeFloorFlag = false;

      set({
        sessionId: res.session_id,
        events: [],
        currentSpan: INITIAL_SPAN,
        trialIndex: 0,
        maxSpanReached: INITIAL_SPAN,
        isPractice: true,
        practiceTotalTrials: practiceTrials,
        mainTotalTrials: mainTrials,
        practiceDoneTrials: 0,
        mainDoneTrials: 0,
        mainConditionLabel: null,
      });
      get()._startTrial();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  finishAndSave: async () => {
    const { sessionId, _refs } = get();
    if (!sessionId || _refs.events.length === 0) return;
    try {
      await sessionsService.postEvents(sessionId, [..._refs.events]);
      await sessionsService.postBlocks(sessionId, {
        task_name: TASK_NAME,
        block_index: 0,
        block_start_ts: _refs.blockStart,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreWmDistraction(sessionId);
      toast.success("Working memory under distraction results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.timerId) clearTimeout(_refs.timerId);
    if (_refs.distractorTimerId) clearInterval(_refs.distractorTimerId);
    _refs.timerId = null;
    _refs.distractorTimerId = null;
  },

  resumeAfterPause: () => {
    const state = get();
    const { phase, trial, displayIndex, _refs } = state;
    if (!trial) return;
    if (phase === "presenting") {
      if (displayIndex >= trial.digits.length) {
        state.advanceDisplay();
      } else {
        _refs.timerId = setTimeout(() => get().advanceDisplay(), DIGIT_DISPLAY_MS);
      }
      return;
    }
    if (phase === "distracting") {
      state.advanceDisplay();
      return;
    }
    if (phase === "recalling" && !_refs.recallSubmitCommitted && !state.isPractice) {
      _refs.timerId = setTimeout(() => get().submitRecall(), getRecallTimeoutMs(trial.span));
    }
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.events = [];
    _refs.blockStart = 0;
    _refs.phaseStartedAt = 0;
    _refs.recallStartedAt = 0;
    _refs.digitsPresentationComplete = false;
    _refs.timerId = null;
    _refs.distractorTimerId = null;
    _refs.distractorIdx = 0;
    _refs.practiceTrialsTarget = 0;
    _refs.mainTrialsTarget = 0;
    _refs.mainTrialsDone = 0;
    _refs.practiceTrialsDone = 0;
    _refs.recallSubmitCommitted = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.spanClean = INITIAL_SPAN;
    _refs.spanDistracted = INITIAL_SPAN;
    _refs.pairClean = [];
    _refs.pairDistracted = [];
    _refs.pendingConfirm = null;
    _refs.cleanPairsResolved = 0;
    _refs.distractedPairsResolved = 0;
    _refs.cleanReversals = 0;
    _refs.distractedReversals = 0;
    _refs.cleanFloor = false;
    _refs.distractedFloor = false;
    _refs.wmEarlyInputFlag = false;
    _refs.wmDistractorUnderstandingNoted = false;
    _refs.wmPracticeFloorFlag = false;
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      sessionId: null,
      events: [],
      currentSpan: INITIAL_SPAN,
      trialIndex: 0,
      trial: null,
      displayIndex: -1,
      currentDistractor: null,
      userInput: "",
      maxSpanReached: INITIAL_SPAN,
      isPractice: true,
      practiceTotalTrials: 0,
      mainTotalTrials: 0,
      practiceDoneTrials: 0,
      mainDoneTrials: 0,
      lastCorrect: null,
      lastExpected: "",
      lastEntered: "",
      mainConditionLabel: null,
    });
  },
}));
