import { useEffect, useState } from "react";
import { isTaskPaused } from "@/lib/taskPauseGuard";
import { Button } from "@/components/ui/Button";
import type { TrialMode, TimeEstCondition } from "@/stores/timeEstimationStore";

type Props = {
  status: "ready" | "running" | "complete" | "watching";
  mode: TrialMode;
  targetMs: number;
  condition?: TimeEstCondition;
  onPress: () => void;
  feedbackText?: string | null;
  showIntervalHints?: boolean;
  lastGuessMs?: number | null;
  /** Main/extension: scored round (1-based). Omitted in practice. */
  scoredRound?: number;
  /** Main/extension: one press trial per round (no step 1/2 labels). */
  singleScoredTrial?: boolean;
  /** Read-only recap after final practice trial (feedback + target, no button). */
  wrapupReview?: boolean;
};

export function TimeEstTrial({
  status,
  mode,
  targetMs,
  condition = "clean",
  onPress,
  feedbackText,
  showIntervalHints = false,
  scoredRound,
  singleScoredTrial = false,
  wrapupReview = false,
}: Props) {
  const targetSec = (targetMs / 1000).toFixed(1);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (status !== "watching" || isTaskPaused()) {
      setProgress(0);
      return;
    }
    const start = performance.now();
    const interval = setInterval(() => {
      if (isTaskPaused()) return;
      const elapsed = performance.now() - start;
      setProgress(Math.min(elapsed / targetMs, 1));
    }, 50);
    return () => clearInterval(interval);
  }, [status, targetMs]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      {condition === "distractor" && !wrapupReview && (
        <p className="mb-1 max-w-md text-center text-xs text-muted-foreground">
          Ignore on-screen distractions; time the interval the same way as before.
        </p>
      )}
      {scoredRound != null && !wrapupReview && (
        <p className="mb-1 text-xs font-medium text-muted-foreground">Round {scoredRound}</p>
      )}
      <p className="text-muted-foreground">
        {wrapupReview && "Practice round complete"}
        {!wrapupReview && status === "watching" &&
          (showIntervalHints
            ? "Watch the full interval — then reproduce it from memory"
            : "Get ready for the next step")}
        {!wrapupReview && status === "ready" &&
          (singleScoredTrial
            ? "Press Start when ready"
            : mode === "production"
              ? "Estimate the interval without watching — press Start when ready"
              : "Reproduce the interval — press Start when ready")}
        {!wrapupReview && status === "running" &&
          (singleScoredTrial
            ? "Press Stop when you think the target time has passed"
            : mode === "production"
              ? "Press Stop when you think the target time has passed (no preview)"
              : "Press Stop when you think the same time has passed")}
        {!wrapupReview && status === "complete" && "Trial complete"}
      </p>
      <p className="mt-2 text-2xl font-semibold">Target: {targetSec}s</p>
      {feedbackText && (
        <p className="mt-3 text-sm text-muted-foreground">{feedbackText}</p>
      )}
      {status === "watching" && showIntervalHints && !wrapupReview && (
        <div className="mt-4 h-2 w-64 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
      {!wrapupReview && (
      <Button
        className="mt-6"
        variant="outline"
        size="lg"
        onClick={onPress}
        disabled={status === "complete" || status === "watching"}
      >
        {status === "watching"
          ? "—"
          : status === "ready"
            ? "Start"
            : status === "running"
              ? "Stop"
              : "—"}
      </Button>
      )}
    </div>
  );
}
