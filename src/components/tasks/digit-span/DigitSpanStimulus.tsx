type Props = {
  digit: string | null;
  digitPosition: number;
  sequenceLength: number;
  trialInSpan: number;
  trialsPerSpan: number;
  spanLength: number;
  direction?: "forward" | "backward";
};

export function DigitSpanStimulus({
  digit,
  digitPosition,
  sequenceLength,
  trialInSpan,
  trialsPerSpan,
  spanLength,
  direction = "forward",
}: Props) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      {direction && (
        <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {direction}
        </p>
      )}
      <div className="text-6xl font-mono font-bold tracking-widest text-foreground">
        {digit ?? "—"}
      </div>
      <div className="mt-4 flex flex-col items-center gap-1 text-sm text-muted-foreground">
        <p>
          Digit {digitPosition} of {sequenceLength}
          <span className="ml-1.5 text-muted-foreground/80">({sequenceLength - digitPosition} left in this sequence)</span>
        </p>
        <p>
          Trial {trialInSpan} of {trialsPerSpan} at length {spanLength}
        </p>
      </div>
    </div>
  );
}
