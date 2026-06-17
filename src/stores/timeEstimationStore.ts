import { create } from "zustand";
import { sessionsService, usersMeService } from "@/services";
import { toast } from "@/lib/toast";
import { catStore } from "./catStore";
import { PRACTICE_CONFIG } from "@/config/catConfig";
import type { AdaptiveHistory } from "@/lib/mainAdaptiveEngine";
import { resetMainAdaptiveHistory, tryMainAdaptiveStop } from "@/lib/mainAdaptiveIntegration";
import { buildTimeEstimationCheckpointFromEvents } from "@/lib/mainAdaptiveBridge";
import { isTaskPaused } from "@/lib/taskPauseGuard";
import { ageFromIsoDateOfBirth } from "@/lib/digitSpanSpec";
import { timeEstimationTargetDurationsMsFromAge } from "@/lib/mainTestAgeDefaults";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

/** Bounds for random target draw (seconds); younger cohort caps at 10 s. */
export const TIME_EST_TARGET_DURATIONS_MS = [5000, 10000, 15000] as const;

export type TrialMode = "production" | "reproduction";
export type TimeEstCondition = "clean" | "distractor";

export type TimeEstPhase =
  | "instructions"
  | "practice"
  | "practice_wrapup"
  | "running"
  | "extension"
  | "complete";

export type TimeEstTrial = { duration: number; mode: TrialMode; condition: TimeEstCondition };

function resolveConfiguredCount(value: unknown, fallback?: unknown): number {
  const primary = Math.floor(Number(value));
  if (Number.isFinite(primary) && primary >= 1) return primary;
  const secondary = Math.floor(Number(fallback));
  if (Number.isFinite(secondary) && secondary >= 1) return secondary;
  return 0;
}

function readIncludeDistractor(config: Record<string, unknown> | null | undefined): boolean {
  if (!config) return false;
  if (config.include_distractor_period === true) return true;
  if (config.time_estimation_distractor === true) return true;
  const nested = config.time_estimation as Record<string, unknown> | undefined;
  if (nested?.include_distractor === true) return true;
  return false;
}

/**
 * Build ordered reproduction cells: clean block first, optional distractor second.
 * Random whole-second targets within age bounds; consecutive trials avoid the same duration when possible.
 */
function buildReproductionCells(scoredReproductionCount: number, includeDistractor: boolean): TimeEstCondition[] {
  const cleanN = includeDistractor ? Math.floor(scoredReproductionCount / 2) : scoredReproductionCount;
  const distrN = includeDistractor ? scoredReproductionCount - cleanN : 0;
  const clean: TimeEstCondition[] = Array.from({ length: cleanN }, () => "clean");
  const distr: TimeEstCondition[] = Array.from({ length: distrN }, () => "distractor");
  return [...clean, ...distr];
}

function durationBoundsMs(durs: readonly number[]): { minMs: number; maxMs: number } {
  if (durs.length === 0) return { minMs: 5000, maxMs: 15000 };
  return { minMs: Math.min(...durs), maxMs: Math.max(...durs) };
}

/** Random whole-second targets between bounds; avoids the same duration on consecutive trials. */
export function assignRandomTargetDurations(
  count: number,
  bounds: readonly number[],
): { durations: number[]; hadAdjacentDurationRepair: boolean } {
  const { minMs, maxMs } = durationBoundsMs(bounds);
  const minSec = Math.round(minMs / 1000);
  const maxSec = Math.round(maxMs / 1000);
  const pick = () => (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000;
  const durations = Array.from({ length: count }, pick);

  let hadAdjacentDurationRepair = false;
  for (let i = 1; i < durations.length; i++) {
    if (durations[i] === durations[i - 1]) {
      hadAdjacentDurationRepair = true;
      let swapped = false;
      for (let j = i + 1; j < durations.length; j++) {
        if (durations[j] !== durations[i - 1]) {
          const tmp = durations[i]!;
          durations[i] = durations[j]!;
          durations[j] = tmp;
          swapped = true;
          break;
        }
      }
      if (!swapped) {
        durations[i] = pick();
        if (durations[i] === durations[i - 1] && minSec < maxSec) {
          durations[i] = durations[i] === maxSec * 1000 ? minSec * 1000 : maxSec * 1000;
        }
      }
    }
  }

  return { durations, hadAdjacentDurationRepair };
}

export type BuildTimeEstimationTrialsOptions = {
  /**
   * Practice: reproduction-only rows with a watch-interval demo before each press trial.
   * Alias: `practiceWatchFirst`.
   */
  reproductionOnly?: boolean;
  /** @deprecated Use `reproductionOnly` (practice builds pass `practiceWatchFirst: true`). */
  practiceWatchFirst?: boolean;
  /** When set, round-robin these target durations instead of {@link TIME_EST_TARGET_DURATIONS_MS}. */
  targetDurationsMs?: readonly number[];
};

/**
 * Expand reproduction cells to trials.
 * Practice: `reproductionOnly` / `practiceWatchFirst` — one reproduction row per cell (watch cue in UI).
 * Main/extension: `reproductionOnly` — one scored press trial per cell (no production, no watch demo).
 */
export function buildTimeEstimationTrials(
  scoredReproductionCount: number,
  includeDistractor: boolean,
  options?: BuildTimeEstimationTrialsOptions,
): { trials: TimeEstTrial[]; hadAdjacentDurationRepair: boolean } {
  const conditions = buildReproductionCells(scoredReproductionCount, includeDistractor);
  const durSource =
    options?.targetDurationsMs != null && options.targetDurationsMs.length > 0
      ? options.targetDurationsMs
      : TIME_EST_TARGET_DURATIONS_MS;
  const { durations: durs, hadAdjacentDurationRepair: randomAdjacentRepair } = assignRandomTargetDurations(
    conditions.length,
    durSource,
  );
  const cells = conditions.map((condition, i) => ({ duration: durs[i]!, condition }));

  // Clean / distractor boundary: avoid same duration across boundary
  if (cells.length >= 2) {
    const split = includeDistractor ? Math.floor(scoredReproductionCount / 2) : cells.length;
    if (split > 0 && split < cells.length) {
      const a = cells[split - 1]!;
      const b = cells[split]!;
      if (a.duration === b.duration) {
        for (let j = split; j < cells.length; j++) {
          if (cells[j]!.duration !== a.duration) {
            const tmp = cells[split]!;
            cells[split] = cells[j]!;
            cells[j] = tmp;
            break;
          }
        }
      }
    }
  }

  let hadAdjacentDurationRepair = randomAdjacentRepair;
  for (let i = 1; i < cells.length; i++) {
    if (cells[i]!.duration === cells[i - 1]!.duration) {
      hadAdjacentDurationRepair = true;
      let swapped = false;
      for (let j = i + 1; j < cells.length; j++) {
        if (cells[j]!.duration !== cells[i - 1]!.duration) {
          const tmp = cells[i]!;
          cells[i] = cells[j]!;
          cells[j] = tmp;
          swapped = true;
          break;
        }
      }
      if (!swapped) {
        for (let j = 0; j < i - 1; j++) {
          if (cells[j]!.duration !== cells[i]!.duration) {
            const tmp = cells[i - 1]!;
            cells[i - 1] = cells[j]!;
            cells[j] = tmp;
            break;
          }
        }
      }
    }
  }

  const reproductionOnly =
    options?.reproductionOnly === true || options?.practiceWatchFirst === true;
  const trials: TimeEstTrial[] = [];
  for (const cell of cells) {
    if (!reproductionOnly) {
      trials.push({ duration: cell.duration, mode: "production", condition: cell.condition });
    }
    trials.push({ duration: cell.duration, mode: "reproduction", condition: cell.condition });
  }
  return { trials, hadAdjacentDurationRepair };
}

type Refs = {
  startMs: number;
  events: Record<string, unknown>[];
  /** Scored reproduction trials configured for main block */
  mainScoredReproductionTarget: number;
  /** One closure press per reproduction segment (blocks double-submit). */
  runningSegmentCommitted: boolean;
  practiceBlockStart: number;
  /** Global practice bounds + CAT (clamped to 5–20 reproductions). */
  practiceMinRepro: number;
  practiceMaxRepro: number;
  mainAdaptiveHistory: AdaptiveHistory;
  includeDistractorPeriod: boolean;
  /** True if last main/extension trial plan had to repair same-duration adjacency */
  lastPlanAdjacentRepair: boolean;
  /** Targets for this session (age-based shorter list for younger participants). */
  mainTargetDurationsMs: readonly number[];
};

type TimeEstimationState = {
  phase: TimeEstPhase;
  sessionId: string | null;
  trialIndex: number;
  trials: TimeEstTrial[];
  /** Number of scored reproduction trials (matches CAT max_trials / max_round_trials). */
  maxTrials: number;
  status: "ready" | "running" | "complete" | "watching";
  events: Record<string, unknown>[];
  additionalTrials: number;
  _refs: Refs;
  addEvent: (ev: Record<string, unknown>) => void;
  handlePress: () => void;
  startSession: () => Promise<void>;
  startExtension: (trialsToAdd: number) => void;
  finishAndSave: () => Promise<void>;
  finishExtension: () => Promise<void>;
  /** Called after practice wrap-up + main countdown — loads main trials. */
  beginMainAfterPracticeWrapup: () => void;
  /** After passive watch interval (practice reproduction cue): allow Start and next Stop. */
  completeWatchInterval: () => void;
  prepareForFreshRun: () => void;
};

function reproductionCompletedCount(events: Record<string, unknown>[]): number {
  return events.filter((e) => e.event_type === "reproduction").length;
}

function reproductionEvents(events: Record<string, unknown>[]): Record<string, unknown>[] {
  return events.filter((e) => e.event_type === "reproduction");
}

/**
 * Accuracy on the last up to `window` reproduction trials (requires full window for a score).
 */
function lastWindowReproductionAccuracy(
  events: Record<string, unknown>[],
  window: number,
): number | null {
  const reps = reproductionEvents(events).filter((e) => typeof e.is_correct === "boolean");
  if (reps.length < window) return null;
  const slice = reps.slice(-window);
  const correct = slice.filter((e) => e.is_correct === true).length;
  return correct / slice.length;
}

/** Clamp CAT practice counts to global PRACTICE_CONFIG (5–20 repro attempts). */
function resolvePracticeReproductionBounds(practiceCfg: Record<string, unknown>): {
  minRepro: number;
  maxRepro: number;
} {
  const globalMin = PRACTICE_CONFIG.minTrials;
  const globalMax = PRACTICE_CONFIG.maxTrials;
  const rawMax = resolveConfiguredCount(practiceCfg.max_round_trials, practiceCfg.max_trials);
  const rawMin = resolveConfiguredCount(practiceCfg.min_round_trials, practiceCfg.min_trials);
  const maxRepro =
    rawMax >= 1 ? Math.min(globalMax, Math.max(globalMin, rawMax)) : globalMax;
  const minReproBase = rawMin >= 1 ? Math.min(maxRepro, Math.max(globalMin, rawMin)) : globalMin;
  const minRepro = Math.min(maxRepro, Math.max(globalMin, minReproBase));
  return { minRepro, maxRepro };
}

export const timeEstimationStore = create<TimeEstimationState>((set, get) => ({
  phase: "instructions",
  sessionId: null,
  trialIndex: 0,
  trials: [],
  maxTrials: 0,
  status: "ready",
  events: [],
  additionalTrials: 0,
  _refs: {
    startMs: 0,
    events: [],
    mainScoredReproductionTarget: 0,
    runningSegmentCommitted: false,
    practiceBlockStart: 0,
    mainAdaptiveHistory: resetMainAdaptiveHistory(),
    includeDistractorPeriod: false,
    lastPlanAdjacentRepair: false,
    practiceMinRepro: PRACTICE_CONFIG.minTrials,
    practiceMaxRepro: PRACTICE_CONFIG.maxTrials,
    mainTargetDurationsMs: TIME_EST_TARGET_DURATIONS_MS,
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

    const { sessionId } = get();
    const cat = catStore.getState();
    const reproDone = reproductionCompletedCount(get()._refs.events);
    if (phase !== "practice" && sessionId && cat.shouldCheckpoint(reproDone)) {
      cat.requestCheckpoint(sessionId, "time_estimation", reproDone, {
        trials_completed: reproDone,
      });
    }
  },

  handlePress: () => {
    if (isTaskPaused()) return;
    const { phase, trials, trialIndex, status, _refs, addEvent } = get();
    const trial = trials[trialIndex];
    if (!trial) return;

    if (trial.mode === "reproduction" && status === "watching") return;

    if (status === "ready") {
      _refs.startMs = performance.now();
      _refs.runningSegmentCommitted = false;
      set({ status: "running" });
    } else if (status === "running") {
      if (_refs.runningSegmentCommitted) return;
      _refs.runningSegmentCommitted = true;
      try {
      const endMs = performance.now();
      const reproducedMs = endMs - _refs.startMs;
      const absTolMs = 1000;
      const isRep = trial.mode === "reproduction";
      const correct =
        isRep && typeof trial.duration === "number"
          ? Math.abs(reproducedMs - trial.duration) <= absTolMs
          : null;
      addEvent({
        task_name: "time_estimation",
        trial_index: trialIndex,
        stimulus_onset_ms: _refs.startMs,
        keypress_ms: endMs,
        reaction_time_ms: reproducedMs,
        response_key: null,
        correct_key: null,
        is_correct: correct,
        event_type: trial.mode,
        isi_ms: trial.duration,
        extra_data: {
          condition: trial.condition,
          target_duration_ms: trial.duration,
        },
      });
      const postPhase = get().phase;
      if (postPhase === "running" || postPhase === "extension") {
        const cp = buildTimeEstimationCheckpointFromEvents(get()._refs.events, {
          distractorPlanned: get()._refs.includeDistractorPeriod,
          adjacentDurationSwapInPlan: get()._refs.lastPlanAdjacentRepair,
        });
        get()._refs.mainAdaptiveHistory = tryMainAdaptiveStop(
          "time_estimation",
          cp,
          get()._refs.mainAdaptiveHistory,
          get().maxTrials,
        ).history;
      }
      const nextIdx = trialIndex + 1;
      if (phase === "practice") {
        const practiceEvents = get()._refs.events;
        const reproDone = reproductionCompletedCount(practiceEvents);
        const last5Acc = lastWindowReproductionAccuracy(practiceEvents, PRACTICE_CONFIG.evaluationInterval);
        const { practiceMinRepro, practiceMaxRepro } = get()._refs;

        const finishPractice = (passed: boolean) => {
          const snap = [...practiceEvents];
          const sid = get().sessionId;
          const lowConfidence = !passed;
          const accReport =
            lastWindowReproductionAccuracy(snap, PRACTICE_CONFIG.evaluationInterval) ??
            (reproductionEvents(snap).filter((e) => typeof e.is_correct === "boolean").length > 0
              ? reproductionEvents(snap).filter((e) => e.is_correct === true).length /
                reproductionEvents(snap).filter((e) => typeof e.is_correct === "boolean").length
              : 0);
          (async () => {
            try {
              if (sid && snap.length > 0) {
                const flagged = snap.map((ev) => ({
                  ...ev,
                  extra_data: {
                    ...((ev.extra_data as Record<string, unknown> | undefined) ?? {}),
                    is_practice: true,
                  },
                }));
                await sessionsService.postEvents(sid, flagged);
                await sessionsService.postBlocks(sid, {
                  task_name: "time_estimation",
                  block_index: -1,
                  practice_pass: passed,
                  practice_accuracy: accReport,
                  practice_trial_count: snap.length,
                  low_confidence_flag: lowConfidence,
                  practice_blocks_completed: Math.ceil(reproDone / PRACTICE_CONFIG.evaluationInterval),
                  practice_error_pattern: lowConfidence ? "timing_misunderstanding" : undefined,
                  block_start_ts: get()._refs.practiceBlockStart,
                  block_end_ts: performance.now(),
                });
              }
            } catch (err) {
              console.warn("[time_estimation] Practice block save failed (non-blocking):", err);
            }
          })();
          get()._refs.events = snap;
          set({
            phase: "practice_wrapup",
            status: "ready",
            events: snap,
            trialIndex,
          });
        };

        if (trial.mode === "reproduction" && reproDone >= practiceMinRepro && last5Acc != null) {
          if (last5Acc >= PRACTICE_CONFIG.passThreshold) {
            finishPractice(true);
            return;
          }
        }

        if (nextIdx >= trials.length) {
          if (reproDone >= practiceMaxRepro) {
            finishPractice(last5Acc != null && last5Acc >= PRACTICE_CONFIG.passThreshold);
            return;
          }
          if (trial.mode === "reproduction" && last5Acc != null) {
            if (last5Acc < PRACTICE_CONFIG.continueThreshold) {
              toast.info(
                "Simpler approach: watch the full bar once, then press Start and Stop only when you think the same amount of time has passed.",
              );
            } else if (last5Acc < PRACTICE_CONFIG.passThreshold) {
              toast.info(
                "Aim to finish within about one second of the target. Watch the interval, then reproduce it from memory.",
              );
            }
          }
          const addRepro = Math.min(
            PRACTICE_CONFIG.evaluationInterval,
            practiceMaxRepro - reproDone,
          );
          const { trials: extra } = buildTimeEstimationTrials(Math.max(1, addRepro), false, {
            practiceWatchFirst: true,
            targetDurationsMs: get()._refs.mainTargetDurationsMs,
          });
          const merged = [...get().trials, ...extra];
          const nextT = merged[nextIdx]!;
          set({
            trials: merged,
            trialIndex: nextIdx,
            status: phase === "practice" && nextT.mode === "reproduction" ? "watching" : "ready",
          });
          return;
        }

        const next = trials[nextIdx];
        const shouldWatchInterval = next?.mode === "reproduction";
        set({
          trialIndex: nextIdx,
          status: shouldWatchInterval ? "watching" : "ready",
        });
        return;
      }

      if (nextIdx >= trials.length) {
        set({ phase: "complete" });
      } else {
        set({
          trialIndex: nextIdx,
          status: "ready",
        });
      }
      } finally {
        get()._refs.runningSegmentCommitted = false;
      }
    }
  },

  startSession: async () => {
    try {
      const res = await sessionsService.create("time_estimation");
      const { _refs } = get();
      _refs.events = [];
      catStore.getState().resetForNewTask();
      _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();

      const config = await catStore.getState().loadTaskConfig(res.session_id, "time_estimation");
      const cfg = config as Record<string, unknown> | null | undefined;
      const trialCount = resolveConfiguredCount(cfg?.max_round_trials, config?.max_trials);
      const practiceCfg = (config?.practice_config as Record<string, unknown> | undefined) ?? {};
      const { minRepro, maxRepro } = resolvePracticeReproductionBounds(practiceCfg);
      _refs.practiceMinRepro = minRepro;
      _refs.practiceMaxRepro = maxRepro;

      if (!Number.isFinite(trialCount) || trialCount < 12) {
        throw new Error("time_estimation requires max_trials / max_round_trials ≥ 12 (scored reproductions).");
      }

      _refs.includeDistractorPeriod = readIncludeDistractor(cfg);
      if (_refs.includeDistractorPeriod && trialCount < 18) {
        throw new Error(
          "time_estimation with distractor requires max_trials / max_round_trials ≥ 18 (≥3 per duration in each condition).",
        );
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
      const targetDurs = timeEstimationTargetDurationsMsFromAge(dobAge);
      _refs.mainTargetDurationsMs = targetDurs;

      const initialPracticeRepro = Math.min(maxRepro, Math.max(minRepro, PRACTICE_CONFIG.minTrials));
      const { trials: t, hadAdjacentDurationRepair } = buildTimeEstimationTrials(
        initialPracticeRepro,
        false,
        { practiceWatchFirst: true, targetDurationsMs: targetDurs },
      );
      _refs.lastPlanAdjacentRepair = hadAdjacentDurationRepair;
      _refs.mainScoredReproductionTarget = trialCount;
      _refs.runningSegmentCommitted = false;
      _refs.practiceBlockStart = performance.now();
      set({
        sessionId: res.session_id,
        trials: t,
        maxTrials: maxRepro,
        trialIndex: 0,
        phase: "practice",
        status: t[0]?.mode === "reproduction" ? "watching" : "ready",
        events: [],
      });
      toast.success("Practice started.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to start"));
    }
  },

  beginMainAfterPracticeWrapup: () => {
    const { _refs } = get();
    const { trials: mainTrials, hadAdjacentDurationRepair } = buildTimeEstimationTrials(
      _refs.mainScoredReproductionTarget,
      _refs.includeDistractorPeriod,
      { reproductionOnly: true, targetDurationsMs: _refs.mainTargetDurationsMs },
    );
    _refs.lastPlanAdjacentRepair = hadAdjacentDurationRepair;
    _refs.events = [];
    _refs.runningSegmentCommitted = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    set({
      phase: "running",
      trials: mainTrials,
      maxTrials: _refs.mainScoredReproductionTarget,
      trialIndex: 0,
      status: "ready",
      events: [],
    });
    toast.success("Practice complete. Starting main task.");
  },

  startExtension: (trialsToAdd: number) => {
    const { _refs } = get();
    const minExt = _refs.includeDistractorPeriod ? 18 : 12;
    const extensionScored = Math.max(minExt, Math.min(30, Math.floor(trialsToAdd)));
    const { trials: t, hadAdjacentDurationRepair } = buildTimeEstimationTrials(
      extensionScored,
      _refs.includeDistractorPeriod,
      { reproductionOnly: true, targetDurationsMs: _refs.mainTargetDurationsMs },
    );
    _refs.lastPlanAdjacentRepair = hadAdjacentDurationRepair;
    _refs.events = [];
    _refs.runningSegmentCommitted = false;
    catStore.getState().resetForNewTask();
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    set({
      events: [],
      trials: t,
      maxTrials: extensionScored,
      trialIndex: 0,
      additionalTrials: extensionScored,
      status: "ready",
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
        task_name: "time_estimation",
        block_index: 0,
        block_start_ts: 0,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreTimeEstimation(sessionId);
      _refs.events = [];
      toast.success("Results saved.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to save"));
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
      } catch (err) {
        toast.error(apiErrorMessage(err, "Failed to send events"));
      }
    }
    try {
      await sessionsService.postBlocks(sessionId, {
        task_name: "time_estimation",
        block_index: 1,
        block_start_ts: 0,
        block_end_ts: performance.now(),
      });
      await sessionsService.scoreTimeEstimation(sessionId);
      toast.success("Extension block complete. Results saved.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to save"));
    }
    _refs.events = [];
    set({ events: [], phase: "complete" });
  },

  completeWatchInterval: () => {
    get()._refs.runningSegmentCommitted = false;
    set({ status: "ready" });
  },

  prepareForFreshRun: () => {
    const { _refs } = get();
    _refs.startMs = 0;
    _refs.events = [];
    _refs.mainScoredReproductionTarget = 0;
    _refs.runningSegmentCommitted = false;
    _refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
    _refs.includeDistractorPeriod = false;
    _refs.lastPlanAdjacentRepair = false;
    _refs.practiceMinRepro = PRACTICE_CONFIG.minTrials;
    _refs.practiceMaxRepro = PRACTICE_CONFIG.maxTrials;
    _refs.mainTargetDurationsMs = TIME_EST_TARGET_DURATIONS_MS;
    catStore.getState().resetForNewTask();
    set({
      phase: "instructions",
      sessionId: null,
      trialIndex: 0,
      trials: [],
      maxTrials: 0,
      status: "ready",
      events: [],
      additionalTrials: 0,
    });
  },
}));
