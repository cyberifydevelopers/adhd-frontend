import { useEffect, useState } from "react";

type FeedbackType = "correct" | "incorrect" | "premature" | "omission" | null;

type PracticeFeedbackProps = {
  feedbackType: FeedbackType;
  correctAnswer?: string | null;
  feedbackKey?: number;
};

const FEEDBACK_DISPLAY_MS = 1400;

const feedbackConfig: Record<
  Exclude<FeedbackType, null>,
  { color: string }
> = {
  correct: { color: "text-green-500" },
  incorrect: { color: "text-orange-500" },
  premature: { color: "text-yellow-500" },
  omission: { color: "text-muted-foreground" },
};

function formatCorrectAnswer(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (value === " ") return "Space";
  if (value === "ArrowLeft") return "Left Arrow";
  if (value === "ArrowRight") return "Right Arrow";
  if (value === "ArrowUp") return "Up Arrow";
  if (value === "ArrowDown") return "Down Arrow";
  return value;
}

export function PracticeFeedback({ feedbackType, correctAnswer, feedbackKey }: PracticeFeedbackProps) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<Exclude<FeedbackType, null> | null>(null);

  useEffect(() => {
    if (!feedbackType) {
      setVisible(false);
      return;
    }
    setCurrent(feedbackType);
    setVisible(true);
    const id = setTimeout(() => setVisible(false), FEEDBACK_DISPLAY_MS);
    return () => clearTimeout(id);
  }, [feedbackType, feedbackKey]);

  if (!visible || !current) return null;

  const cfg = feedbackConfig[current];
  const formattedAnswer = formatCorrectAnswer(correctAnswer);
  const label = current === "incorrect"
    ? `Not quite, correct answer was "${formattedAnswer ?? "the expected response"}"`
    : current === "correct"
      ? "Correct"
      : current === "premature"
        ? "False — wait for the stimulus"
        : `Not quite, too slow — correct answer was "${formattedAnswer ?? "the expected response"}"`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex items-end justify-center px-4">
      <span
        className={`rounded-md bg-background/90 px-3 py-2 text-lg font-semibold shadow-sm ${cfg.color} animate-fade-in`}
      >
        {label}
      </span>
    </div>
  );
}
