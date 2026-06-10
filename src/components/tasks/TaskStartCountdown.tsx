type TaskStartCountdownProps = {
  secondsLeft: number;
  phaseLabel: "practice" | "main";
};

export function TaskStartCountdown({ secondsLeft, phaseLabel }: TaskStartCountdownProps) {
  const label = phaseLabel === "practice" ? "practice" : "main test";
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
      <p className="text-sm uppercase tracking-wide text-muted-foreground">
        Starting {label}
      </p>
      <p className="text-7xl font-bold text-foreground">{secondsLeft}</p>
      <p className="text-sm text-muted-foreground">Get ready...</p>
    </div>
  );
}
