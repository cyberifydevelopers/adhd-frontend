type Props = {
  stimulus: "left" | "right" | "stop" | null;
  /** Trials answered so far in the current phase (0 before first response) */
  completedTrials: number;
  totalTrials: number;
  phase?: string;
  practiceSubPhase?: string;
};

export function SSTStimulus({
  stimulus,
  completedTrials,
  totalTrials,
  phase,
  practiceSubPhase,
}: Props) {
  const done = Math.min(completedTrials, totalTrials);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      <div className="flex min-h-[1.2em] min-w-[1.2em] items-center justify-center text-7xl font-bold text-foreground">
        {stimulus === "left" && "←"}
        {stimulus === "right" && "→"}
        {stimulus === "stop" && <span className="text-amber-500">✕</span>}
      </div>
      {phase === "practice" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Practice completed {done} / {totalTrials}
          {practiceSubPhase === "final" ? " — Final (no feedback)" : ""}
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Completed {done} / {totalTrials}
        </p>
      )}
    </div>
  );
}
