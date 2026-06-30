import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function FlankerInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  const isAdditional = isReinstruction && reinstructionLevel === "additional";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <h2 className="text-xl font-semibold">Flanker Task</h2>
        {isReinstruction && (
          <p className="text-sm text-amber-600">
            {reinstructionLevel === "simplified"
              ? "Let’s simplify the instructions, then try again."
              : "Here’s an extra tip before continuing."}
          </p>
        )}
        {isReinstruction && reinstructionHint && (
          <p className="text-sm text-muted-foreground">{reinstructionHint}</p>
        )}
        {!isAdditional && (
          <>
            <p className="text-muted-foreground">
              A row of arrows will appear. <strong>Respond to the direction of the center arrow only.</strong>{" "}
              Ignore the arrows on the sides.
            </p>
            <p className="text-sm text-muted-foreground">
              Press <kbd className="rounded border bg-muted px-1.5 py-0.5">←</kbd> when the center arrow points left,{" "}
              and <kbd className="rounded border bg-muted px-1.5 py-0.5">→</kbd> when it points right.
            </p>
            <p className="text-sm text-muted-foreground">
              Sometimes all arrows point the same way (congruent). Sometimes the center arrow points the opposite
              direction (incongruent). Always respond based on the center arrow.
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
