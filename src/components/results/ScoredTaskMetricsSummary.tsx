import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardList } from "lucide-react";

function formatMetricValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    if (abs >= 1000) return (Math.round(v * 10) / 10).toString();
    if (abs >= 10) return (Math.round(v * 100) / 100).toString();
    if (abs >= 1) return (Math.round(v * 1000) / 1000).toString();
    return (Math.round(v * 1e6) / 1e6).toString();
  }
  if (v != null && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

type Props = { metrics: Record<string, unknown> };

/**
 * Collapsible table of saved score metrics (same chrome as {@link MainAdaptiveResultsSummary}).
 * Excludes `main_adaptive_debug` so that blob is not duplicated in the list.
 */
export function ScoredTaskMetricsSummary({ metrics }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const entries = useMemo(
    () =>
      Object.entries(metrics)
        .filter(([k, v]) => v != null && k !== "main_adaptive_debug")
        .sort(([a], [b]) => a.localeCompare(b)),
    [metrics],
  );

  if (entries.length === 0) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-primary/25 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 bg-primary/10 px-3 py-2 text-left text-xs font-semibold text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <ClipboardList className="h-3.5 w-3.5 shrink-0 text-primary" />
          Scored metrics (saved at score)
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {!collapsed && (
        <div className="max-h-[28rem] overflow-y-auto p-3 text-[11px] leading-snug text-foreground">
          <dl className="grid gap-1.5">
            {entries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border/30 pb-1.5 last:border-0 last:pb-0">
                <dt className="shrink-0 text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                <dd className="min-w-0 break-words text-right font-mono font-medium text-foreground">
                  {formatMetricValue(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
