import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function SSTInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  const isAdditional = isReinstruction && reinstructionLevel === "additional";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">Stop-Signal Task (SST)</h2>
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
              You will see arrows pointing left or right. Press <kbd className="rounded border bg-muted px-1.5 py-0.5">←</kbd> for left or{" "}
              <kbd className="rounded border bg-muted px-1.5 py-0.5">→</kbd> for right as quickly as you can.
            </p>
            <p className="text-muted-foreground">
              Sometimes the arrow will turn into a stop signal. When that happens, <strong>do not press any key</strong>.
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
