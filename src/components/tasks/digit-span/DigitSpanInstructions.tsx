import { Button } from "@/components/ui/Button";

type Props = { onStart: () => void };

export function DigitSpanInstructions({ onStart }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">Digit Span</h2>
        <div className="space-y-4 text-muted-foreground">
          <p>You will see a sequence of digits along with the word FORWARD or BACKWARD.</p>
          <p>
            Remember them and{" "}
            <strong className="font-semibold text-foreground">
              enter them in order (forward) or reverse order (backward) based on the word provided
            </strong>
            , using only number keys.
          </p>
        </div>
        <Button onClick={onStart} variant="outline" size="lg">
          Start
        </Button>
      </div>
    </div>
  );
}
