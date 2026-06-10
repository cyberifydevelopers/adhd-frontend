/**
 * Per-battery view: each battery totals 100%, split by assigned test weights.
 */
import { useMemo } from "react";
import { getTaskDisplayName } from "@/config/tasks";

export type BatteryItemPerformance = {
  mean_z: number | null;
  /** 0–100 trial attainment (higher=better); backend reads from stored metrics when possible */
  performance_percent?: number | null;
  severity_index?: number | null;
  severity_band: string;
  signal: string;
  session_date: string | null;
  summary?: string;
};

export type BatteryCompositionItem = {
  test_name: string;
  weight: number;
  weight_percent: number;
  performance?: BatteryItemPerformance | null;
};

export type BatteryCompositionGroup = {
  battery_id: string;
  battery_title: string;
  battery_status?: string;
  items: BatteryCompositionItem[];
};

type Props = {
  batteries: BatteryCompositionGroup[];
  /** When set (e.g. report battery weights strip), fills bar + legend from this palette in order (cycles past end). */
  segmentColors?: string[];
};

const SEGMENT_HUES = [210, 155, 280, 35, 190, 330, 125, 25];

function normalizeHexColor(hex: string): string {
  const t = hex.trim();
  return t.startsWith("#") ? t : `#${t}`;
}

/** Top of scale = floor(assigned %); e.g. 7% or 7.7% → 1..7 */
export function batteryScoreScaleMax(weightPercent: number): number {
  const n = Math.floor(weightPercent);
  return n >= 1 ? n : 1;
}

/** Map attainment 0–100 onto discrete 1..max (max from assignment %) */
export function batteryScorePoints(
  weightPercent: number,
  performancePercent: number,
): { score: number; max: number } {
  const max = batteryScoreScaleMax(weightPercent);
  const t = Math.max(0, Math.min(100, performancePercent)) / 100;
  const raw = 1 + t * (max - 1);
  const score = Math.min(max, Math.max(1, Math.round(raw)));
  return { score, max };
}

type ItemWithDisplay = BatteryCompositionItem & { display_pct: number };

function attainmentFractionLine(it: ItemWithDisplay): string {
  const max = batteryScoreScaleMax(it.weight_percent);
  const p = it.performance?.performance_percent;
  if (p != null && !Number.isNaN(p)) {
    const { score } = batteryScorePoints(it.weight_percent, p);
    return `${score}/${max}`;
  }
  return `—/${max}`;
}

function buildBatteryTooltipTitle(it: ItemWithDisplay, label: string): string {
  const lines: string[] = [label];
  lines.push(`${it.weight_percent.toFixed(1)}% of this battery`);
  if (Math.abs(it.display_pct - it.weight_percent) >= 0.05) {
    lines.push(`Bar segment: ${it.display_pct.toFixed(1)}%`);
  }
  lines.push(`Attainment: ${attainmentFractionLine(it)}`);
  return lines.join("\n");
}

function buildHoverAria(it: ItemWithDisplay, label: string): string {
  return buildBatteryTooltipTitle(it, label);
}

function PerformanceHover({
  it,
  label,
  id,
  placement = "below",
}: {
  it: ItemWithDisplay;
  label: string;
  id: string;
  placement?: "above" | "below";
}) {
  const max = batteryScoreScaleMax(it.weight_percent);
  const p = it.performance?.performance_percent;
  const scaled = p != null && !Number.isNaN(p) ? batteryScorePoints(it.weight_percent, p) : null;

  const position =
    placement === "above"
      ? "bottom-full left-0 z-[200] mb-1.5 sm:left-1/2 sm:-translate-x-1/2"
      : "top-full left-1/2 z-[200] mt-1.5 -translate-x-1/2";

  return (
    <span
      id={id}
      className={`pointer-events-none absolute ${position} hidden w-max max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-border bg-popover px-3 py-2 text-left text-popover-foreground shadow-lg group-hover:block group-focus-within:block`}
      role="tooltip"
    >
      <span className="block text-xs font-semibold text-foreground">{label}</span>
      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
        <span className="font-medium text-foreground">{it.weight_percent.toFixed(1)}%</span> of this battery
        {Math.abs(it.display_pct - it.weight_percent) >= 0.05 ? (
          <>
            {" "}
            · bar <span className="font-medium text-foreground">{it.display_pct.toFixed(1)}%</span>
          </>
        ) : null}
      </span>
      <span className="mt-2 block border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        Attainment{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {scaled ? `${scaled.score}/${scaled.max}` : `—/${max}`}
        </span>
      </span>
    </span>
  );
}

export function BatteryCompositionChart({ batteries, segmentColors }: Props) {
  const palette = useMemo(
    () => (segmentColors?.length ? segmentColors.map(normalizeHexColor) : null),
    [segmentColors],
  );

  const normalized = useMemo(() => {
    return batteries.map((b) => {
      const sum = b.items.reduce((s, it) => s + it.weight_percent, 0) || 1;
      return {
        ...b,
        items: b.items.map((it) => ({
          ...it,
          display_pct: sum > 0 ? (it.weight_percent / sum) * 100 : 0,
        })),
      };
    });
  }, [batteries]);

  if (normalized.length === 0) return null;

  return (
    <div className="space-y-3">
      {normalized.map((b) => {
        const nTests = b.items.length;
        const nScored = b.items.filter((it) => it.performance != null).length;
        return (
        <div key={b.battery_id} className="overflow-visible rounded-lg border border-border/60 bg-muted/15 p-3 sm:p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">
              {b.battery_title || "Battery"}
              {nTests > 0 ? (
                <span className="ml-2 font-medium tabular-nums text-muted-foreground">
                  {nScored}/{nTests}
                </span>
              ) : null}
            </span>
            <span className="text-xs font-medium tabular-nums text-primary">100%</span>
          </div>
          <div className="mb-3 w-full min-w-0 overflow-visible">
            <div className="flex min-h-10 w-full rounded-lg border border-border/50 shadow-inner">
              {b.items.map((it, i) => {
                const hue = SEGMENT_HUES[i % SEGMENT_HUES.length];
                const fill = palette?.[i % palette.length] ?? `hsl(${hue} 55% 42% / 0.9)`;
                const label = getTaskDisplayName(it.test_name);
                const tipId = `bc-tip-${b.battery_id}-${i}`;
                const n = b.items.length;
                const corner =
                  n <= 1 ? "rounded-lg" : i === 0 ? "rounded-l-lg" : i === n - 1 ? "rounded-r-lg" : "";
                const tip = buildHoverAria(it, label);
                return (
                  <div
                    key={`${b.battery_id}-${it.test_name}-${i}`}
                    className={`group relative z-0 flex min-h-10 min-w-[4px] flex-shrink-0 cursor-help flex-col justify-end border-r border-white/20 pb-12 transition-[flex-grow] last:border-r-0 hover:z-[100] focus-within:z-[100] focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background`}
                    style={{
                      flexGrow: Math.max(it.display_pct, 0.5),
                      flexBasis: 0,
                    }}
                    tabIndex={0}
                    aria-label={tip}
                    title={tip}
                  >
                    <div className={`min-h-10 w-full ${corner}`} style={{ background: fill }} />
                    <PerformanceHover it={it} label={label} id={tipId} placement="below" />
                  </div>
                );
              })}
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-1.5 overflow-visible text-xs sm:grid-cols-2">
            {b.items.map((it, i) => {
              const hue = SEGMENT_HUES[i % SEGMENT_HUES.length];
              const swatch = palette?.[i % palette.length] ?? `hsl(${hue} 55% 42%)`;
              const label = getTaskDisplayName(it.test_name);
              const tipId = `bc-leg-${b.battery_id}-${i}`;
              const tip = buildHoverAria(it, label);
              return (
                <li
                  key={`${b.battery_id}-${it.test_name}-legend-${i}`}
                  className="group relative z-0 flex cursor-help items-center justify-between gap-2 overflow-visible rounded-md border border-border/40 bg-card/80 px-2 py-1.5 hover:z-[100] focus-within:z-[100]"
                  tabIndex={0}
                  aria-label={tip}
                  title={tip}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border/30"
                      style={{ background: swatch }}
                      aria-hidden
                    />
                    <span className="truncate text-foreground">{label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-muted-foreground">
                    {it.weight_percent.toFixed(1)}%
                  </span>
                  <PerformanceHover it={it} label={label} id={tipId} placement="above" />
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </div>
  );
}
