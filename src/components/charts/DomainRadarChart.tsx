type DomainPoint = {
  label: string;
  z_score: number | null;
  abnormality_probability?: number | null;
};

type Props = {
  domains: DomainPoint[];
  size?: number;
};


const Z_MAX = 3;

export function DomainRadarChart({ domains, size = 420 }: Props) {
  const filtered = domains.filter((d) => d.z_score != null) as (DomainPoint & { z_score: number })[];
  if (filtered.length < 3) return <p className="text-sm text-muted-foreground">Insufficient domains for radar</p>;

  const cx = size / 2;
  const cy = size / 2;
  // Extra margin keeps longer labels (e.g. "Impulse Control") visible.
  const r = size / 2 - 88;
  const n = filtered.length;
  const angleStep = (Math.PI * 2) / n;

  const toXY = (idx: number, radius: number) => ({
    x: cx + radius * Math.cos(idx * angleStep - Math.PI / 2),
    y: cy + radius * Math.sin(idx * angleStep - Math.PI / 2),
  });

  const rings = [0.33, 0.66, 1.0];
  const ringLabels = ["1", "2", "3"];

  const dataPoints = filtered.map((d, i) => {
    const val = Math.min(Math.abs(d.z_score), Z_MAX) / Z_MAX;
    return toXY(i, val * r);
  });
  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="flex flex-col items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="h-auto w-full max-w-[560px]"
        style={{ minWidth: size }}
        preserveAspectRatio="xMidYMid meet"
      >
        {rings.map((pct, ri) => {
          const ringR = pct * r;
          const pts = Array.from({ length: n }, (_, i) => toXY(i, ringR));
          return (
            <polygon
              key={ri}
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
              opacity={1}
            />
          );
        })}
        {Array.from({ length: n }, (_, i) => {
          const end = toXY(i, r);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="hsl(var(--foreground) / 0.32)"
              strokeWidth="1.2"
              opacity={0.65}
            />
          );
        })}
        <polygon
          points={polygon}
          fill="rgba(70, 56, 56, 0.5)"
          stroke="rgba(70, 56, 56, 0.5)"
          strokeWidth="3"
        />
        <polygon
          points={polygon}
          fill="none"
          stroke="rgba(0, 0, 0, 0.28)"
          strokeWidth="6"
          opacity={0.25}
        />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5} fill="rgba(0, 0, 0, 0.62)" />
        ))}
        {filtered.map((d, i) => {
          const labelPt = toXY(i, r + 40);
          const words = d.label.split(" ");
          const lines: string[] = [];
          if (words.length <= 2) {
            lines.push(d.label);
          } else {
            const mid = Math.ceil(words.length / 2);
            lines.push(words.slice(0, mid).join(" "));
            lines.push(words.slice(mid).join(" "));
          }
          return (
            <text
              key={i}
              x={labelPt.x}
              y={labelPt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-[11px] fill-foreground font-semibold"
            >
              {lines.map((line, li) => (
                <tspan key={li} x={labelPt.x} dy={li === 0 ? `-${(lines.length - 1) * 0.5}em` : "1.1em"}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}
        {rings.map((pct, ri) => {
          const rr = pct * r;
          return (
            <text
              key={ri}
              x={cx + 4}
              y={cy - rr - 2}
              className="text-[9px] fill-muted-foreground"
            >
              z={ringLabels[ri]}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
