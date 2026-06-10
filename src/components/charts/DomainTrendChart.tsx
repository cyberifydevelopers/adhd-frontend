/**
 * Line/dot chart showing a single domain's z-score trend across sessions.
 * X-axis = sessions (chronological), Y-axis = z-score.
 */

type DataPoint = {
  session_id: string;
  created_at: string | null;
  z_score: number;
  weight: number;
};

type Props = {
  domain: string;
  label: string;
  points: DataPoint[];
};

const PAD_L = 40;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 30;
const CHART_W_MIN = 400;
const CHART_H = 140;

function formatShortDate(iso: string | null): string {
  if (!iso) return "?";
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "?";
  }
}

export function DomainTrendChart({ label, points }: Props) {
  // Chronological order (oldest first)
  const sorted = [...points].reverse();
  if (sorted.length < 2) return null;

  const chartW = Math.max(CHART_W_MIN, sorted.length * 44);
  const rawMin = Math.min(...sorted.map((p) => p.z_score), 0);
  const rawMax = Math.max(...sorted.map((p) => p.z_score), 3);
  const zMin = Math.floor((rawMin - 0.2) * 2) / 2;
  const zMax = Math.ceil((rawMax + 0.2) * 2) / 2;

  const totalH = PAD_T + CHART_H + PAD_B;
  const n = sorted.length;

  const totalWDynamic = PAD_L + chartW + PAD_R;
  const toX = (i: number) => PAD_L + (i / (n - 1)) * chartW;
  const toY = (z: number) => PAD_T + ((zMax - z) / (zMax - zMin || 1)) * CHART_H;

  // Zone boundary Y coordinates
  const y1 = toY(1.0);
  const y15 = toY(1.5);
  const yTop = toY(zMax);
  const yBot = toY(zMin);

  const pathD = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.z_score).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      <h5 className="mb-1 text-xs font-semibold text-foreground">{label}</h5>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Normal
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Mild Flag
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          Strong Flag
        </span>
      </div>
      <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <svg
          viewBox={`0 0 ${totalWDynamic} ${totalH}`}
          className="h-auto w-full"
          style={{ minWidth: totalWDynamic, maxHeight: totalH + 10 }}
          preserveAspectRatio="xMinYMin meet"
        >
        {/* Zone backgrounds */}
        <rect x={PAD_L} y={yTop} width={chartW} height={Math.max(0, y15 - yTop)} fill="hsl(0 84% 60% / 0.05)" />
        <rect x={PAD_L} y={Math.max(yTop, y15)} width={chartW} height={Math.max(0, y1 - y15)} fill="hsl(38 92% 50% / 0.06)" />
        <rect x={PAD_L} y={Math.max(yTop, y1)} width={chartW} height={Math.max(0, yBot - y1)} fill="hsl(142 76% 36% / 0.04)" />

        {/* Zone boundary lines */}
        {y1 >= yTop && y1 <= yBot && (
          <line x1={PAD_L} y1={y1} x2={PAD_L + chartW} y2={y1} stroke="hsl(38 92% 50% / 0.3)" strokeWidth="1" strokeDasharray="4" />
        )}
        {y15 >= yTop && y15 <= yBot && (
          <line x1={PAD_L} y1={y15} x2={PAD_L + chartW} y2={y15} stroke="hsl(0 84% 60% / 0.3)" strokeWidth="1" strokeDasharray="4" />
        )}
        {/* Zone labels */}
        {y1 >= yTop && y1 <= yBot && (
          <text x={PAD_L + 4} y={y1 + 12} className="text-[8px] fill-emerald-600">Normal</text>
        )}
        {y15 >= yTop && y15 <= yBot && (
          <text x={PAD_L + 4} y={y15 + 12} className="text-[8px] fill-amber-600">Mild Flag</text>
        )}
        <text x={PAD_L + 4} y={Math.min(yTop + 12, yBot - 2)} className="text-[8px] fill-rose-600">Strong Flag</text>

        {/* Y-axis labels */}
        {[zMin, (zMin + zMax) / 2, zMax].map((z) => (
          <text key={z} x={PAD_L - 6} y={toY(z) + 3} textAnchor="end" className="text-[8px] fill-muted-foreground">
            {Number.isInteger(z) ? z : z.toFixed(1)}
          </text>
        ))}
        <text x={6} y={PAD_T + CHART_H / 2} textAnchor="middle" dominantBaseline="middle" transform={`rotate(-90, 6, ${PAD_T + CHART_H / 2})`} className="text-[9px] fill-muted-foreground">
          z-score
        </text>

        {/* Line */}
        <path d={pathD} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />

        {/* Data points */}
        {sorted.map((p, i) => {
          const cx = toX(i);
          const cy = toY(p.z_score);
          const fill =
            p.z_score < 1 ? "hsl(142 76% 36%)" :
            p.z_score < 1.5 ? "hsl(38 92% 50%)" :
            "hsl(0 84% 60%)";
          return (
            <g key={p.session_id}>
              <circle cx={cx} cy={cy} r={5} fill={fill} stroke="white" strokeWidth="1.5" />
              <text x={cx} y={PAD_T + CHART_H + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">
                {formatShortDate(p.created_at)}
              </text>
            </g>
          );
        })}

        {/* Axes */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + CHART_H} stroke="var(--border)" strokeWidth="1" />
        <line x1={PAD_L} y1={PAD_T + CHART_H} x2={PAD_L + chartW} y2={PAD_T + CHART_H} stroke="var(--border)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
