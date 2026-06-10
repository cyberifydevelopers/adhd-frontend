import type { DelayTrial } from "@/stores/delayDiscountingStore";

type Props = { trial: DelayTrial };

export function DelayDiscountingChoice({ trial }: Props) {
  const leftOption =
    trial.immediateOnLeft
      ? { amount: trial.immediateAmount, when: "Now" }
      : { amount: trial.delayedAmount, when: `In ${trial.delayDays} days` };
  const rightOption =
    trial.immediateOnLeft
      ? { amount: trial.delayedAmount, when: `In ${trial.delayDays} days` }
      : { amount: trial.immediateAmount, when: "Now" };

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-8">
      <p className="text-muted-foreground">Which would you prefer?</p>
      <div className="grid w-full max-w-lg grid-cols-2 gap-6">
        <div className="rounded-xl border-2 border-border bg-muted/30 p-6 transition-colors hover:border-primary/50">
          <p className="text-2xl font-bold text-foreground">${leftOption.amount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{leftOption.when}</p>
          <p className="mt-2 text-xs text-muted-foreground">Press ←</p>
        </div>
        <div className="rounded-xl border-2 border-border bg-muted/30 p-6 transition-colors hover:border-primary/50">
          <p className="text-2xl font-bold text-foreground">${rightOption.amount}</p>
          <p className="mt-1 text-sm text-muted-foreground">{rightOption.when}</p>
          <p className="mt-2 text-xs text-muted-foreground">Press →</p>
        </div>
      </div>
    </div>
  );
}
