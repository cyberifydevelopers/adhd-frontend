import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function SRTInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-6 rounded-xl border border-border bg-card p-8">
        <h2 className="text-xl font-semibold">Simple Reaction Time</h2>
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
          A colored figure will appear on screen. Press the <strong>space bar</strong> as quickly as
          possible when you see it.
        </p>
        <p className="text-sm text-muted-foreground">
          There will be a short practice block first, then the main task. Please avoid guessing when
          the stimulus will appear, wait until you see it.
        </p>
        <Button onClick={onStart} variant="outline" size="lg">
          {isReinstruction ? "Resume practice" : "Start practice"}
        </Button>
      </div>
    </div>
  );
}
