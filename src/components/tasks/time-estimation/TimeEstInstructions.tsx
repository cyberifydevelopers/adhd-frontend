import { Button } from "@/components/ui/Button";

type Props = { onStart: () => void };

export function TimeEstInstructions({ onStart }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">Time Estimation</h2>
        <p className="text-muted-foreground">
          Each practice round shows how long the target lasts, then you reproduce that length from memory
          without the on-screen bar.
        </p>
        <Button onClick={onStart} variant="outline" size="lg">
          Start
        </Button>
      </div>
    </div>
  );
}
