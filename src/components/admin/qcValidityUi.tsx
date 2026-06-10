import { FileText, Loader2, ShieldCheck } from "lucide-react";
import { getTaskDisplayName } from "@/config/tasks";
import { Button } from "@/components/ui/Button";
import type { ValidityPointBreakdown } from "@/services/adminSessionsService";

export type QcDisplayData = {
  validity_score: number;
  overall_confidence_score?: number | null;
  validity_classification?: string | null;
  confidence_tier?: string | null;
  practice_passed?: boolean | null;
  low_confidence_flag?: boolean | null;
  technical_issue_flag?: boolean | null;
  assessment_interpretable?: boolean | null;
  cross_test_flags?: string[] | null;
  task_confidence_score?: Record<string, number> | null;
  task_validity_flags?: Record<string, string[]> | null;
  generated_at?: string | null;
  flags: {
    confidence_tier?: string;
    validity_point_breakdown?: ValidityPointBreakdown;
    rt_rounding?: { flagged: boolean };
    anticipatory_rt_count?: number;
    random_responding?: { flagged: boolean; sd_rt?: number };
    isi_check?: { flagged: boolean; n?: number; out_of_range?: number };
    disengagement?: { omission_run_detected?: boolean; post_error_slowing?: boolean };
  };
};

export function qcScoreColor(score: number): string {
  if (score >= 75) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  if (score >= 40) return "text-orange-600";
  return "text-rose-600";
}

export function formatConfidenceTier(tier: string | null | undefined): string {
  const labels: Record<string, string> = {
    excellent_confidence: "Excellent Confidence (90–100)",
    good_confidence: "Good Confidence (75–89)",
    questionable_confidence: "Questionable Confidence (60–74)",
    low_confidence: "Low Confidence (40–59)",
    invalid_do_not_interpret: "Invalid / Do Not Interpret (<40)",
  };
  return labels[tier ?? ""] ?? (tier ? tier.replace(/_/g, " ") : "—");
}

export function formatValidityClassification(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    valid: "Valid",
    borderline_valid: "Borderline Valid",
    low_confidence: "Low Confidence",
    invalid: "Invalid",
  };
  return labels[value ?? ""] ?? (value ? value.replace(/_/g, " ") : "—");
}

export function ValidityBoolBadge({ label, value }: { label: string; value: boolean | null | undefined }) {
  if (value == null) return null;
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
        value
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
          : "border-rose-500/40 bg-rose-500/10 text-rose-700"
      }`}
    >
      {label}: {value ? "Yes" : "No"}
    </span>
  );
}

export function PointBreakdownTable({ breakdown }: { breakdown: ValidityPointBreakdown }) {
  const rows = [
    ["Anticipatory (>5%)", breakdown.anticipatory],
    ["Omissions", breakdown.omissions],
    ["Side bias", breakdown.side_bias],
    ["Random responding", breakdown.random_responding],
    ["Practice not passed", breakdown.practice_not_passed],
    ["Device timing", breakdown.device_timing],
    ["Unstable at max trials", breakdown.unstable_at_max],
    ["Cross-test inconsistency", breakdown.cross_test_inconsistency],
  ] as const;

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Indicator</th>
            <th className="px-3 py-2 font-medium text-right">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, pts]) => (
            <tr key={label} className="border-t border-border/40">
              <td className="px-3 py-1.5">{label}</td>
              <td className={`px-3 py-1.5 text-right font-medium ${pts ? "text-amber-700" : "text-muted-foreground"}`}>
                {pts ?? 0}
              </td>
            </tr>
          ))}
          <tr className="border-t border-border/60 bg-muted/20 font-semibold">
            <td className="px-3 py-2">Total validity points</td>
            <td className="px-3 py-2 text-right">{breakdown.total_points ?? 0}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

type QcValidityDisplayProps = {
  qc: QcDisplayData;
  scopeLabel?: string;
  showLegacyFlags?: boolean;
};

export function QcValidityDisplay({ qc, scopeLabel = "Overall", showLegacyFlags = true }: QcValidityDisplayProps) {
  const score = qc.overall_confidence_score ?? qc.validity_score;
  const tier = qc.confidence_tier ?? qc.flags?.confidence_tier;
  const pointBreakdown = qc.flags?.validity_point_breakdown;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{scopeLabel} confidence</p>
        <p className={`mt-1 text-2xl font-bold ${qcScoreColor(score)}`}>{score}/100</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Score = 100 − (validity points × 5).{" "}
          {qc.generated_at ? `Saved ${new Date(qc.generated_at).toLocaleString()}` : "Computed on demand (not saved yet)."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs font-medium text-muted-foreground">Confidence tier</p>
          <p className="mt-1 font-semibold">{formatConfidenceTier(tier)}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="text-xs font-medium text-muted-foreground">Research classification</p>
          <p className="mt-1 font-semibold">{formatValidityClassification(qc.validity_classification)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ValidityBoolBadge label="Practice passed" value={qc.practice_passed} />
        <ValidityBoolBadge label="Low confidence" value={qc.low_confidence_flag} />
        <ValidityBoolBadge label="Technical issue" value={qc.technical_issue_flag} />
        <ValidityBoolBadge label="Assessment interpretable" value={qc.assessment_interpretable} />
      </div>

      {pointBreakdown && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validity point breakdown</p>
          <PointBreakdownTable breakdown={pointBreakdown} />
        </div>
      )}

      {qc.cross_test_flags && qc.cross_test_flags.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cross-test flags</p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-800">
            {qc.cross_test_flags.map((flag) => (
              <li key={flag}>{flag.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </div>
      )}

      {qc.task_confidence_score && Object.keys(qc.task_confidence_score).length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-task confidence</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(qc.task_confidence_score).map(([task, taskScore]) => (
              <div key={task} className="rounded-md border border-border/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">{getTaskDisplayName(task)}</p>
                <p className={`font-semibold ${qcScoreColor(taskScore)}`}>{taskScore}/100</p>
                {(qc.task_validity_flags?.[task]?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">
                    {qc.task_validity_flags![task].join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showLegacyFlags && (
        <details className="rounded-lg border border-border/60 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Legacy QC flags
          </summary>
          <div className="mt-3 space-y-2">
            {qc.flags.rt_rounding && (
              <p className={qc.flags.rt_rounding.flagged ? "text-amber-600" : "text-muted-foreground"}>
                RT rounding: {qc.flags.rt_rounding.flagged ? "Flagged" : "OK"}
              </p>
            )}
            {qc.flags.anticipatory_rt_count !== undefined && qc.flags.anticipatory_rt_count > 0 && (
              <p className="text-amber-600">Anticipatory RT (&lt;100ms): {qc.flags.anticipatory_rt_count}</p>
            )}
            {qc.flags.random_responding?.flagged && (
              <p className="text-amber-600">Random responding: RT SD very low ({qc.flags.random_responding.sd_rt} ms)</p>
            )}
            {qc.flags.isi_check?.flagged && (
              <p className="text-amber-600">
                ISI outliers: {qc.flags.isi_check.out_of_range} of {qc.flags.isi_check.n} outside 100–5000 ms
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

type QcPanelControlsProps = {
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onValidate: () => void;
  validateLabel?: string;
};

export function QcPanelControls({
  loading,
  error,
  onReload,
  onValidate,
  validateLabel = "Run QC Validate",
}: QcPanelControlsProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="inline-flex items-center gap-1" onClick={onReload} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          {loading ? "Loading…" : "Reload QC"}
        </Button>
        <Button variant="outline" size="sm" className="inline-flex items-center gap-1" onClick={onValidate} disabled={loading}>
          <ShieldCheck className="h-3.5 w-3.5" />
          {validateLabel}
        </Button>
      </div>
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
    </>
  );
}
