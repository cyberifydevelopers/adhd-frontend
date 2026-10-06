import { DigitSpanScreen } from "./DigitSpanScreen";

type Props = {
  digit: string | null;
  direction?: "forward" | "backward";
};

export function DigitSpanStimulus({ digit, direction = "forward" }: Props) {
  return (
    <DigitSpanScreen direction={direction}>
      <div className="text-6xl font-mono font-bold leading-none tracking-widest text-foreground">
        {digit ?? ""}
      </div>
    </DigitSpanScreen>
  );
}
