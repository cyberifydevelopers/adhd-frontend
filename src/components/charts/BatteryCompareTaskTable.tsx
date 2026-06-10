/**
 * Test-by-test comparison: one table with every test that appears in either battery.
 */

import { useMemo } from "react";
import { batteryScorePoints, batteryScoreScaleMax } from "./BatteryCompositionChart";
import type { BatteryTaskCompareRow } from "@/utils/batteryCompareTaskRows";

/** When assignment share implies a multi-point band (floor % ≥ 2), show e.g. 6/7; else fallback to %. */
function batteryResultCell(pct: number | null, weightPct: number | null): string {
  const pctOk = pct != null && !Number.isNaN(pct);
  if (weightPct != null && !Number.isNaN(weightPct) && weightPct > 0) {
    const max = batteryScoreScaleMax(weightPct);
    if (max >= 2) {
      if (!pctOk) return `—/${max}`;
      const { score } = batteryScorePoints(weightPct, pct);
      return `${score}/${max}`;
    }
  }
  if (!pctOk) return "—";
  return `${Math.round(pct * 10) / 10}%`;
}

type Props = {
  rows: BatteryTaskCompareRow[];
  batteryLabel1: string;
  batteryLabel2: string;
  /** Omit the long explanatory blurb above the table. */
  hideIntro?: boolean;
};

export function BatteryCompareTaskPercentTable({
  rows,
  batteryLabel1,
  batteryLabel2,
  hideIntro,
}: Props) {
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [rows],
  );

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
        No scored tests were returned for these batteries yet.
      </p>
    );
  }

  return (
    <div className={hideIntro ? "space-y-0" : "space-y-4"}>
      {!hideIntro && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Rows follow your clinician&apos;s assignment list on each battery. Metrics are pulled from the{" "}
          <span className="font-medium text-foreground">newest session on that battery that contains each test</span>{" "}
          (matching the Battery weights strip), merged with each compare run&apos;s scored report where available. With
          enough weight on a test, you see{" "}
          <span className="font-medium text-foreground">points out of max</span>; otherwise a % estimate when we can
          derive it. Sorted A–Z.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Test</th>
              <th className="px-3 py-2.5 font-medium tabular-nums">{batteryLabel1}</th>
              <th className="px-3 py-2.5 font-medium tabular-nums">{batteryLabel2}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.key} className="border-b border-border/35 last:border-0">
                <td className="px-3 py-2 font-medium text-foreground">{row.displayName}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {batteryResultCell(row.pct1, row.weightPct1)}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {batteryResultCell(row.pct2, row.weightPct2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
