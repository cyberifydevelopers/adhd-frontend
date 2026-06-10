type PracticeProgressBarProps = {
  /** Number of rounds/trials already submitted/finished — 0 before the first answer. */
  currentTrial: number;
  maxTrials: number;
  subPhase?: "early" | "final" | "reinstructions";
  label?: string;
  /** Larger track and type (e.g. Digit Span recall). */
  size?: "default" | "lg";
};

export function PracticeProgressBar({
  currentTrial,
  maxTrials,
  subPhase,
  label,
  size = "default",
}: PracticeProgressBarProps) {
  const cap = Math.max(0, maxTrials);
  const clampedCurrentTrial = Math.max(0, Math.min(currentTrial, cap || Infinity));
  const pct = cap > 0 ? Math.min(100, (clampedCurrentTrial / cap) * 100) : 0;
  const displayLabel =
    label ?? (subPhase === "final" ? "Final Practice — no feedback" : "Practice");

  const isLg = size === "lg";

  return (
    <div
      className={
        isLg ? "mt-4 w-full max-w-xl px-4 mx-auto" : "mt-4 w-full max-w-md mx-auto"
      }
    >
      <div
        className={
          isLg
            ? "flex items-center justify-between text-sm font-medium text-muted-foreground mb-2"
            : "flex items-center justify-between text-xs text-muted-foreground mb-1"
        }
      >
        <span>{displayLabel}</span>
        <span>
          {clampedCurrentTrial} / {cap}
        </span>
      </div>
      <div
        className={`w-full rounded-full bg-muted ${
          isLg ? "h-3 shadow-inner ring-1 ring-border/60" : "h-1.5"
        }`}
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
