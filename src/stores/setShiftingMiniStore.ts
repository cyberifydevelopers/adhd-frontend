import { create } from "zustand";
import { sessionsService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS, PRACTICE_CONFIG } from "@/config/catConfig";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { isTaskPaused } from "@/lib/taskPauseGuard";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildSetShiftingCheckpoint } from "@/lib/mainAdaptiveBridge";

const TASK_NAME = "set_shifting_mini";
const RESPONSE_TIMEOUT_MS = 3000;
const FEEDBACK_MS = 700;
/** Longer pause on final practice trial so correctness is visible before main. */
const FEEDBACK_MS_LAST_PRACTICE = 2200;
/**
 * After last-practice feedback, keep recap (`main_countdown_pending`) visible this long before 3-2-1.
 * Store moves to `main_countdown_go` after this delay; UI starts the main countdown only then.
 */
const POST_PRACTICE_RECAP_HOLD_MS = 1600;

/** Consecutive correct responses required before the sorting rule advances. */
const CRITERION_STREAK = 5;
/** If the first rule is learned in this many trials or fewer, add a third distinct rule for the final phase. */
const FAST_FIRST_RULE_MAX_TRIALS = 10;

const MAIN_MIN = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.set_shifting_mini.minTrials;
const MAIN_MAX = MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.set_shifting_mini.maxTrials;
const MAIN_CHECKPOINT_EVERY = 10;

type Rule = "click_red" | "click_blue" | "click_circle" | "click_square";
type Color = "red" | "blue" | "green";
type Shape = "circle" | "square" | "triangle";
type Item = { id: string; color: Color; shape: Shape };

export type SetShiftTrial = {
  rule: Rule;
  previousRule: Rule | null;
  isSwitch: boolean;
  items: Item[];
  correctItemId: string;
};

export type SetShiftPhase =
  | "instructions"
  | "practice"
  | "running"
  | "feedback"
  | "complete"
  /** Practice finished & last-trial feedback elapsed; recap UI before main. */
  | "main_countdown_pending"
  /** Recap visible long enough — UI may arm 3-2-1 for main trials (store-gated transition). */
  | "main_countdown_go";

type Refs = {
  stimulusOnset: number;
  blockStart: number;
  events: Record<string, unknown>[];
  timeoutId: ReturnType<typeof setTimeout> | null;
  practiceTrialsTarget: number;
  mainTrialsTarget: number;
  /** Guards double scoring on the same trial (double click / key repeat). */
  responseRecordedForTrialIndex: number;
  practiceSaved: boolean;
  mainAdaptiveHistory: AdaptiveHistory;
  /** Main: [r1, r2] then third rule appended after first criterion is met. */
  mainRuleSequence: Rule[];
  mainPhaseIndex: number;
  mainStreak: number;
  mainTrialsInCurrentPhase: number;
  /** Post-switch learning blocks completed (each = 5-in-a-row after a rule change). */
  mainPostSwitchCriterionCount: number;
  mainTrialsToLearnByPhase: number[];
  mainPendingPhaseAdvance: boolean;
  mainInitialCriterionReached: boolean;
  mainThirdRuleLocked: boolean;
  mainLearningComplete: boolean;
};

type SetShiftingMiniState = {
  phase: SetShiftPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: SetShiftTrial[];
  status: "stimulus" | "feedback";
  events: Record<string, unknown>[];
  isPractice: boolean;
  practiceDoneTrials: number;
  practiceTotalTrials: number;
  mainDoneTrials: number;
  mainTotalTrials: number;
  activeRule: Rule | null;
  lastWasCorrect: boolean | null;
  lastTimedOut: boolean;
  lastCorrectLabel: string;
  _refs: Refs;
  startSession: () => Promise<void>;
  recordSelection: (itemId: string | null) => void;
  finishAndSave: () => Promise<void>;
  startMainPhase: () => void;
  cleanup: () => void;
  resumeAfterPause: () => void;
  prepareForFreshRun: () => void;
};

const RULE_TEXT: Record<Rule, string> = {
  click_red: "Click RED items",
  click_blue: "Click BLUE items",
  click_circle: "Click CIRCLE items",
  click_square: "Click SQUARE items",
};

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickTwoRules(): [Rule, Rule] {
  const pool: Rule[] = ["click_red", "click_blue", "click_circle", "click_square"];
  const r1 = randomPick(pool);
  const r2 = randomPick(pool.filter((r) => r !== r1));
  return [r1, r2];
}

function pickThird(r1: Rule, r2: Rule): Rule {
  const pool: Rule[] = ["click_red", "click_blue", "click_circle", "click_square"];
  return randomPick(pool.filter((r) => r !== r1 && r !== r2));
}

function matchesRule(item: Item, rule: Rule): boolean {
  if (rule === "click_red") return item.color === "red";
  if (rule === "click_blue") return item.color === "blue";
  if (rule === "click_circle") return item.shape === "circle";
  return item.shape === "square";
}

/** Force `item` to violate `rule` (used when trimming duplicate matches). */
function demoteFromRule(item: Item, rule: Rule): Item {
  switch (rule) {
    case "click_red":
      return { ...item, color: "blue" };
    case "click_blue":
      return { ...item, color: "red" };
    case "click_circle":
      return { ...item, shape: "square" };
    case "click_square":
      return { ...item, shape: "triangle" };
    default:
      return item;
  }
}

function buildItemsForRule(rule: Rule): { items: Item[]; correctItemId: string } {
  const colors: Color[] = ["red", "blue", "green"];
  const shapes: Shape[] = ["circle", "square", "triangle"];
  const items: Item[] = [];

  while (items.length < 4) {
    const item: Item = {
      id: `item_${items.length}_${Math.random().toString(36).slice(2, 6)}`,
      color: randomPick(colors),
      shape: randomPick(shapes),
    };
    items.push(item);
  }

  for (let iter = 0; iter < 16; iter += 1) {
    const matchingIdx = items
      .map((it, idx) => (matchesRule(it, rule) ? idx : -1))
      .filter((idx): idx is number => idx >= 0);
    if (matchingIdx.length === 0) {
      items[0] = {
        ...items[0],
        color: rule === "click_red" ? "red" : rule === "click_blue" ? "blue" : items[0].color,
        shape:
          rule === "click_circle"
            ? "circle"
            : rule === "click_square"
              ? "square"
              : items[0].shape,
      };
      continue;
    }
    if (matchingIdx.length === 1) {
      return { items, correctItemId: items[matchingIdx[0]].id };
    }
    for (let k = 1; k < matchingIdx.length; k += 1) {
      const i = matchingIdx[k];
      items[i] = demoteFromRule(items[i], rule);
    }
  }

  const fallback = items.find((i) => matchesRule(i, rule)) ?? items[0];
  return { items, correctItemId: fallback.id };
}

function buildShiftTrial(rule: Rule, previousRule: Rule | null): SetShiftTrial {
  const isSwitch = previousRule !== null && previousRule !== rule;
  const { items, correctItemId } = buildItemsForRule(rule);
  return { rule, previousRule, isSwitch, items, correctItemId };
}

/** Practice: pseudo-random rule sequence (not criterion-gated). */
function buildPracticeRulePlan(totalTrials: number): Rule[] {
  const rulePool: Rule[] = ["click_red", "click_blue", "click_circle", "click_square"];
  const plan: Rule[] = [];
  const phase1Rule = randomPick(rulePool);
  for (let i = 0; i < Math.min(5, totalTrials); i += 1) plan.push(phase1Rule);
  if (plan.length < totalTrials) {
    const phase2Rule = randomPick(rulePool.filter((r) => r !== phase1Rule));
    for (let i = 0; i < Math.min(3, totalTrials - plan.length); i += 1) plan.push(phase2Rule);
  }
  while (plan.length < totalTrials) {
    const previous = plan[plan.length - 1];
    const shouldSwitch = Math.random() < 0.8;
    const next = shouldSwitch ? randomPick(rulePool.filter((r) => r !== previous)) : previous;
    plan.push(next);
  }
  return plan;
}

function buildPracticeTrials(totalTrials: number): SetShiftTrial[] {
  const rules = buildPracticeRulePlan(totalTrials);
  return rules.map((rule, idx) => {
    const previousRule = idx > 0 ? rules[idx - 1] : null;
    const isSwitch = previousRule !== null && previousRule !== rule;
    const { items, correctItemId } = buildItemsForRule(rule);
    return { rule, previousRule, isSwitch, items, correctItemId };
  });
}

function resetMainAdaptiveRefs(refs: Refs): void {
  const [r1, r2] = pickTwoRules();
  refs.mainRuleSequence = [r1, r2];
  refs.mainPhaseIndex = 0;
  refs.mainStreak = 0;
  refs.mainTrialsInCurrentPhase = 0;
  refs.mainPostSwitchCriterionCount = 0;
  refs.mainTrialsToLearnByPhase = [];
  refs.mainPendingPhaseAdvance = false;
  refs.mainInitialCriterionReached = false;
  refs.mainThirdRuleLocked = false;
  refs.mainLearningComplete = false;
}

function isSetShiftingPeriodicCheckpoint(mainCompleted: number): boolean {
  if (mainCompleted < MAIN_MIN) return false;
  if (mainCompleted === MAIN_MIN) return true;
  const past = mainCompleted - MAIN_MIN;
  return past >= MAIN_CHECKPOINT_EVERY && past % MAIN_CHECKPOINT_EVERY === 0;
}

function computeMainAdaptiveMetrics(mainEvents: Record<string, unknown>[]) {
  const responded = mainEvents.filter((e) => e.is_correct != null);
  const responseTrials = responded.length;
  const correctTrials = responded.filter((e) => e.is_correct === true).length;
  const switchTrials = mainEvents.filter((e) => e.event_type === "switch");
  const switchCorrect = switchTrials.filter((e) => e.is_correct === true).length;
  const switchAccuracy = switchTrials.length > 0 ? switchCorrect / switchTrials.length : null;
  let perseverationAfterSwitch = 0;
  for (const e of mainEvents) {
    if (e.event_type !== "switch") continue;
    const ex = e.extra_data as Record<string, unknown> | undefined;
    if (ex?.perseveration_error === true) perseverationAfterSwitch += 1;
  }
  const perseverationEstablished = perseverationAfterSwitch >= 3;
  const acc = responseTrials > 0 ? correctTrials / responseTrials : 1;
  const rts = mainEvents
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((x): x is number => typeof x === "number" && x > 0);
  const recentRt = rts.slice(-24);
  const fastAnticipatory =
    recentRt.length >= 10 &&
    recentRt.filter((rt) => rt < 220).length / recentRt.length >= 0.45;
  const randomResponding =
    (responseTrials >= 15 && responseTrials > 0 && acc < 0.35) || fastAnticipatory;
  return {
    correctTrials,
    responseTrials,
    switchAccuracy,
    perseverationEstablished,
    perseverationSwitchErrors: perseverationAfterSwitch,
    randomResponding,
  };
}

type SetShiftingStoreGet = () => SetShiftingMiniState;
type SetShiftingStoreSet = (
  partial:
    | Partial<SetShiftingMiniState>
    | ((state: SetShiftingMiniState) => Partial<SetShiftingMiniState>),
) => void;

/** Continue after per-trial feedback (practice advance, main advance, or task complete). */
function advanceFromSetShiftingFeedback(get: SetShiftingStoreGet, set: SetShiftingStoreSet) {
  if (isTaskPaused()) return;
  const state = get();
  if (state.phase !== "feedback") return;

  const nextIndex = state.trialIndex + 1;

  if (state.isPractice) {
    const answeredPracticeIndex = state.trialIndex;
    const practiceLen = state.trials.length;
    const finishingPractice = practiceLen > 0 && answeredPracticeIndex === practiceLen - 1;
    const practiceCompletedCount = answeredPracticeIndex + 1;
    const atCheckpoint = practiceCompletedCount % 5 === 0;

    if (atCheckpoint || finishingPractice) {
      const practiceEvents = state._refs.events.filter(
        (e) => (e.extra_data as Record<string, unknown> | undefined)?.trial != null,
      );
      const lastFive = practiceEvents.slice(-5);
      const lastFiveAcc =
        lastFive.length > 0
          ? lastFive.filter((e) => e.is_correct === true).length / lastFive.length
          : 0;
      const minPracticeTrials = Math.max(5, Number(PRACTICE_CONFIG.minTrials) || 5);
      const passThreshold = Number(PRACTICE_CONFIG.passThreshold ?? 0.8);
      const continueThreshold = Number(PRACTICE_CONFIG.continueThreshold ?? 0.5);
      const maxPractice = Math.max(1, Number(PRACTICE_CONFIG.maxTrials) || 20);
      const reachedMax = practiceEvents.length >= maxPractice;
      const passed =
        practiceEvents.length >= minPracticeTrials &&
        lastFive.length >= 5 &&
        lastFiveAcc >= passThreshold;
      if (!passed && !reachedMax) {
        const nextTrial = state.trials[nextIndex];
        set({
          phase: "practice",
          status: "stimulus",
          trialIndex: nextIndex,
          practiceDoneTrials: practiceCompletedCount,
          activeRule: nextTrial?.rule ?? null,
        });
        state._refs.stimulusOnset = performance.now();
        state._refs.timeoutId = setTimeout(() => get().recordSelection(null), RESPONSE_TIMEOUT_MS);
        toast.info(
          lastFiveAcc >= continueThreshold
            ? "Additional tip: follow the current rule on each trial."
            : "Simplified tip: look at the rule first, then select only matching item.",
        );
        return;
      }

      if (state.sessionId && !state._refs.practiceSaved) {
        state._refs.practiceSaved = true;
        void sessionsService
          .postBlocks(state.sessionId, {
            task_name: TASK_NAME,
            block_index: -1,
            practice_pass: passed,
            practice_accuracy: lastFiveAcc,
            practice_trial_count: practiceEvents.length,
            low_confidence_flag: !passed,
            practice_blocks_completed: Math.ceil(practiceEvents.length / 5),
            practice_error_pattern: passed ? undefined : "accuracy_low",
            block_start_ts: state._refs.blockStart,
            block_end_ts: performance.now(),
          })
          .catch(() => {
            state._refs.practiceSaved = false;
          });
      }

      resetMainAdaptiveRefs(state._refs);
      state._refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      const [r1] = state._refs.mainRuleSequence;
      const firstMain = buildShiftTrial(r1, null);
      set({
        phase: "main_countdown_pending",
        status: "stimulus",
        isPractice: false,
        trials: [firstMain],
        trialIndex: 0,
        practiceDoneTrials: practiceCompletedCount,
        activeRule: firstMain.rule,
      });
      state._refs.timeoutId = setTimeout(() => {
        const s = get();
        if (s.phase !== "main_countdown_pending") return;
        set({ phase: "main_countdown_go" });
      }, POST_PRACTICE_RECAP_HOLD_MS);
      return;
    }
    const nextTrial = state.trials[nextIndex];
    state._refs.stimulusOnset = performance.now();
    state._refs.timeoutId = setTimeout(() => get().recordSelection(null), RESPONSE_TIMEOUT_MS);
    set({
      phase: "practice",
      status: "stimulus",
      trialIndex: nextIndex,
      practiceDoneTrials: practiceCompletedCount,
      activeRule: nextTrial?.rule ?? null,
      lastWasCorrect: null,
      lastTimedOut: false,
      lastCorrectLabel: "",
    });
    return;
  }

  const rel = state._refs;
  const answeredMainIndex = state.trialIndex;
  const mainCompletedCount = answeredMainIndex + 1;
  const mainEvents = rel.events.filter(
    (e) => (e.extra_data as Record<string, unknown> | undefined)?.is_practice !== true,
  );
  const lastMainEvent = mainEvents[mainEvents.length - 1];
  const lastRt =
    typeof lastMainEvent?.reaction_time_ms === "number" ? lastMainEvent.reaction_time_ms : null;

  catStore.getState().addTrial({
    reaction_time_ms: lastRt,
    expected_response: true,
  });

  let criterionPhaseJustEnded = false;
  if (rel.mainPendingPhaseAdvance) {
    rel.mainPendingPhaseAdvance = false;
    criterionPhaseJustEnded = true;
    rel.mainTrialsToLearnByPhase.push(rel.mainTrialsInCurrentPhase);
    rel.mainTrialsInCurrentPhase = 0;
    rel.mainStreak = 0;

    if (rel.mainPhaseIndex === 0) {
      rel.mainInitialCriterionReached = true;
      if (!rel.mainThirdRuleLocked) {
        rel.mainThirdRuleLocked = true;
        const trialsPhase0 = rel.mainTrialsToLearnByPhase[rel.mainTrialsToLearnByPhase.length - 1] ?? 0;
        const third =
          trialsPhase0 <= FAST_FIRST_RULE_MAX_TRIALS
            ? pickThird(rel.mainRuleSequence[0], rel.mainRuleSequence[1])
            : rel.mainRuleSequence[0];
        rel.mainRuleSequence.push(third);
      }
    } else {
      rel.mainPostSwitchCriterionCount += 1;
    }

    rel.mainPhaseIndex += 1;
    if (rel.mainPhaseIndex >= rel.mainRuleSequence.length) {
      rel.mainLearningComplete = true;
    }
  }

  const periodicBoundary = isSetShiftingPeriodicCheckpoint(mainCompletedCount);
  const ruleBlockEnded = criterionPhaseJustEnded || periodicBoundary;

  const m = computeMainAdaptiveMetrics(mainEvents);
  const maxNoCriterion =
    mainCompletedCount >= state.mainTotalTrials &&
    rel.mainPostSwitchCriterionCount < 2 &&
    !m.perseverationEstablished;

  rel.mainAdaptiveHistory = tryMainAdaptiveStop(
    "set_shifting_mini",
    buildSetShiftingCheckpoint({
      mainTrialsDone: mainCompletedCount,
      ruleShiftsWithCriterion: rel.mainPostSwitchCriterionCount,
      perseverationEstablished: m.perseverationEstablished,
      ruleBlockEnded,
      switchAccuracy: m.switchAccuracy,
      trialsToCriterionByPhase: [...rel.mainTrialsToLearnByPhase],
      firstCriterionCompleted: rel.mainInitialCriterionReached,
      randomRespondingFlag: m.randomResponding,
      maxTrialsWithoutCriterion: maxNoCriterion,
      perseverationSwitchErrors: m.perseverationSwitchErrors,
      correctTrials: m.correctTrials,
      responseTrials: m.responseTrials,
    }),
    rel.mainAdaptiveHistory,
    state.mainTotalTrials,
  ).history;

  if (catStore.getState().shouldTriggerBlockEnd) {
    rel.timeoutId = null;
    set({ phase: "complete", mainDoneTrials: mainCompletedCount });
    return;
  }

  if (rel.mainLearningComplete) {
    rel.timeoutId = null;
    set({ phase: "complete", mainDoneTrials: mainCompletedCount });
    return;
  }

  const hitSessionCap = mainCompletedCount >= state.mainTotalTrials;
  if (hitSessionCap) {
    rel.timeoutId = null;
    set({ phase: "complete", mainDoneTrials: mainCompletedCount });
    return;
  }

  const doneMain = mainCompletedCount;
  const currentRule = rel.mainRuleSequence[rel.mainPhaseIndex] ?? rel.mainRuleSequence[0];
  const prevRuleForNext = state.trials[answeredMainIndex]?.rule ?? null;
  const nextTrial = buildShiftTrial(currentRule, prevRuleForNext);
  const updatedTrials = [...state.trials, nextTrial];

  rel.stimulusOnset = performance.now();
  rel.timeoutId = setTimeout(() => get().recordSelection(null), RESPONSE_TIMEOUT_MS);
  set({
    phase: "running",
    status: "stimulus",
    trialIndex: nextIndex,
    trials: updatedTrials,
    mainDoneTrials: doneMain,
    activeRule: nextTrial.rule,
    lastWasCorrect: null,
    lastTimedOut: false,
    lastCorrectLabel: "",
  });
}

function scheduleSetShiftingFeedbackAdvance(
  get: SetShiftingStoreGet,
  set: SetShiftingStoreSet,
  delayMs: number,
) {
  const state = get();
  if (state._refs.timeoutId) {
    clearTimeout(state._refs.timeoutId);
    state._refs.timeoutId = null;
  }
  state._refs.timeoutId = setTimeout(() => {
    get()._refs.timeoutId = null;
    advanceFromSetShiftingFeedback(get, set);
  }, delayMs);
}

export const setShiftingMiniStore = create<SetShiftingMiniState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  status: "stimulus",
  events: [],
  isPractice: true,
  practiceDoneTrials: 0,
  practiceTotalTrials: 0,
  mainDoneTrials: 0,
  mainTotalTrials: 0,
  activeRule: null,
  lastWasCorrect: null,
  lastTimedOut: false,
  lastCorrectLabel: "",
  _refs: {
    stimulusOnset: 0,
    blockStart: 0,
    events: [],
    timeoutId: null,
    practiceTrialsTarget: 0,
    mainTrialsTarget: 0,
    responseRecordedForTrialIndex: -1,
    practiceSaved: false,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    mainRuleSequence: ["click_red", "click_blue"],
    mainPhaseIndex: 0,
    mainStreak: 0,
    mainTrialsInCurrentPhase: 0,
    mainPostSwitchCriterionCount: 0,
    mainTrialsToLearnByPhase: [],
    mainPendingPhaseAdvance: false,
    mainInitialCriterionReached: false,
    mainThirdRuleLocked: false,
    mainLearningComplete: false,
  },

  startSession: async () => {
    try {
      const res = await sessionsService.create(TASK_NAME);
      catStore.getState().resetForNewTask();
      const config = await catStore.getState().loadTaskConfig(res.session_id, TASK_NAME);
      const practiceTrials = Math.floor(Number(config?.practice_config?.max_trials));
      const rawMain = Math.floor(Number(config?.max_trials));
      const mainTrials = Math.min(MAIN_MAX, Math.max(MAIN_MIN, rawMain));
      if (!Number.isFinite(practiceTrials) || practiceTrials < 1) {
        throw new Error("Missing CAT practice max_trials for set_shifting_mini.");
      }
      if (!Number.isFinite(rawMain) || rawMain < 1) {
        throw new Error("Missing CAT main max_trials for set_shifting_mini.");
      }

      const { _refs } = get();
      get().cleanup();
      _refs.blockStart = performance.now();
      _refs.events = [];
      _refs.practiceTrialsTarget = practiceTrials;
      _refs.mainTrialsTarget = mainTrials;
      _refs.responseRecordedForTrialIndex = -1;
      _refs.practiceSaved = false;
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
      resetMainAdaptiveRefs(_refs);

      const trials = buildPracticeTrials(practiceTrials);
      _refs.stimulusOnset = performance.now();
      _refs.timeoutId = setTimeout(() => get().recordSelection(null), RESPONSE_TIMEOUT_MS);

      set({
        sessionId: res.session_id,
        phase: "practice",
        status: "stimulus",
        trials,
        trialIndex: 0,
        events: [],
        isPractice: true,
        practiceDoneTrials: 0,
        practiceTotalTrials: practiceTrials,
        mainDoneTrials: 0,
        mainTotalTrials: mainTrials,
        activeRule: trials[0]?.rule ?? null,
        lastWasCorrect: null,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    }
  },

  recordSelection: (itemId) => {
    if (isTaskPaused()) return;
    const { trials, trialIndex, _refs, phase, status, isPractice } = get();
    if (phase !== "practice" && phase !== "running") return;
    if (status !== "stimulus") return;
    const trial = trials[trialIndex];
    if (!trial) return;
    if (_refs.responseRecordedForTrialIndex === trialIndex) return;
    _refs.responseRecordedForTrialIndex = trialIndex;

    if (_refs.timeoutId) {
      clearTimeout(_refs.timeoutId);
      _refs.timeoutId = null;
    }

    const now = performance.now();
    const selected = trial.items.find((i) => i.id === itemId) ?? null;
    const correctItem = trial.items.find((i) => i.id === trial.correctItemId) ?? null;
    const isCorrect = selected?.id === trial.correctItemId;
    const timedOut = itemId == null;
    const previousRule = trial.previousRule;
    const perseverationError = Boolean(
      !isCorrect && selected && previousRule && matchesRule(selected, previousRule),
    );

    if (!isPractice) {
      _refs.mainTrialsInCurrentPhase += 1;
      if (isCorrect) {
        _refs.mainStreak += 1;
      } else {
        _refs.mainStreak = 0;
      }
      if (_refs.mainStreak >= CRITERION_STREAK) {
        _refs.mainPendingPhaseAdvance = true;
      }
    }

    _refs.events.push({
      task_name: TASK_NAME,
      trial_index: trialIndex,
      stimulus_onset_ms: _refs.stimulusOnset,
      keypress_ms: itemId ? now : null,
      reaction_time_ms: itemId ? now - _refs.stimulusOnset : null,
      is_correct: isCorrect,
      response_key: itemId,
      correct_key: trial.correctItemId,
      event_type: trial.isSwitch ? "switch" : "repeat",
      extra_data: {
        trial: trialIndex + 1,
        rule: trial.rule,
        previous_rule: previousRule,
        user_selection: selected ? [`${selected.color}_${selected.shape}`] : [],
        correct: isCorrect,
        perseveration_error: perseverationError,
        response_time_ms: itemId ? now - _refs.stimulusOnset : null,
        is_practice: isPractice,
        ...(!isPractice
          ? {
              main_phase_index: _refs.mainPhaseIndex,
              main_phase_rule: trial.rule,
              main_trial_within_phase: _refs.mainTrialsInCurrentPhase,
              main_criterion_streak_after: _refs.mainStreak,
              ...(isCorrect && _refs.mainStreak >= CRITERION_STREAK
                ? {
                    main_phase_criterion_reached: true,
                    trials_to_criterion_this_phase: _refs.mainTrialsInCurrentPhase,
                  }
                : {}),
            }
          : {}),
      },
    });

    const lastPracticeTrialIndex =
      isPractice && trials.length > 0 && trialIndex === trials.length - 1;

    let feedbackDelay = FEEDBACK_MS;
    if (lastPracticeTrialIndex) feedbackDelay = FEEDBACK_MS_LAST_PRACTICE;

    set({
      events: [..._refs.events],
      phase: "feedback",
      status: "feedback",
      activeRule: trial.rule,
      lastWasCorrect: isCorrect,
      lastTimedOut: timedOut,
      lastCorrectLabel: correctItem ? `${correctItem.color} ${correctItem.shape}` : "",
    });

    scheduleSetShiftingFeedbackAdvance(get, set, feedbackDelay);
  },

  finishAndSave: async () => {
    const { sessionId, _refs } = get();
    if (!sessionId) return;
    const lowConfidence = !_refs.mainLearningComplete;
    try {
      if (_refs.events.length > 0) {
        await sessionsService.postEvents(sessionId, [..._refs.events]);
        await sessionsService.postBlocks(sessionId, {
          task_name: TASK_NAME,
          block_index: 0,
          block_start_ts: _refs.blockStart,
          block_end_ts: performance.now(),
          low_confidence_flag: lowConfidence,
        });
      }
      await sessionsService.scoreSetShiftingMini(sessionId);
      toast.success("Set-shifting mini results saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  },

  startMainPhase: () => {
    const state = get();
    if (state.phase !== "running" || state.isPractice) return;
    if (state._refs.timeoutId) return;
    state._refs.stimulusOnset = performance.now();
    state._refs.timeoutId = setTimeout(() => state.recordSelection(null), RESPONSE_TIMEOUT_MS);
  },

  cleanup: () => {
    const { _refs } = get();
    if (_refs.timeoutId) {
      clearTimeout(_refs.timeoutId);
      _refs.timeoutId = null;
    }
  },

  resumeAfterPause: () => {
    const state = get();
    const { phase, status, _refs, isPractice, trialIndex, trials } = state;
    if (_refs.timeoutId) return;

    if (phase === "feedback") {
      const lastPracticeTrialIndex =
        isPractice && trials.length > 0 && trialIndex === trials.length - 1;
      const delay = lastPracticeTrialIndex ? FEEDBACK_MS_LAST_PRACTICE : FEEDBACK_MS;
      scheduleSetShiftingFeedbackAdvance(get, set, delay);
      return;
    }

    if (phase === "main_countdown_pending") {
      _refs.timeoutId = setTimeout(() => {
        const s = get();
        if (s.phase !== "main_countdown_pending") return;
        set({ phase: "main_countdown_go" });
      }, POST_PRACTICE_RECAP_HOLD_MS);
      return;
    }

    if (phase === "running" || (phase === "practice" && status === "stimulus")) {
      _refs.stimulusOnset = performance.now();
      _refs.timeoutId = setTimeout(() => get().recordSelection(null), RESPONSE_TIMEOUT_MS);
    }
  },

  prepareForFreshRun: () => {
    get().cleanup();
    const { _refs } = get();
    _refs.stimulusOnset = 0;
    _refs.blockStart = 0;
    _refs.events = [];
    _refs.timeoutId = null;
    _refs.practiceTrialsTarget = 0;
    _refs.mainTrialsTarget = 0;
    _refs.responseRecordedForTrialIndex = -1;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    resetMainAdaptiveRefs(_refs);
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      status: "stimulus",
      events: [],
      isPractice: true,
      practiceDoneTrials: 0,
      practiceTotalTrials: 0,
      mainDoneTrials: 0,
      mainTotalTrials: 0,
      activeRule: null,
      lastWasCorrect: null,
      lastTimedOut: false,
      lastCorrectLabel: "",
    });
  },
}));

export const setShiftingRuleText = RULE_TEXT;
