import { Button } from "@/components/ui/Button";

type Props = { onStart: () => void };

export function DigitSpanInstructions({ onStart }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">Digit Span</h2>
        <p className="text-muted-foreground">
          You will see a sequence of digits. Remember them and enter them in order (forward) or reverse order (backward) using only number keys—you will enter exactly one digit per item shown (no letters or symbols).
        </p>
        <Button onClick={onStart} variant="outline" size="lg">
          Start
        </Button>
      </div>
    </div>
  );
}
