import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Brain } from "lucide-react";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { SHOW_MAIN_ADAPTIVE_DEBUG_PANEL } from "@/config/mainAdaptiveDebug";
import { useTaskPauseRegistration } from "@/hooks/useTaskPauseRegistration";
import { isPausableTaskPhase } from "@/lib/taskPauseGuard";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { MainAdaptiveDebugPanel } from "./MainAdaptiveDebugPanel";
import { TaskSessionDialogs } from "./TaskSessionDialogs";

type TaskLayoutProps = {
  children: ReactNode;
  title?: string;
  /** Current task phase — used for exit confirm + pause during any active block. */
  phase?: string;
  /** Clears timers / listeners when pausing (typically store `cleanup`). */
  cleanup?: () => void;
  /** Restarts trial scheduling after pause (typically store `resumeAfterPause`). */
  resume?: () => void;
  mainAdaptiveTaskKey?: MainAdaptiveTrialTaskKey;
  showMainAdaptivePanel?: boolean;
};

export function TaskLayout({
  children,
  title = "Task",
  phase = "instructions",
  cleanup = () => {},
  resume,
  mainAdaptiveTaskKey,
  showMainAdaptivePanel = false,
}: TaskLayoutProps) {
  const navigate = useNavigate();
  const isPaused = useTaskPauseRegistration({ phase, cleanup, resume });
  const inActiveBlock = isPausableTaskPhase(phase);

  const handleBack = () => {
    if (inActiveBlock) {
      taskPauseStore.getState().openExitConfirm();
      return;
    }
    navigate("/user");
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <TaskSessionDialogs />
      <header className="border-b border-border/60 bg-card/95 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </button>
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">{title}</span>
            {isPaused ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                Paused
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-3 h-0.5 bg-gradient-to-r from-primary/60 via-accent/40 to-primary/60" />
      </header>
      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div
          className={`animate-fade-in ${isPaused ? "pointer-events-none select-none opacity-70" : ""}`}
          aria-hidden={isPaused ? true : undefined}
        >
          {children}
        </div>
        {isPaused ? (
          <div
            className="absolute inset-0 z-20 cursor-default"
            aria-hidden="true"
            onPointerDown={(e) => e.preventDefault()}
          />
        ) : null}
      </main>
      {SHOW_MAIN_ADAPTIVE_DEBUG_PANEL && mainAdaptiveTaskKey && showMainAdaptivePanel ? (
        <MainAdaptiveDebugPanel taskKey={mainAdaptiveTaskKey} />
      ) : null}
    </div>
  );
}
