type Props = {
  letter: string | null;
};

export function CPTStimulus({ letter }: Props) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center">
      <div className="text-6xl font-mono font-bold tracking-widest text-foreground">
        {letter ?? "+"}
      </div>
    </div>
  );
}
