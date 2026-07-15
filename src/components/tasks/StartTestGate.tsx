import { Button } from "@/components/ui/Button";

type Props = {
  onStart: () => void;
  isRetry?: boolean;
};

/** Manual gate shown after practice passes and before the main/scored test begins. */
export function StartTestGate({ onStart, isRetry }: Props) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <h2 className="text-xl font-semibold">
          {isRetry ? "Let's try the main test again" : "Practice complete"}
        </h2>
        <p className="text-muted-foreground">
          {isRetry
            ? "That attempt didn't record any correct responses, so it hasn't been scored. Let's give the main test another try."
            : "You're ready to begin the main test. Take a moment if you need it, then start when you're ready."}
        </p>
        <Button onClick={onStart} variant="outline" size="lg">
          Start test
        </Button>
      </div>
    </div>
  );
}
