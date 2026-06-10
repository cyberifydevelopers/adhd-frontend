import { useEffect, useRef } from "react";
import { isPausableTaskPhase } from "@/lib/taskPauseGuard";
import { taskPauseStore } from "@/stores/taskPauseStore";

/**
 * Registers pause/resume with the global task session store for TaskLayout exit UX.
 * Returns `isPaused` — include it in scheduling effect deps and bail out when true.
 */
export function useTaskPauseRegistration(opts: {
  phase: string;
  cleanup: () => void;
  /** Restarts trial timers / scheduling after a modal dismisses (required for timer-driven tasks). */
  resume?: () => void;
}): boolean {
  const isPaused = taskPauseStore((s) => s.isPaused);
  const isActive = isPausableTaskPhase(opts.phase);
  const resumeRef = useRef(opts.resume);
  resumeRef.current = opts.resume;

  useEffect(() => {
    if (!isActive) {
      taskPauseStore.getState().unregisterSession();
      return;
    }
    taskPauseStore.getState().registerSession({
      pause: () => {
        opts.cleanup();
      },
      resume: () => {
        resumeRef.current?.();
      },
    });
    return () => taskPauseStore.getState().unregisterSession();
  }, [isActive, opts.cleanup]);

  useEffect(() => {
    if (!isPaused || !isActive) return;
    opts.cleanup();
  }, [isPaused, isActive, opts.cleanup]);

  const wasPausedRef = useRef(false);
  useEffect(() => {
    if (wasPausedRef.current && !isPaused && isActive) {
      resumeRef.current?.();
    }
    wasPausedRef.current = isPaused;
  }, [isPaused, isActive]);

  return isPaused;
}
