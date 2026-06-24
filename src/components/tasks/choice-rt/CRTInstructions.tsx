import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function CRTInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  const isAdditional = isReinstruction && reinstructionLevel === "additional";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-6 rounded-xl border border-border bg-card p-8">
        <h2 className="text-xl font-semibold">Choice Reaction Time</h2>
        {isReinstruction && (
          <p className="text-sm text-amber-600">
            {reinstructionLevel === "simplified"
              ? "Let’s simplify the rule, then try again."
              : "Here’s an extra tip before continuing."}
          </p>
        )}
        {isReinstruction && reinstructionHint && (
          <p className="text-sm text-muted-foreground">{reinstructionHint}</p>
        )}
        {!isAdditional && (
          <>
            <p className="text-muted-foreground">
              An arrow will appear pointing <strong>up</strong>, <strong>down</strong>,{" "}
              <strong>left</strong>, or <strong>right</strong>. Press the corresponding arrow key (
              <kbd className="rounded border bg-muted px-1.5 py-0.5">←</kbd>{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">→</kbd>{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">↑</kbd>{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">↓</kbd>) as quickly and accurately
              as possible.
            </p>
            <p className="text-sm text-muted-foreground">
              Practice and the main task use the same four directions (up, down, left, right). Respond only when the
              arrow appears.
            </p>
            <p className="text-sm text-muted-foreground">
              There will be a short practice block first. Please respond only when you see the arrow.
            </p>
          </>
        )}
        <Button onClick={onStart} variant="outline" size="lg">
          {isReinstruction ? "Resume practice" : "Start practice"}
        </Button>
      </div>
    </div>
  );
}
