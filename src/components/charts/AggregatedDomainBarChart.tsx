/**
 * Horizontal bar chart for aggregated domain z-scores.
 * Shows severity zones (normal/mild/strong) and per-domain bars.
 */

type DomainBar = {
  label: string;
  domain_z_score: number | null;
  signal: "normal" | "mild_flag" | "strong_flag";
  session_count: number;
};

type Props = {
  domains: DomainBar[];
};

const Z_MAX = 3;
const BAR_H = 32;
const GAP = 6;
const LABEL_W = 140;
const CHART_W = 320;
const RIGHT_PAD = 50;

const SIGNAL_FILL: Record<string, string> = {
  normal: "hsl(142 76% 36%)",
  mild_flag: "hsl(38 92% 50%)",
  strong_flag: "hsl(0 84% 60%)",
};

export function AggregatedDomainBarChart({ domains }: Props) {
  const valid = domains.filter((d) => d.domain_z_score != null);
  if (valid.length === 0) return <p className="text-sm text-muted-foreground">No domain data</p>;

  const totalH = valid.length * (BAR_H + GAP) + 40;
  const totalW = LABEL_W + CHART_W + RIGHT_PAD;

  const toX = (z: number) => LABEL_W + (Math.min(Math.abs(z), Z_MAX) / Z_MAX) * CHART_W;

  // Zone boundaries
  const zone1X = LABEL_W + (1.0 / Z_MAX) * CHART_W; // z=1
  const zone2X = LABEL_W + (1.5 / Z_MAX) * CHART_W; // z=1.5
  const zoneEndX = LABEL_W + CHART_W;
  const bodyH = valid.length * (BAR_H + GAP);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <svg
          viewBox={`0 0 ${totalW} ${totalH}`}
          className="h-auto w-full"
          style={{ minWidth: totalW, maxHeight: totalH + 12 }}
          preserveAspectRatio="xMinYMin meet"
        >
        {/* Severity zone backgrounds */}
        <rect x={LABEL_W} y={0} width={zone1X - LABEL_W} height={bodyH} fill="hsl(142 76% 36% / 0.06)" />
        <rect x={zone1X} y={0} width={zone2X - zone1X} height={bodyH} fill="hsl(38 92% 50% / 0.08)" />
        <rect x={zone2X} y={0} width={zoneEndX - zone2X} height={bodyH} fill="hsl(0 84% 60% / 0.06)" />

        {/* Zone boundary lines */}
        <line x1={zone1X} y1={0} x2={zone1X} y2={bodyH} stroke="hsl(38 92% 50% / 0.3)" strokeWidth="1" strokeDasharray="4" />
        <line x1={zone2X} y1={0} x2={zone2X} y2={bodyH} stroke="hsl(0 84% 60% / 0.3)" strokeWidth="1" strokeDasharray="4" />
        {/* Zero line */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={bodyH} stroke="var(--border)" strokeWidth="1" />

        {/* Zone labels */}
        <text x={(LABEL_W + zone1X) / 2} y={bodyH + 14} textAnchor="middle" className="text-[9px] fill-muted-foreground">Normal</text>
        <text x={(zone1X + zone2X) / 2} y={bodyH + 14} textAnchor="middle" className="text-[9px] fill-amber-600">Mild</text>
        <text x={(zone2X + zoneEndX) / 2} y={bodyH + 14} textAnchor="middle" className="text-[9px] fill-rose-500">Strong</text>

        {/* Z axis labels */}
        <text x={LABEL_W} y={bodyH + 28} textAnchor="middle" className="text-[8px] fill-muted-foreground">z=0</text>
        <text x={zone1X} y={bodyH + 28} textAnchor="middle" className="text-[8px] fill-muted-foreground">1.0</text>
        <text x={zone2X} y={bodyH + 28} textAnchor="middle" className="text-[8px] fill-muted-foreground">1.5</text>
        <text x={zoneEndX} y={bodyH + 28} textAnchor="middle" className="text-[8px] fill-muted-foreground">3.0</text>

        {valid.map((d, i) => {
          const y = i * (BAR_H + GAP);
          const z = Math.abs(d.domain_z_score!);
          const barW = toX(z) - LABEL_W;
          const fill = SIGNAL_FILL[d.signal] ?? SIGNAL_FILL.normal;

          return (
            <g key={d.label}>
              {/* Label */}
              <text x={LABEL_W - 8} y={y + BAR_H / 2 + 4} textAnchor="end" className="text-[11px] fill-foreground font-medium">
                {d.label}
              </text>
              {/* Bar */}
              <rect x={LABEL_W} y={y + 4} width={Math.max(barW, 2)} height={BAR_H - 8} rx={4} fill={fill} opacity={0.8} />
              {/* Value label */}
              <text x={LABEL_W + barW + 6} y={y + BAR_H / 2 + 4} className="text-[10px] fill-muted-foreground">
                z={d.domain_z_score!.toFixed(2)} ({d.session_count}s)
              </text>
            </g>
          );
        })}
        </svg>
      </div>
      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> Normal (z &lt; 1.0)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Mild (1.0–1.5)</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> Strong (&gt; 1.5)</span>
      </div>
    </div>
  );
}
