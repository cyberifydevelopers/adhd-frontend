import { useMemo } from "react";
const STIMULUS_COLORS = [
  "bg-emerald-500 ring-emerald-400/50",
  "bg-blue-500 ring-blue-400/50",
  "bg-amber-500 ring-amber-400/50",
  "bg-rose-500 ring-rose-400/50",
  "bg-violet-500 ring-violet-400/50",
  "bg-cyan-500 ring-cyan-400/50",
  "bg-orange-500 ring-orange-400/50",
  "bg-fuchsia-500 ring-fuchsia-400/50",
] as const;

const STIMULUS_SHAPES = [
  { className: "rounded-full", label: "circle" },
  { className: "rounded-none", label: "square" },
  { className: "rotate-45 rounded-none", label: "diamond" },
  { className: "rounded-lg", label: "rounded-square" },
  { className: "rounded-3xl", label: "squircle" },
] as const;

type Props = {
  status: "waiting" | "stimulus" | "feedback";
  /** Version key so the random stimulus reshapes when advancing trials */
  stimulusKey: number;
  /** Practice-only feedback shown during the "feedback" screen; blank for main/extension. */
  feedback?: { label: string; className: string } | null;
};

export function SRTTrial({ status, stimulusKey, feedback }: Props) {
  const { colorClasses, shapeClasses } = useMemo(() => ({
    colorClasses: STIMULUS_COLORS[Math.floor(Math.random() * STIMULUS_COLORS.length)],
    shapeClasses: STIMULUS_SHAPES[Math.floor(Math.random() * STIMULUS_SHAPES.length)].className,
  }), [stimulusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center">
      {status === "waiting" && (
        <div className="text-7xl font-bold text-foreground" aria-hidden>+</div>
      )}
      {status === "stimulus" && (
        <div
          className={`h-24 w-24 shadow-lg ring-4 ${colorClasses} ${shapeClasses}`}
          aria-hidden
        />
      )}
      {status === "feedback" && feedback && (
        <p className={`text-2xl font-semibold ${feedback.className}`}>{feedback.label}</p>
      )}
    </div>
  );
}
