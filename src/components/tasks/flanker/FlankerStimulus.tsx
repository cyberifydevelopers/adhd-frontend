import type { FlankerTrial } from "@/stores/flankerStore";

type Props = { trial: FlankerTrial | null; size?: "younger" | "standard" };

function Arrow({
  direction,
  size,
}: {
  direction: "left" | "right";
  size: "younger" | "standard";
}) {
  const symbol = direction === "left" ? "←" : "→";
  const cls =
    size === "younger"
      ? "inline-block text-6xl font-bold text-foreground sm:text-7xl"
      : "inline-block text-4xl font-bold text-foreground sm:text-5xl";
  return (
    <span className={cls} aria-hidden>
      {symbol}
    </span>
  );
}

export function FlankerStimulus({ trial, size = "standard" }: Props) {
  if (!trial) return null;

  const { congruence, centerDirection } = trial;
  const flankerDirection: "left" | "right" =
    congruence === "congruent" ? centerDirection : centerDirection === "left" ? "right" : "left";

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2">
      <Arrow direction={flankerDirection} size={size} />
      <Arrow direction={flankerDirection} size={size} />
      <Arrow direction={centerDirection} size={size} />
      <Arrow direction={flankerDirection} size={size} />
      <Arrow direction={flankerDirection} size={size} />
    </div>
  );
}
