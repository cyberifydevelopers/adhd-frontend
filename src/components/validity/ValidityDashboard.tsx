import { getTaskDisplayName } from "@/config/tasks";
import {
  PointBreakdownTable,
  ValidityBoolBadge,
  formatConfidenceTier,
  formatValidityClassification,
  qcScoreColor,
  type QcDisplayData,
} from "@/components/admin/qcValidityUi";
import { useState } from "react";
import { VALIDITY_IRB_DISCLAIMER, validityFlagTitle } from "@/lib/validityFlagExplanations";
import {
  buildValidityStatusTiles,
  collectExplainedFlags,
  type ValidityStatusLevel,
} from "@/lib/validityDashboardModel";

const STATUS_STYLES: Record<ValidityStatusLevel, string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  review: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  concern: "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-300",
  unknown: "border-border/60 bg-muted/30 text-muted-foreground",
};

const STATUS_LABEL: Record<ValidityStatusLevel, string> = {
  good: "Good",
  review: "Review",
  concern: "Concern",
  unknown: "N/A",
};

type ValidityDashboardProps = {
  qc: QcDisplayData;
  /** e.g. "Battery" or "Session" */
  scopeLabel?: string;
  showPointBreakdown?: boolean;
  showPerTaskGrid?: boolean;
  showLegacyFlags?: boolean;
  showIrbDisclaimer?: boolean;
  compact?: boolean;
};

export function ValidityDashboard({
  qc,
  scopeLabel = "Assessment",
  showPointBreakdown = true,
  showPerTaskGrid = true,
  showLegacyFlags = false,
  showIrbDisclaimer = true,
  compact = false,
}: ValidityDashboardProps) {
  const [showCompactDetails, setShowCompactDetails] = useState(false);
  const score = qc.overall_confidence_score ?? qc.validity_score;
  const tier = qc.confidence_tier ?? qc.flags?.confidence_tier;
  const tiles = buildValidityStatusTiles(qc);
  const explainedFlags = collectExplainedFlags(qc);
  const pointBreakdown = qc.flags?.validity_point_breakdown;
  const showDetails = !compact || showCompactDetails;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Overall confidence score
          </p>
          <p className={`mt-1 text-3xl font-bold ${qcScoreColor(score)}`}>{score}/100</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {scopeLabel} level · Score = 100 − (validity points × 5)
          </p>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">Validity classification</p>
          <p className="mt-1 text-lg font-semibold">{formatValidityClassification(qc.validity_classification)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatConfidenceTier(tier)}</p>
        </div>
        <div className="rounded-lg border border-border/60 p-4">
          <p className="text-xs font-medium text-muted-foreground">Interpretability</p>
          <div className="mt-2">
            <ValidityBoolBadge label="Assessment interpretable" value={qc.assessment_interpretable} />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Data quality status
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.id} className={`rounded-lg border px-3 py-2.5 ${STATUS_STYLES[t.level]}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t.label}</p>
                <span className="text-[10px] font-bold uppercase tracking-wide">{STATUS_LABEL[t.level]}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed opacity-90">{t.summary}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ValidityBoolBadge label="Practice passed" value={qc.practice_passed} />
        <ValidityBoolBadge label="Low confidence" value={qc.low_confidence_flag} />
        <ValidityBoolBadge label="Technical issue" value={qc.technical_issue_flag} />
      </div>

      {compact && (pointBreakdown || (qc.task_confidence_score && Object.keys(qc.task_confidence_score).length > 0)) && (
        <button
          type="button"
          onClick={() => setShowCompactDetails((v) => !v)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showCompactDetails ? "Hide score details" : "Show score details"}
        </button>
      )}

      {showPointBreakdown && pointBreakdown && showDetails && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Validity point breakdown
          </p>
          <PointBreakdownTable breakdown={pointBreakdown} />
        </div>
      )}

      {showPerTaskGrid &&
        qc.task_confidence_score &&
        Object.keys(qc.task_confidence_score).length > 0 &&
        showDetails && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per-task confidence
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(qc.task_confidence_score).map(([task, taskScore]) => (
                <div key={task} className="rounded-md border border-border/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">{getTaskDisplayName(task)}</p>
                  <p className={`font-semibold ${qcScoreColor(taskScore)}`}>{taskScore}/100</p>
                </div>
              ))}
            </div>
          </div>
        )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Validity flags
        </p>
        {explainedFlags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No validity flags were raised for this assessment.</p>
        ) : (
          <ul className="space-y-2">
            {explainedFlags.map((item) => (
              <li
                key={`${item.source}-${item.taskName ?? ""}-${item.id}`}
                className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2 text-sm"
              >
                <p className="font-medium text-foreground">
                  {item.taskName ? (
                    <>
                      <span className="text-muted-foreground">{getTaskDisplayName(item.taskName)}</span>
                      <span className="text-muted-foreground"> · </span>
                      {validityFlagTitle(item.id, item.taskName)}
                    </>
                  ) : (
                    validityFlagTitle(item.id)
                  )}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showLegacyFlags && (
        <details className="rounded-lg border border-border/60 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Legacy QC flags
          </summary>
          <div className="mt-3 space-y-2 text-sm">
            {qc.flags.rt_rounding && (
              <p className={qc.flags.rt_rounding.flagged ? "text-amber-600" : "text-muted-foreground"}>
                RT rounding: {qc.flags.rt_rounding.flagged ? "Flagged" : "OK"}
              </p>
            )}
            {qc.flags.anticipatory_rt_count !== undefined && qc.flags.anticipatory_rt_count > 0 && (
              <p className="text-amber-600">Anticipatory RT (&lt;100ms): {qc.flags.anticipatory_rt_count}</p>
            )}
            {qc.flags.random_responding?.flagged && (
              <p className="text-amber-600">
                Random responding: RT SD very low ({qc.flags.random_responding.sd_rt} ms)
              </p>
            )}
            {qc.flags.isi_check?.flagged && (
              <p className="text-amber-600">
                ISI outliers: {qc.flags.isi_check.out_of_range} of {qc.flags.isi_check.n} outside 100–5000 ms
              </p>
            )}
          </div>
        </details>
      )}

      {showIrbDisclaimer && (
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {VALIDITY_IRB_DISCLAIMER}
        </div>
      )}
    </div>
  );
}
