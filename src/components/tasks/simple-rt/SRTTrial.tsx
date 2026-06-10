import { useMemo } from "react";
const STIMULUS_COLORS = [
  "bg-emerald-500 ring-emerald-400/50",
  "bg-blue-500 ring-blue-400/50",
  "bg-amber-500 ring-amber-400/50",
  "bg-rose-500 ring-rose-400/50",
  "bg-violet-500 ring-violet-400/50",
  "bg-cyan-500 ring-cyan-400/50",
  "bg-orange-500 ring-orange-400/50",
  "bg-fuchsia-500 ring-fuchsia-400/50",
] as const;

const STIMULUS_SHAPES = [
  { className: "rounded-full", label: "circle" },
  { className: "rounded-none", label: "square" },
  { className: "rotate-45 rounded-none", label: "diamond" },
  { className: "rounded-lg", label: "rounded-square" },
  { className: "rounded-3xl", label: "squircle" },
] as const;

type Props = {
  status: "waiting" | "stimulus" | "responded";
  /** Version key so the random stimulus reshapes when advancing trials */
  stimulusKey: number;
  /** Trials already answered (0 before first response) */
  completedTrials: number;
  maxTrials: number;
  phase?: string;
  practiceState?: { subPhase: string } | null;
  /** Hide footer when PracticeProgressBar shows the count (main/extension). */
  hideCompletedCaption?: boolean;
};

export function SRTTrial({
  status,
  stimulusKey,
  completedTrials,
  maxTrials,
  phase,
  practiceState,
  hideCompletedCaption = false,
}: Props) {
  const { colorClasses, shapeClasses } = useMemo(() => ({
    colorClasses: STIMULUS_COLORS[Math.floor(Math.random() * STIMULUS_COLORS.length)],
    shapeClasses: STIMULUS_SHAPES[Math.floor(Math.random() * STIMULUS_SHAPES.length)].className,
  }), [stimulusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = Math.min(completedTrials, maxTrials);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      {status === "waiting" && (
        <div className="flex flex-col items-center gap-4">
          <div className="text-7xl font-bold text-foreground" aria-hidden>+</div>
          <p className="text-muted-foreground">Fixate until the target appears</p>
        </div>
      )}
      {status === "stimulus" && (
        <div className="flex flex-col items-center gap-6">
          <div
            className={`h-24 w-24 shadow-lg ring-4 ${colorClasses} ${shapeClasses}`}
            aria-hidden
          />
          <p className="text-lg font-medium text-foreground">Press SPACE</p>
        </div>
      )}
      {status === "responded" && (
        <div className="text-muted-foreground">Recorded</div>
      )}
      {!hideCompletedCaption && (
        <p className="mt-8 text-sm text-muted-foreground">
          {phase === "practice" ? "Practice — " : ""}Completed {done} / {maxTrials}
          {phase === "practice" && practiceState?.subPhase === "final" ? " — Final (no feedback)" : ""}
        </p>
      )}
    </div>
  );
}
