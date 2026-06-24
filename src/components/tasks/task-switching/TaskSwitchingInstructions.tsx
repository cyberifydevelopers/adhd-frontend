import { Button } from "@/components/ui/Button";
import type { PracticeReinstructionLevel } from "@/lib/practiceEngine";

type Props = {
  onStart: () => void;
  isReinstruction?: boolean;
  reinstructionLevel?: PracticeReinstructionLevel;
  reinstructionHint?: string;
};

export function TaskSwitchingInstructions({ onStart, isReinstruction, reinstructionLevel, reinstructionHint }: Props) {
  const isAdditional = isReinstruction && reinstructionLevel === "additional";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-6 rounded-xl border border-border bg-card p-8">
        <h2 className="text-xl font-semibold">Task Switching</h2>
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
              You will see either a <strong>letter</strong> or a <strong>number</strong>. The task
              alternates every two trials.
            </p>
            <div className="space-y-2 text-sm">
              <p className="font-medium text-foreground">Letter trials (vowel or consonant):</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Press <kbd className="rounded border bg-muted px-1 py-0.5">←</kbd> for vowels: A, E</li>
                <li>Press <kbd className="rounded border bg-muted px-1 py-0.5">→</kbd> for consonants: G, K</li>
              </ul>
              <p className="mt-3 font-medium text-foreground">Number trials (even or odd):</p>
              <ul className="list-inside list-disc text-muted-foreground">
                <li>Press <kbd className="rounded border bg-muted px-1 py-0.5">←</kbd> for even: 2, 4</li>
                <li>Press <kbd className="rounded border bg-muted px-1 py-0.5">→</kbd> for odd: 3, 5</li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              Pay attention to the task — it switches every two trials. Respond as quickly and accurately
              as you can.
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
