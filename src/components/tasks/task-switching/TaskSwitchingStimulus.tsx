type Props = { stimulus: string | null; task: "letter" | "number" };

export function TaskSwitchingStimulus({ stimulus, task }: Props) {
  if (!stimulus) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      <span className="text-6xl font-bold tabular-nums text-foreground sm:text-7xl">
        {stimulus}
      </span>
      <p className="text-sm text-muted-foreground">
        {task === "letter" ? "Vowel or consonant?" : "Even or odd?"}
      </p>
    </div>
  );
}
