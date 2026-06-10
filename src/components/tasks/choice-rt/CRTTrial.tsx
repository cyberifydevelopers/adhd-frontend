type Direction = "left" | "right" | "up" | "down";

type Props = {
  status: "waiting" | "stimulus" | "responded";
  direction: Direction | null;
  /** Trials already answered (0 before first response) */
  completedTrials: number;
  maxTrials: number;
  /** Hide footer when an external progress bar shows the same count (main/extension). */
  hideCompletedCaption?: boolean;
};

const ARROW_GLYPH: Record<Direction, string> = {
  right: "→",
  left: "←",
  up: "↑",
  down: "↓",
};

export function CRTTrial({
  status,
  direction,
  completedTrials,
  maxTrials,
  hideCompletedCaption = false,
}: Props) {
  const done = Math.min(completedTrials, maxTrials);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      {status === "waiting" && (
        <div className="flex flex-col items-center gap-4">
          <div className="text-7xl font-bold text-foreground" aria-hidden>
            +
          </div>
          <p className="text-muted-foreground">Fixate until the arrow appears</p>
        </div>
      )}
      {status === "stimulus" && direction && (
        <div className="flex flex-col items-center gap-6">
          <div
            className="text-8xl font-bold text-foreground"
            role="img"
            aria-label={`Arrow pointing ${direction}`}
          >
            {ARROW_GLYPH[direction]}
          </div>
          <p className="text-lg text-muted-foreground">Press the matching arrow key</p>
        </div>
      )}
      {status === "responded" && (
        <div className="text-muted-foreground">Recorded</div>
      )}
      {!hideCompletedCaption && (
        <p className="mt-8 text-sm text-muted-foreground">
          Completed {done} / {maxTrials}
        </p>
      )}
    </div>
  );
}
