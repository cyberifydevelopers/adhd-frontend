import type { PracticeEvent } from "@/lib/practiceEngine";
import type { CPTTrialScreen } from "@/stores/cptStore";

type Feedback = PracticeEvent["errorType"];

type Props = {
  letter: string | null;
  screen: CPTTrialScreen;
  /** Practice outcome shown on the feedback screen. */
  feedback?: Feedback | null;
};

// Commission ("incorrect") and anticipatory ("premature") presses share one message.
const FEEDBACK: Record<Feedback, { label: string; className: string }> = {
  correct: { label: "Correct", className: "text-green-500" },
  omission: { label: "Try responding a little faster.", className: "text-orange-500" },
  incorrect: { label: "Wait for X before pressing.", className: "text-orange-500" },
  premature: { label: "Wait for X before pressing.", className: "text-orange-500" },
};

export function CPTStimulus({ letter, screen, feedback }: Props) {
  const message = screen === "feedback" && feedback ? FEEDBACK[feedback] : null;
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center">
      {message ? (
        <p role="status" className={`text-center text-2xl font-semibold ${message.className}`}>
          {message.label}
        </p>
      ) : (
        <div className="text-6xl font-mono font-bold tracking-widest text-foreground">
          {screen === "stimulus" ? letter : screen === "fixation" ? "+" : null}
        </div>
      )}
    </div>
  );
}
