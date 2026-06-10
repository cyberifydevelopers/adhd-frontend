/**
 * CAT per-trial state store — pure statistical checks, no API calls.
 * Detects: CI convergence, lapse streak, anticipatory pattern, random responding.
 * Triggers block end early when thresholds breached (after min trial floor).
 *
 * Also manages: task config (min/max trials), mid-task LLM checkpoints.
 */
import { create } from "zustand";
import { CAT_CONFIG } from "@/config/catConfig";
import { catService } from "@/services/catService";
import type { CATRoutingDecision, TaskTrialConfig } from "@/types/cat";

/** Minimal trial shape — tasks pass this after each trial event. */
export type CATTrialInput = {
  /** RT in ms; null = omission (no response) */
  reaction_time_ms?: number | null;
  /** Target/go trial where response was expected */
  expected_response?: boolean;
};

export type BlockEndTriggerReason =
  | "ci_converged"
  | "session_max_trials"
  | "lapse_streak"
  | "anticipatory_pattern"
  | "random_responding"
  | "llm_checkpoint_stop"
  | "se_theta_converged"
  | "main_adaptive_stop"
  | null;

type CATState = {
  trialBuffer: CATTrialInput[];
  currentTaskCIWidth: number | null;
  lapseStreak: number;
  anticipatoryCount: number;
  domainSignalFlags: Record<string, number>;
  shouldTriggerBlockEnd: boolean;
  blockEndTriggerReason: BlockEndTriggerReason;
  /** Last non-null reason from setBlockEndTrigger; survives clearTrigger() for debugging / UX. */
  lastBlockEndSignalReason: BlockEndTriggerReason;
  isRouting: boolean;
  pendingNextTask: string | null;

  // Task config state (dynamic trial counts from backend)
  taskConfig: TaskTrialConfig | null;
  checkpointPending: boolean;
  lastCheckpointTrialIndex: number;

  addTrial: (trial: CATTrialInput) => void;
  resetForNewTask: () => void;
  setBlockEndTrigger: (reason: BlockEndTriggerReason) => void;
  clearTrigger: () => void;
  requestRoutingDecision: (
    sessionId: string,
    taskName: string,
    triggerReason: string,
    blockMetrics: Record<string, unknown>,
  ) => Promise<CATRoutingDecision | null>;

  // Config + checkpoint methods
  loadTaskConfig: (sessionId: string, taskName: string) => Promise<TaskTrialConfig | null>;
  shouldCheckpoint: (trialIndex: number) => boolean;
  requestCheckpoint: (
    sessionId: string,
    taskName: string,
    trialsCompleted: number,
    runningMetrics: Record<string, unknown>,
  ) => void;
};

/** 95% CI half-width for RTs: 1.96 * (SD / sqrt(n)) */
function compute95CIHalfWidth(rts: number[]): number {
  const n = rts.length;
  if (n < 2) return Infinity;
  const mean = rts.reduce((a, b) => a + b, 0) / n;
  const variance = rts.reduce((a, rt) => a + (rt - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  return 1.96 * (sd / Math.sqrt(n));
}

export const catStore = create<CATState>((set, get) => ({
  trialBuffer: [],
  currentTaskCIWidth: null,
  lapseStreak: 0,
  anticipatoryCount: 0,
  domainSignalFlags: {},
  shouldTriggerBlockEnd: false,
  blockEndTriggerReason: null,
  lastBlockEndSignalReason: null,
  isRouting: false,
  pendingNextTask: null,
  taskConfig: null,
  checkpointPending: false,
  lastCheckpointTrialIndex: 0,

  addTrial: (trial) => {
    const state = get();
    const {
      trialBuffer,
      lapseStreak,
      anticipatoryCount,
      shouldTriggerBlockEnd,
    } = state;
    const {
      trialBufferSize,
      minTrialsBeforeTrigger,
      lapseStreakThreshold,
      anticipatoryRtMs,
    } = CAT_CONFIG;

    if (shouldTriggerBlockEnd) return;

    const isOmission =
      trial.expected_response === true &&
      (trial.reaction_time_ms == null || trial.reaction_time_ms === undefined);

    const nextLapseStreak = isOmission ? lapseStreak + 1 : 0;

    let nextAnticipatory = anticipatoryCount;
    if (
      typeof trial.reaction_time_ms === "number" &&
      trial.reaction_time_ms < anticipatoryRtMs
    ) {
      nextAnticipatory += 1;
    } else {
      nextAnticipatory = 0;
    }

    const buf = [...trialBuffer, trial];
    const trimmed =
      buf.length > trialBufferSize ? buf.slice(-trialBufferSize) : buf;

    const validRTs = trimmed
      .map((t) => t.reaction_time_ms)
      .filter((rt): rt is number => typeof rt === "number");

    const ciWidth =
      validRTs.length >= 2 ? compute95CIHalfWidth(validRTs) : null;

    const totalTrialsCompleted = trimmed.length;
    const canTrigger = totalTrialsCompleted >= minTrialsBeforeTrigger;
    if (canTrigger && nextLapseStreak >= lapseStreakThreshold) {
      set({
        trialBuffer: trimmed,
        currentTaskCIWidth: ciWidth,
        lapseStreak: nextLapseStreak,
        anticipatoryCount: nextAnticipatory,
        shouldTriggerBlockEnd: true,
        blockEndTriggerReason: "lapse_streak",
        lastBlockEndSignalReason: "lapse_streak",
      });
      return;
    }

    set({
      trialBuffer: trimmed,
      currentTaskCIWidth: ciWidth,
      lapseStreak: nextLapseStreak,
      anticipatoryCount: nextAnticipatory,
    });
  },

  resetForNewTask: () => {
    set({
      trialBuffer: [],
      currentTaskCIWidth: null,
      lapseStreak: 0,
      anticipatoryCount: 0,
      shouldTriggerBlockEnd: false,
      blockEndTriggerReason: null,
      lastBlockEndSignalReason: null,
      isRouting: false,
      pendingNextTask: null,
      taskConfig: null,
      checkpointPending: false,
      lastCheckpointTrialIndex: 0,
    });
  },

  setBlockEndTrigger: (reason) => {
    set({
      shouldTriggerBlockEnd: !!reason,
      blockEndTriggerReason: reason,
      ...(reason ? { lastBlockEndSignalReason: reason } : {}),
    });
  },

  clearTrigger: () => {
    set({ shouldTriggerBlockEnd: false, blockEndTriggerReason: null });
  },

  requestRoutingDecision: async (sessionId, taskName, triggerReason, blockMetrics) => {
    if (get().isRouting) return null;
    set({ isRouting: true });
    try {
      const decision = await catService.requestRoutingDecision(sessionId, {
        task_completed: taskName,
        trigger_reason: triggerReason,
        block_metrics: blockMetrics,
      });
      return decision;
    } catch (err) {
      console.error("[catStore] Routing decision failed:", err);
      return null;
    } finally {
      set({ isRouting: false });
    }
  },

  loadTaskConfig: async (sessionId, taskName) => {
    try {
      const config = await catService.getTaskConfig(sessionId, taskName);
      set({ taskConfig: config, lastCheckpointTrialIndex: 0, checkpointPending: false });
      return config;
    } catch (err) {
      console.error("[catStore] Failed to load task config:", err);
      set({ taskConfig: null });
      return null;
    }
  },

  shouldCheckpoint: (trialIndex) => {
    const { taskConfig, lastCheckpointTrialIndex, checkpointPending, shouldTriggerBlockEnd } = get();
    if (!taskConfig || checkpointPending || shouldTriggerBlockEnd) return false;
    // Force full main-test run: checkpoint only once at configured max_trials.
    if (trialIndex < taskConfig.max_trials) return false;
    return lastCheckpointTrialIndex < taskConfig.max_trials;
  },

  requestCheckpoint: (sessionId, taskName, trialsCompleted, runningMetrics) => {
    const state = get();
    if (state.checkpointPending || state.shouldTriggerBlockEnd) return;

    set({ checkpointPending: true, lastCheckpointTrialIndex: trialsCompleted });

    // Fire and forget — non-blocking
    catService
      .requestCheckpoint(sessionId, {
        task_name: taskName,
        trials_completed: trialsCompleted,
        running_metrics: runningMetrics,
      })
      .then((response) => {
        if (response.action === "stop_task") {
          set({
            shouldTriggerBlockEnd: true,
            blockEndTriggerReason: "llm_checkpoint_stop",
            lastBlockEndSignalReason: "llm_checkpoint_stop",
            checkpointPending: false,
          });
        } else {
          set({ checkpointPending: false });
        }
      })
      .catch((err) => {
        console.error("[catStore] Checkpoint request failed:", err);
        set({ checkpointPending: false });
      });
  },
}));
