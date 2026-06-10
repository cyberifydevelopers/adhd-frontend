import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import type { DigitSpanRoundPlanItem } from "@/types/cat";
import { PRACTICE_CONFIG } from "@/config/catConfig";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildDigitSpanCheckpoint } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";
import {
  DIGIT_SPAN_MAX_SEQUENCES,
  DIGIT_SPAN_SPAN_MAX,
  DIGIT_SPAN_SPAN_MIN,
  type DigitSpanBatteryStopReason,
  ageFromIsoDateOfBirth,
  digitSpanOutcomeAfterTwoTrials,
  digitSpanRecallMs,
  startingSpanFromAge,
} from "@/lib/digitSpanSpec";
import { usersMeService } from "@/services/usersMeService";

const DIGITS = "0123456789";
const DEFAULT_MAX_TRIALS = 18;
export const DIGIT_DISPLAY_MS = 1000;
/** @deprecated Use {@link digitSpanRecallMs} per current span. */
export const ROUND_RECALL_MS = digitSpanRecallMs(4);
const PRACTICE_FEEDBACK_MS = 1000;

/** Practice uses fixed short spans until pass criterion — independent of main staircase. */
const PRACTICE_SPAN = 3;

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function randomSequence(len: number, rng?: () => number): string {
  const rand = rng ?? Math.random;
  let s = "";
  for (let i = 0; i < len; i += 1) {
    const prev = i > 0 ? s[i - 1] : null;
    let next = DIGITS[Math.floor(rand() * 10)];
    if (prev !== null && next === prev) {
      const prevIdx = DIGITS.indexOf(prev);
      const offset = 1 + Math.floor(rand() * (DIGITS.length - 1));
      next = DIGITS[(prevIdx + offset) % DIGITS.length];
    }
    s += next;
  }
  return s;
}

export type DigitSpanPhase = "instructions" | "encoding" | "recall" | "extension" | "complete";
export type DigitSpanDirection = "forward" | "backward";

function randomDirection(rng?: () => number): DigitSpanDirection {
  const rand = rng ?? Math.random;
  return rand() < 0.5 ? "forward" : "backward";
}

function randomSpan(rng?: () => number): number {
  const rand = rng ?? Math.random;
  return 4 + Math.floor(rand() * (8 - 4 + 1));
}

function buildRandomRoundPlan(totalRounds: number, rng?: () => number): DigitSpanRoundPlanItem[] {
  const rounds = Math.max(1, totalRounds);
  return Array.from({ length: rounds }, () => ({
    direction: randomDirection(rng),
    span: randomSpan(rng),
  }));
}

export type MainLadderPhase = "forward" | "backward";

type Refs = {
  events: Record<string, unknown>[];
  timerId: ReturnType<typeof setTimeout> | undefined;
  recallTimeoutId: ReturnType<typeof setTimeout> | undefined;
  rng: () => number;
  correctAtSpan: boolean[];
  mainRoundPlan: DigitSpanRoundPlanItem[];
  mainMaxTrials: number;
  isPractice: boolean;
  recallSubmitCommitted: boolean;
  practiceConsecutiveCorrect: number;
  practiceRoundsCompleted: number;
  practiceLowConfidence: boolean;
  practiceBlockStart: number;
  mainAdaptiveHistory: AdaptiveHistory;
  /** Main staircase */
  mainLadderPhase: MainLadderPhase;
  startingSpan: number;
  trialResultsAtSpan: boolean[];
  awaitingConfirmationThirdTrial: boolean;
  sequencesUsedMain: number;
  /** Digit keys during encoding this trial — flag validity only at ≥3 (reduces noise). */
  encodingDigitKeypressCount: number;
  /** True if any trial in the current span reached ≥3 encoding keypresses. */
  encodingEarlyFlagThisSpan: boolean;
  validityRepeatedInvalid: boolean;
  validityFailedStartingSpanForward: boolean;
  invalidInputAttempts: number;
  passedSpanHigherThanStartInForward: boolean;
};

type DigitSpanState = {
  phase: DigitSpanPhase;
  sessionId: string | null;
  span: number;
  trialInSpan: number;
  direction: DigitSpanDirection;
  sequence: string;
  currentDigitIndex: number;
  maxTrials: number;
  events: Record<string, unknown>[];
  roundPlan: DigitSpanRoundPlanItem[];
  currentRoundIndex: number;
  recallTimeRemainingMs: number;
  additionalTrials: number;
  isPractice: boolean;
  practiceFeedback: string | null;
  practiceFeedbackType: "correct" | "incorrect" | null;
  practiceCorrectAnswer: string | null;
  practiceFeedbackKey: number;
  /** Main task only — forward then backward adaptive staircase */
  mainLadderPhase: MainLadderPhase | null;
  startingSpan: number;
  sequencesUsedMain: number;
  /** UI: invalid recall attempts (non-digit spam) */
  registerInvalidDigitAttempt: () => void;
  /** Digit pressed during encoding before recall — validity flag */
  registerEarlyEncodingResponse: () => void;
  _refs: Refs;
  advanceDigit: () => void;
  startDigitTimer: () => void;
  startRecallTimer: () => void;
  tickRecallTimer: () => void;
  submitRecall: (response: string) => void;
  startPractice: () => Promise<void>;
  startExtension: (trialsToAdd: number) => void;
  finishAndSave: () => Promise<void>;
  finishExtension: () => Promise<void>;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

function clampSpan(n: number): number {
  return Math.max(DIGIT_SPAN_SPAN_MIN, Math.min(DIGIT_SPAN_SPAN_MAX, Math.floor(n)));
}

export const digitSpanStore = create<DigitSpanState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  span: PRACTICE_SPAN,
  trialInSpan: 0,
  direction: "forward",
  sequence: "",
  currentDigitIndex: 0,
  maxTrials: DEFAULT_MAX_TRIALS,
  events: [],
  roundPlan: [],
  currentRoundIndex: 0,
  recallTimeRemainingMs: digitSpanRecallMs(PRACTICE_SPAN),
  additionalTrials: 0,
  isPractice: false,
  practiceFeedback: null,
  practiceFeedbackType: null,
  practiceCorrectAnswer: null,
  practiceFeedbackKey: 0,
  mainLadderPhase: null,
  startingSpan: 4,
  sequencesUsedMain: 0,

  registerInvalidDigitAttempt: () => {
    const { _refs } = get();
    _refs.invalidInputAttempts += 1;
    if (_refs.invalidInputAttempts >= 5) {
      _refs.validityRepeatedInvalid = true;
    }
  },

  registerEarlyEncodingResponse: () => {
    const r = get()._refs;
    r.encodingDigitKeypressCount += 1;
    if (r.encodingDigitKeypressCount >= 3) r.encodingEarlyFlagThisSpan = true;
  },

  _refs: {
    events: [],
    timerId: undefined,
    recallTimeoutId: undefined,
    rng: Math.random,
    correctAtSpan: [],
    mainRoundPlan: [],
    mainMaxTrials: DEFAULT_MAX_TRIALS,
    isPractice: false,
    recallSubmitCommitted: false,
    practiceConsecutiveCorrect: 0,
    practiceRoundsCompleted: 0,
    practiceLowConfidence: false,
    practiceBlockStart: performance.now(),
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    mainLadderPhase: "forward",
    startingSpan: 4,
    trialResultsAtSpan: [],
    awaitingConfirmationThirdTrial: false,
    sequencesUsedMain: 0,
    encodingDigitKeypressCount: 0,
    encodingEarlyFlagThisSpan: false,
    validityRepeatedInvalid: false,
    validityFailedStartingSpanForward: false,
    invalidInputAttempts: 0,
    passedSpanHigherThanStartInForward: false,
  },

  advanceDigit: () => {
    const { sequence, currentDigitIndex } = get();
    if (currentDigitIndex >= sequence.length - 1) {
      const { _refs } = get();
      _refs.recallSubmitCommitted = false;
      set({ phase: "recall" });
    } else {
      set({ currentDigitIndex: currentDigitIndex + 1 });
    }
  },

  startDigitTimer: () => {
    if (isTaskPaused()) return;
    const { _refs, phase, sequence, currentDigitIndex, advanceDigit } = get();
    if (phase !== "encoding") return;
    if (currentDigitIndex >= sequence.length) return;
    if (_refs.timerId) clearTimeout(_refs.timerId);
    _refs.timerId = setTimeout(() => {
      advanceDigit();
      _refs.timerId = undefined;
    }, DIGIT_DISPLAY_MS);
  },

  startRecallTimer: () => {
    if (isTaskPaused()) return;
    const { _refs, phase, span, submitRecall } = get();
    if (phase !== "recall") return;
    const recallMs = digitSpanRecallMs(span);
    set({ recallTimeRemainingMs: recallMs });
    get().tickRecallTimer();
    if (_refs.recallTimeoutId) clearTimeout(_refs.recallTimeoutId);
    _refs.recallTimeoutId = setTimeout(() => {
      submitRecall("");
      _refs.recallTimeoutId = undefined;
    }, recallMs);
  },

  tickRecallTimer: () => {
    const { _refs, phase, recallTimeRemainingMs } = get();
    if (phase !== "recall") return;
    const next = Math.max(0, recallTimeRemainingMs - 100);
    set({ recallTimeRemainingMs: next });
    if (next <= 0) return;
    _refs.timerId = setTimeout(() => {
      get().tickRecallTimer();
      _refs.timerId = undefined;
    }, 100);
  },

  submitRecall: (response) => {
    if (isTaskPaused()) return;
    const {
      direction,
      sequence,
      span,
      _refs,
      sessionId,
      phase,
      mainLadderPhase,
    } = get();
    if (phase !== "recall") return;
    if (_refs.recallSubmitCommitted) return;
    _refs.recallSubmitCommitted = true;
    if (_refs.recallTimeoutId) {
      clearTimeout(_refs.recallTimeoutId);
      _refs.recallTimeoutId = undefined;
    }
    const expected = direction === "forward" ? sequence : sequence.split("").reverse().join("");
    const correct = response === expected;
    const inPractice = _refs.isPractice;

    catStore.getState().addTrial({ expected_response: false });

    const trialNum = _refs.events.length + 1;
    const cat = catStore.getState();
    if (sessionId && cat.shouldCheckpoint(trialNum)) {
      cat.requestCheckpoint(sessionId, "digit_span", trialNum, {
        trials_completed: trialNum,
        current_span: span,
        direction,
      });
    }

    _refs.events.push({
      task_name: "digit_span",
      trial_index: _refs.events.length,
      stimulus_onset_ms: 0,
      keypress_ms: null,
      reaction_time_ms: null,
      response_key: response,
      correct_key: expected,
      is_correct: correct,
      event_type: direction,
      isi_ms: span,
      extra_data: {
        ladder_phase: inPractice ? "practice" : mainLadderPhase ?? undefined,
        span_length: span,
        trial_within_span: _refs.trialResultsAtSpan.length + 1,
        confirmation_trial: _refs.awaitingConfirmationThirdTrial,
      },
    });
    set({ events: [..._refs.events] });

    const pushSpanAdaptiveCheckpoint = (
      batteryComplete: boolean,
      stopReason?: DigitSpanBatteryStopReason,
    ) => {
      const seqDone = _refs.events.length;
      const snap = get();
      const correctMain = _refs.events.filter((e) => e.is_correct === true).length;
      _refs.mainAdaptiveHistory = tryMainAdaptiveStop(
        "digit_span",
        buildDigitSpanCheckpoint({
          sequencesCompleted: seqDone,
          spanBatteryComplete: batteryComplete,
          digitSpanBatteryStopReason: batteryComplete ? stopReason : undefined,
          ladderPhase: snap.mainLadderPhase ?? "forward",
          currentSpan: snap.span,
          startingSpan: snap.startingSpan,
          sequencesBudgetUsed: _refs.sequencesUsedMain,
          maxSequences: DIGIT_SPAN_MAX_SEQUENCES,
          digitSpanEarlyResponseFlag: _refs.encodingEarlyFlagThisSpan,
          digitSpanRepeatedInvalidInput: _refs.validityRepeatedInvalid,
          digitSpanFloorAfterPractice: _refs.practiceLowConfidence,
          digitSpanFailedStartingSpan: _refs.validityFailedStartingSpanForward,
          correctTrials: correctMain,
          responseTrials: seqDone,
        }),
        _refs.mainAdaptiveHistory,
        DIGIT_SPAN_MAX_SEQUENCES,
      ).history;
    };

    if (!inPractice) {
      _refs.sequencesUsedMain += 1;
      set({ sequencesUsedMain: _refs.sequencesUsedMain });
    }

    if (inPractice) {
      _refs.practiceRoundsCompleted += 1;
      _refs.practiceConsecutiveCorrect = correct ? _refs.practiceConsecutiveCorrect + 1 : 0;
      set({
        practiceFeedback: correct
          ? "Correct."
          : `Not quite. The correct answer was ${expected}.`,
        practiceFeedbackType: correct ? "correct" : "incorrect",
        practiceCorrectAnswer: expected,
        practiceFeedbackKey: get().practiceFeedbackKey + 1,
      });
    }

    const beginEncodingRound = (
      nextSpan: number,
      nextDir: DigitSpanDirection,
      seq: string,
      roundIdx: number,
      trialInSpanDisplay: number,
    ) => {
      if (!inPractice && _refs.sequencesUsedMain >= DIGIT_SPAN_MAX_SEQUENCES) {
        finishMainTask("sequence_budget");
        return;
      }
      _refs.encodingDigitKeypressCount = 0;
      set({
        span: nextSpan,
        direction: nextDir,
        sequence: seq,
        currentDigitIndex: 0,
        phase: "encoding",
        currentRoundIndex: roundIdx,
        trialInSpan: trialInSpanDisplay,
        recallTimeRemainingMs: digitSpanRecallMs(nextSpan),
        practiceFeedback: null,
        practiceFeedbackType: null,
        practiceCorrectAnswer: null,
      });
    };

    const finishMainTask = (stopReason: DigitSpanBatteryStopReason) => {
      pushSpanAdaptiveCheckpoint(true, stopReason);
      catStore.getState().setBlockEndTrigger("main_adaptive_stop");
      set({ phase: "complete" });
    };

    const resolveMainStaircase = () => {
      _refs.trialResultsAtSpan.push(correct);
      const results = _refs.trialResultsAtSpan;
      const ladder = _refs.mainLadderPhase;
      const curSpan = get().span;

      const scheduleNextAtSameSpan = () => {
        const dir: DigitSpanDirection = ladder === "backward" ? "backward" : "forward";
        const seq = randomSequence(curSpan, _refs.rng);
        beginEncodingRound(curSpan, dir, seq, get().currentRoundIndex + 1, results.length);
      };

      const advanceSpanOrPhase = () => {
        const nextSpan = curSpan + 1;
        if (ladder === "backward" && nextSpan > DIGIT_SPAN_SPAN_MAX) {
          finishMainTask("backward_span_ceiling");
          return;
        }
        pushSpanAdaptiveCheckpoint(false);

        _refs.trialResultsAtSpan = [];
        _refs.awaitingConfirmationThirdTrial = false;
        _refs.encodingEarlyFlagThisSpan = false;

        if (ladder === "forward") {
          if (nextSpan > DIGIT_SPAN_SPAN_MAX) {
            _refs.mainLadderPhase = "backward";
            _refs.trialResultsAtSpan = [];
            set({
              mainLadderPhase: "backward",
              span: _refs.startingSpan,
              direction: "backward",
            });
            const seq = randomSequence(_refs.startingSpan, _refs.rng);
            beginEncodingRound(_refs.startingSpan, "backward", seq, get().currentRoundIndex + 1, 0);
            return;
          }
          if (nextSpan > _refs.startingSpan) {
            _refs.passedSpanHigherThanStartInForward = true;
          }
          const seq = randomSequence(nextSpan, _refs.rng);
          set({ span: nextSpan });
          beginEncodingRound(nextSpan, "forward", seq, get().currentRoundIndex + 1, 0);
          return;
        }
        const seq = randomSequence(nextSpan, _refs.rng);
        set({ span: nextSpan });
        beginEncodingRound(nextSpan, "backward", seq, get().currentRoundIndex + 1, 0);
      };

      const failCurrentLadder = () => {
        if (ladder === "forward") {
          pushSpanAdaptiveCheckpoint(false);
          _refs.trialResultsAtSpan = [];
          _refs.awaitingConfirmationThirdTrial = false;
          _refs.encodingEarlyFlagThisSpan = false;
          if (curSpan === _refs.startingSpan && !_refs.passedSpanHigherThanStartInForward) {
            _refs.validityFailedStartingSpanForward = true;
          }
          _refs.mainLadderPhase = "backward";
          set({
            mainLadderPhase: "backward",
            span: _refs.startingSpan,
            direction: "backward",
          });
          const seq = randomSequence(_refs.startingSpan, _refs.rng);
          beginEncodingRound(_refs.startingSpan, "backward", seq, get().currentRoundIndex + 1, 0);
          return;
        }
        _refs.trialResultsAtSpan = [];
        _refs.awaitingConfirmationThirdTrial = false;
        finishMainTask("backward_discontinue");
      };

      if (results.length === 1) {
        scheduleNextAtSameSpan();
        return;
      }

      if (results.length === 2) {
        const wins = results.filter(Boolean).length;
        if (digitSpanOutcomeAfterTwoTrials(wins) === "fail") {
          failCurrentLadder();
          return;
        }
        advanceSpanOrPhase();
      }
    };

    const advanceToNext = () => {
      if (_refs.isPractice) {
        const practiceMinRounds = 2;
        const practiceMaxRounds = Math.max(
          practiceMinRounds,
          Number(PRACTICE_CONFIG.maxTrials) || 20,
        );
        const metConsecutive = _refs.practiceConsecutiveCorrect >= 2;
        const hitMax = _refs.practiceRoundsCompleted >= practiceMaxRounds;
        const passed = metConsecutive;

        if (passed || hitMax) {
          _refs.practiceLowConfidence = !passed;

          const practiceEvents = [..._refs.events];
          const practiceCorrect = practiceEvents.filter((e) => e.is_correct === true).length;
          const practiceAccuracy = practiceEvents.length > 0 ? practiceCorrect / practiceEvents.length : 0;
          const sid = get().sessionId;
          const configuredMainMaxTrials = Math.max(1, _refs.mainMaxTrials);

          void (async () => {
            try {
              if (sid && practiceEvents.length > 0) {
                const flagged = practiceEvents.map((ev) => ({
                  ...ev,
                  extra_data: { ...(ev.extra_data as Record<string, unknown> || {}), is_practice: true },
                }));
                await sessionsService.postEvents(sid, flagged);
                await sessionsService.postBlocks(sid, {
                  task_name: "digit_span",
                  block_index: -1,
                  practice_pass: passed,
                  practice_accuracy: practiceAccuracy,
                  practice_trial_count: practiceEvents.length,
                  low_confidence_flag: get()._refs.practiceLowConfidence,
                  practice_blocks_completed: Math.ceil(practiceEvents.length / practiceMinRounds),
                  practice_error_pattern: (!passed || get()._refs.practiceLowConfidence) ? "span_failure" : undefined,
                  block_start_ts: get()._refs.practiceBlockStart,
                  block_end_ts: performance.now(),
                });
              }
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to save practice");
            }

            let dobAge: number | null = null;
            try {
              const intake = await usersMeService.getIntake();
              const dob =
                (intake.intake_data?.date_of_birth as string | undefined) ??
                (intake as { date_of_birth?: string }).date_of_birth;
              dobAge = ageFromIsoDateOfBirth(dob);
            } catch {
              /* ignore */
            }
            const nextSpan = clampSpan(startingSpanFromAge(dobAge));

            const r = get()._refs;
            r.events = [];
            r.isPractice = false;
            r.trialResultsAtSpan = [];
            r.awaitingConfirmationThirdTrial = false;
            r.sequencesUsedMain = 0;
            r.encodingDigitKeypressCount = 0;
            r.encodingEarlyFlagThisSpan = false;
            r.passedSpanHigherThanStartInForward = false;
            r.validityFailedStartingSpanForward = false;
            r.mainAdaptiveHistory = resetMainAdaptiveHistory();
            r.startingSpan = nextSpan;
            r.mainLadderPhase = "forward";
            const seq = randomSequence(nextSpan, r.rng);

            catStore.getState().resetForNewTask();

            set({
              isPractice: false,
              practiceFeedback: null,
              practiceFeedbackType: null,
              practiceCorrectAnswer: null,
              phase: "encoding",
              span: nextSpan,
              trialInSpan: 0,
              direction: "forward",
              sequence: seq,
              currentDigitIndex: 0,
              currentRoundIndex: 0,
              maxTrials: configuredMainMaxTrials,
              events: [],
              roundPlan: [],
              recallTimeRemainingMs: digitSpanRecallMs(PRACTICE_SPAN),
              mainLadderPhase: "forward",
              startingSpan: nextSpan,
              sequencesUsedMain: 0,
            });
            toast.success("Practice complete. Starting main task.");
          })();

          return;
        }
      }

      if (!_refs.isPractice) {
        resolveMainStaircase();
        return;
      }

      const seq = randomSequence(PRACTICE_SPAN, _refs.rng);
      beginEncodingRound(PRACTICE_SPAN, "forward", seq, get().currentRoundIndex + 1, get().trialInSpan + 1);
    };

    if (inPractice) {
      if (_refs.timerId) clearTimeout(_refs.timerId);
      _refs.timerId = setTimeout(() => {
        advanceToNext();
        _refs.timerId = undefined;
      }, PRACTICE_FEEDBACK_MS);
      return;
    }

    advanceToNext();
  },

  startPractice: async () => {
    try {
      const res = await sessionsService.create("digit_span");
      const seed = res.session_id.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
      const { _refs } = get();
      _refs.rng = seededRandom(Math.abs(seed));
      _refs.events = [];
      _refs.correctAtSpan = [];
      _refs.isPractice = true;
      _refs.practiceConsecutiveCorrect = 0;
      _refs.practiceRoundsCompleted = 0;
      _refs.practiceLowConfidence = false;
      _refs.practiceBlockStart = performance.now();
      _refs.encodingDigitKeypressCount = 0;
      _refs.encodingEarlyFlagThisSpan = false;
      _refs.validityRepeatedInvalid = false;
      _refs.validityFailedStartingSpanForward = false;
      _refs.invalidInputAttempts = 0;
      catStore.getState().resetForNewTask();
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();

      const config = await catStore.getState().loadTaskConfig(res.session_id, "digit_span");
      const configuredMainMaxTrials = Math.max(1, Number(config?.max_trials ?? DEFAULT_MAX_TRIALS));
      const practiceCfg = (config?.practice_config as Record<string, unknown> | undefined) ?? {};
      const configuredPracticeMin = Math.floor(Number(practiceCfg.min_trials));
      const configuredPracticeMax = Math.floor(Number(practiceCfg.max_trials));
      const practiceMinRounds = Number.isFinite(configuredPracticeMin)
        ? configuredPracticeMin
        : Math.max(1, Number(PRACTICE_CONFIG.minTrials) || 5);
      const practiceMaxRounds = Number.isFinite(configuredPracticeMax)
        ? configuredPracticeMax
        : Math.max(practiceMinRounds, Number(PRACTICE_CONFIG.maxTrials) || 20);
      const configuredPracticeMaxTrials = Math.max(practiceMinRounds, practiceMaxRounds);

      _refs.mainRoundPlan = [];
      _refs.mainMaxTrials = Math.min(configuredMainMaxTrials, DIGIT_SPAN_MAX_SEQUENCES);

      const seq = randomSequence(PRACTICE_SPAN, _refs.rng);
      set({
        sessionId: res.session_id,
        isPractice: true,
        practiceFeedback: null,
        practiceFeedbackType: null,
        practiceCorrectAnswer: null,
        phase: "encoding",
        span: PRACTICE_SPAN,
        trialInSpan: 0,
        direction: "forward",
        sequence: seq,
        currentDigitIndex: 0,
        maxTrials: configuredPracticeMaxTrials,
        events: [],
        roundPlan: [],
        currentRoundIndex: 0,
        recallTimeRemainingMs: digitSpanRecallMs(PRACTICE_SPAN),
        mainLadderPhase: null,
      });
      toast.success("Practice started.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    _refs.events = [];
    _refs.isPractice = false;
    catStore.getState().resetForNewTask();
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    const extensionRounds = Math.max(1, Math.min(trialsToAdd, DIGIT_SPAN_MAX_SEQUENCES));
    const roundPlan = buildRandomRoundPlan(extensionRounds, _refs.rng);
    const firstRound = roundPlan[0] ?? { direction: "forward" as const, span: 4 };
    const firstSpan = clampSpan(Number(firstRound.span) || 4);
    const firstDirection = firstRound.direction === "backward" ? "backward" : "forward";
    const seq = randomSequence(firstSpan, _refs.rng);
    set({
      events: [],
      span: firstSpan,
      trialInSpan: 0,
      direction: firstDirection,
      sequence: seq,
      currentDigitIndex: 0,
      maxTrials: extensionRounds,
      additionalTrials: extensionRounds,
      isPractice: false,
      practiceFeedback: null,
      practiceFeedbackType: null,
      practiceCorrectAnswer: null,
      roundPlan,
      currentRoundIndex: 0,
      recallTimeRemainingMs: digitSpanRecallMs(PRACTICE_SPAN),
      phase: "encoding",
      mainLadderPhase: "forward",
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
        task_name: "digit_span",
        block_index: 0,
        block_start_ts: 0,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreDigitSpan(sessionId);
      toast.success("Results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
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
          task_name: "digit_span",
          block_index: 1,
          block_start_ts: 0,
          block_end_ts: performance.now(),
        });
        await sessionsService.scoreDigitSpan(sessionId);
        toast.success("Extension block complete. Results saved.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.timerId) {
      clearTimeout(_refs.timerId);
      _refs.timerId = undefined;
    }
    if (_refs.recallTimeoutId) {
      clearTimeout(_refs.recallTimeoutId);
      _refs.recallTimeoutId = undefined;
    }
  },

  resumeAfterPause: () => {
    const { phase, sequence, currentDigitIndex } = get();
    if (phase === "encoding" && currentDigitIndex < sequence.length) {
      get().startDigitTimer();
    } else if (phase === "recall") {
      get().startRecallTimer();
    } else if (phase === "extension" && currentDigitIndex < sequence.length) {
      get().startDigitTimer();
    }
  },

  prepareForFreshRun: () => {
    if (get().phase !== "complete") return;
    get().cleanup();
    const { _refs } = get();
    _refs.events = [];
    _refs.timerId = undefined;
    _refs.recallTimeoutId = undefined;
    _refs.rng = Math.random;
    _refs.correctAtSpan = [];
    _refs.mainRoundPlan = [];
    _refs.mainMaxTrials = DEFAULT_MAX_TRIALS;
    _refs.isPractice = false;
    _refs.recallSubmitCommitted = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.trialResultsAtSpan = [];
    _refs.awaitingConfirmationThirdTrial = false;
    _refs.sequencesUsedMain = 0;
    _refs.encodingDigitKeypressCount = 0;
    _refs.encodingEarlyFlagThisSpan = false;
    _refs.validityRepeatedInvalid = false;
    _refs.validityFailedStartingSpanForward = false;
    _refs.invalidInputAttempts = 0;
    _refs.passedSpanHigherThanStartInForward = false;

    catStore.getState().resetForNewTask();

    set({
      phase: "instructions",
      sessionId: null,
      span: PRACTICE_SPAN,
      trialInSpan: 0,
      direction: "forward",
      sequence: "",
      currentDigitIndex: 0,
      maxTrials: DEFAULT_MAX_TRIALS,
      events: [],
      roundPlan: [],
      currentRoundIndex: 0,
      recallTimeRemainingMs: digitSpanRecallMs(PRACTICE_SPAN),
      additionalTrials: 0,
      isPractice: false,
      practiceFeedback: null,
      practiceFeedbackType: null,
      practiceCorrectAnswer: null,
      practiceFeedbackKey: 0,
      mainLadderPhase: null,
      startingSpan: 4,
      sequencesUsedMain: 0,
    });
  },
}));
