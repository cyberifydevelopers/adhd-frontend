import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function CPTInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">Continuous Performance Test (CPT)</h2>
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
        <p className="text-muted-foreground">
          Press the <kbd className="rounded border bg-muted px-1.5 py-0.5">Space</kbd> key only when you see the letter{" "}
          <strong>X</strong>. Do not press for any other letter.
        </p>
        <p className="text-sm text-muted-foreground">
          You will do a short practice first, then the main task. Stay focused and respond as quickly and accurately as
          you can.
        </p>
        <Button onClick={onStart} variant="outline" size="lg">
          {isReinstruction ? "Resume practice" : "Start practice"}
        </Button>
      </div>
    </div>
  );
}
