type DomainChange = {
  domain: string;
  label: string;
  baseline_z: number | null;
  current_z: number | null;
  delta_z: number | null;
  delta_z_corrected?: number | null;
  practice_effect?: number | null;
  ci_low: number | null;
  ci_high: number | null;
};

type Props = {
  domains: DomainChange[];
  baselineDate?: string | null;
  currentDate?: string | null;
};

export function ChangeOverTimeChart({ domains, baselineDate, currentDate }: Props) {
  const hasCorrected = domains.some((d) => d.delta_z_corrected != null);
  const valid = domains
    .filter((d) => d.delta_z != null)
    .map((d) => ({
      ...d,
      displayDelta: (hasCorrected ? d.delta_z_corrected : d.delta_z) ?? d.delta_z!,
    }));
  if (valid.length === 0)
    return <p className="text-sm text-muted-foreground">No change data available</p>;

  const maxAbs = Math.max(
    ...valid.map((d) => Math.max(Math.abs(d.ci_low ?? d.displayDelta), Math.abs(d.ci_high ?? d.displayDelta))),
    1,
  );
  const scale = maxAbs * 1.2;

  const barH = 36;
  const gap = 12;
  const labelW = 190;
  const chartW = 420;
  const valueW = 96;
  const totalW = labelW + chartW + valueW;
  const totalH = valid.length * (barH + gap) + 36;
  const cx = labelW + chartW / 2;

  const toX = (z: number) => labelW + (z / scale + 0.5) * chartW;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>Baseline: {baselineDate ? new Date(baselineDate).toLocaleDateString() : "—"}</span>
        <span>Current: {currentDate ? new Date(currentDate).toLocaleDateString() : "—"}</span>
      </div>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          className="h-auto w-full"
          style={{ minWidth: totalW, maxHeight: totalH + 20 }}
          preserveAspectRatio="xMinYMin meet"
        >
        {/* Zero line */}
        <line
          x1={cx}
          y1={0}
          x2={cx}
          y2={totalH - 20}
          stroke="var(--border)"
          strokeWidth="1"
          strokeDasharray="4"
        />
        <text x={cx} y={totalH - 8} textAnchor="middle" className="text-[10px] fill-muted-foreground">
          Δz = 0
        </text>

        {valid.map((d, i) => {
          const y = i * (barH + gap) + barH / 2;
          const xDelta = toX(d.displayDelta);
          const xLow = d.ci_low != null ? toX(d.ci_low) : xDelta;
          const xHigh = d.ci_high != null ? toX(d.ci_high) : xDelta;
          const improved = d.displayDelta < 0;

          return (
            <g key={d.domain}>
              <text
                x={labelW - 6}
                y={y + 4}
                textAnchor="end"
                className="text-[12px] fill-foreground font-medium"
              >
                {d.label}
              </text>
              {/* CI error bar */}
              <line
                x1={xLow}
                y1={y}
                x2={xHigh}
                y2={y}
                stroke={improved ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
                strokeWidth="2"
              />
              <line x1={xLow} y1={y - 5} x2={xLow} y2={y + 5} stroke={improved ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} strokeWidth="1.5" />
              <line x1={xHigh} y1={y - 5} x2={xHigh} y2={y + 5} stroke={improved ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"} strokeWidth="1.5" />
              {/* Δz point */}
              <circle
                cx={xDelta}
                cy={y}
                r={5}
                fill={improved ? "hsl(142 76% 36%)" : "hsl(0 84% 60%)"}
              />
              <text
                x={labelW + chartW + 10}
                y={y + 4}
                className="text-[11px] fill-foreground font-medium"
              >
                {d.displayDelta > 0 ? "+" : ""}{d.displayDelta.toFixed(2)}
              </text>
            </g>
          );
        })}
        </svg>
      </div>
      <div className="flex justify-center gap-6 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Improved (Δz &lt; 0)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Worsened (Δz &gt; 0)
        </span>
      </div>
      {hasCorrected && (
        <p className="text-center text-[10px] text-muted-foreground/70">
          Values are practice-effect corrected (expected retest gains subtracted)
        </p>
      )}
    </div>
  );
}
