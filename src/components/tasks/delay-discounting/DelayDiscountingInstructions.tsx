import { Button } from "@/components/ui/Button";

type Props = { onStart: () => void };

export function DelayDiscountingInstructions({ onStart }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-6 rounded-xl border border-border bg-card p-8">
        <h2 className="text-xl font-semibold">Delay discounting</h2>
        <p className="text-muted-foreground">
          Each trial shows <strong>money now</strong> on one side and <strong>more money after a delay</strong> on
          the other. Pick the option you would actually prefer.
        </p>
        <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
          <li>
            <kbd className="rounded border bg-muted px-1.5 py-0.5">←</kbd> left,{" "}
            <kbd className="rounded border bg-muted px-1.5 py-0.5">→</kbd> right — follow the screen, not a fixed
            side.
          </li>
          <li>There are no “correct” answers; take a moment so choices reflect what you mean.</li>
          <li>The task adapts the “now” amount and usually runs 12–30 choice trials, stopping early when your
            choices are stable and consistent.</li>
        </ul>
        <Button onClick={onStart} variant="outline" size="lg">
          Start
        </Button>
      </div>
    </div>
  );
}
