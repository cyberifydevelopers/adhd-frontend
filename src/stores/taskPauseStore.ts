import { create } from "zustand";

type SessionHandlers = {
  pause: () => void;
  resume: () => void;
};

type TaskPauseState = {
  isSessionActive: boolean;
  isPaused: boolean;
  exitDialogOpen: boolean;
  handlers: SessionHandlers | null;
  registerSession: (handlers: SessionHandlers) => void;
  unregisterSession: () => void;
  setPaused: (paused: boolean) => void;
  openExitConfirm: () => void;
  closeExitConfirm: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
};

export const taskPauseStore = create<TaskPauseState>((set, get) => ({
  isSessionActive: false,
  isPaused: false,
  exitDialogOpen: false,
  handlers: null,

  registerSession: (handlers) => {
    set({
      handlers,
      isSessionActive: true,
      isPaused: false,
      exitDialogOpen: false,
    });
  },

  unregisterSession: () => {
    set({
      handlers: null,
      isSessionActive: false,
      isPaused: false,
      exitDialogOpen: false,
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
}));
