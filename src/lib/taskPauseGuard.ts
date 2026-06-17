import { taskPauseStore } from "@/stores/taskPauseStore";

/** When true, task stores must not schedule new trials or advance the trial loop. */
export function isTaskPaused(): boolean {
  return taskPauseStore.getState().isPaused;
}

const NON_PAUSABLE_PHASES = new Set(["instructions", "complete"]);

/**
 * True while the participant is in an active task block (not instructions or complete).
 * Used to register pause/resume handlers and show the exit-confirm dialog.
 */
export function isPausableTaskPhase(phase: string | undefined): boolean {
  if (!phase) return false;
  return !NON_PAUSABLE_PHASES.has(phase);
}

/** Exit confirm dialog is open. */
export function isSessionDialogOpen(): boolean {
  return taskPauseStore.getState().exitDialogOpen;
}

const ACTIVE_RT_PHASES = new Set(["practice", "main", "extension"]);

type RtPauseTrialState = {
  phase: string;
  status: "waiting" | "stimulus" | "responded";
  trialIndex: number;
};

/**
 * When pause clears in-flight timeouts, practice can stay on `responded` with no
 * handler left to advance. Normalize trial state before timers are cleared.
 */
export function rtTrialStateAfterPauseCleanup(state: RtPauseTrialState): {
  status: "waiting";
  trialIndex?: number;
} | null {
  if (!ACTIVE_RT_PHASES.has(state.phase)) return null;
  if (state.status === "responded") {
    return { status: "waiting", trialIndex: state.trialIndex + 1 };
  }
  if (state.status === "stimulus") {
    return { status: "waiting" };
  }
  return null;
}
