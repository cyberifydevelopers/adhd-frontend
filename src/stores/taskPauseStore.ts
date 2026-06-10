import { create } from "zustand";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { resolveSessionAdaptivePolicy } from "@/lib/mainAdaptiveEngine";
import type { MainAdaptiveCheckpointData, MainAdaptiveSessionBounds } from "@/lib/mainAdaptiveEngine";

type SessionHandlers = {
  pause: () => void;
  resume: () => void;
};

type CheckpointMilestoneState = {
  open: boolean;
  title: string;
  description: string;
};

type TaskPauseState = {
  isSessionActive: boolean;
  isPaused: boolean;
  exitDialogOpen: boolean;
  checkpointMilestone: CheckpointMilestoneState | null;
  minCheckpointAnnounced: boolean;
  handlers: SessionHandlers | null;
  registerSession: (handlers: SessionHandlers) => void;
  unregisterSession: () => void;
  setPaused: (paused: boolean) => void;
  openExitConfirm: () => void;
  closeExitConfirm: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  showCheckpointMilestone: (payload: { title: string; description: string }) => void;
  dismissCheckpointMilestone: () => void;
  /** Pause modal once when scored trials reach session minimum (not on the first periodic eval after min). */
  maybeAnnounceMinCheckpointMilestone: (
    taskKey: MainAdaptiveTrialTaskKey,
    checkpoint: MainAdaptiveCheckpointData,
    bounds?: MainAdaptiveSessionBounds,
  ) => void;
};

export const taskPauseStore = create<TaskPauseState>((set, get) => ({
  isSessionActive: false,
  isPaused: false,
  exitDialogOpen: false,
  checkpointMilestone: null,
  minCheckpointAnnounced: false,
  handlers: null,

  registerSession: (handlers) => {
    set({
      handlers,
      isSessionActive: true,
      isPaused: false,
      exitDialogOpen: false,
      checkpointMilestone: null,
      minCheckpointAnnounced: false,
    });
  },

  unregisterSession: () => {
    set({
      handlers: null,
      isSessionActive: false,
      isPaused: false,
      exitDialogOpen: false,
      checkpointMilestone: null,
      minCheckpointAnnounced: false,
    });
  },

  setPaused: (paused) => set({ isPaused: paused }),

  openExitConfirm: () => {
    get().pauseSession();
    set({ exitDialogOpen: true });
  },

  closeExitConfirm: () => set({ exitDialogOpen: false }),

  pauseSession: () => {
    const { handlers, isPaused } = get();
    if (!isPaused) {
      handlers?.pause();
    }
    set({ isPaused: true });
  },

  resumeSession: () => {
    const { handlers } = get();
    set({ isPaused: false, exitDialogOpen: false });
    handlers?.resume();
  },

  showCheckpointMilestone: (payload) => {
    get().pauseSession();
    set({
      checkpointMilestone: {
        open: true,
        title: payload.title,
        description: payload.description,
      },
    });
  },

  dismissCheckpointMilestone: () => {
    set({ checkpointMilestone: null });
    if (get().exitDialogOpen) return;
    get().resumeSession();
  },

  maybeAnnounceMinCheckpointMilestone: (taskKey, checkpoint, bounds) => {
    if (get().minCheckpointAnnounced) return;
    const policy = resolveSessionAdaptivePolicy(taskKey, bounds);
    const trials = checkpoint.trialsCompleted ?? 0;
    if (trials < policy.minTrials) return;

    const nextPeriodicEval = policy.minTrials + policy.checkpointEvery;
    set({ minCheckpointAnnounced: true });
    get().showCheckpointMilestone({
      title: "Minimum trials complete",
      description: `You have completed the minimum required trials (${policy.minTrials}). The test may end early when stability criteria are met. Full adaptive evaluations run every ${policy.checkpointEvery} trials after the minimum (next at trial ${nextPeriodicEval}, unless the test stops earlier).`,
    });
  },
}));
