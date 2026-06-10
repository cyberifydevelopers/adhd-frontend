import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { QcPanelControls, formatValidityClassification, qcScoreColor } from "@/components/admin/qcValidityUi";
import { ValidityDashboard } from "@/components/validity/ValidityDashboard";
import { getTaskDisplayName } from "@/config/tasks";
import { toast } from "@/lib/toast";
import { adminBatteriesService, type BatteryQcResult } from "@/services/adminBatteriesService";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminBatteryQc() {
  const { userId, batteryId } = useParams<{ userId: string; batteryId: string }>();
  const [qc, setQc] = useState<BatteryQcResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQc = (recompute = false) => {
    if (!userId || !batteryId) return;
    setLoading(true);
    setError(null);
    const request = recompute
      ? adminBatteriesService.validateQc(userId, batteryId)
      : adminBatteriesService.getQc(userId, batteryId);
    request
      .then((data) => {
        setQc(data);
        if (recompute) toast.success("Battery QC validated (all sessions re-scored)");
      })
      .catch((err: unknown) => {
        setQc(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (status === 404) {
          const missingRoute =
            typeof detail === "string" &&
            detail.toLowerCase() === "not found" &&
            detail !== "Battery not found";
          setError(
            missingRoute
              ? "Battery QC API is missing on the server. Deploy the latest backend and run: alembic upgrade head"
              : (typeof detail === "string" ? detail : "Battery not found."),
          );
        } else {
          setError(
            typeof detail === "string"
              ? detail
              : "Failed to load battery QC. Check backend is running and migration 025 is applied.",
          );
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadQc(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, batteryId]);

  if (!userId || !batteryId) return null;

  return (
    <DashboardLayout title={`Battery QC: ${qc?.battery_title ?? batteryId.slice(0, 8)}`}>
      <div className="space-y-6">
        <Link
          to={`/admin/users/${userId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to user
        </Link>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Battery info</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Title</dt>
              <dd className="font-medium">{qc?.battery_title ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{qc?.battery_status ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Sessions in battery</dt>
              <dd className="font-medium">{qc?.flags?.session_count ?? qc?.session_summaries?.length ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tasks scored</dt>
              <dd className="font-medium">{qc?.flags?.task_count ?? "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Full battery QC & validity
          </h3>
          <div className="space-y-4">
            <QcPanelControls
              loading={loading}
              error={error}
              onReload={() => loadQc(false)}
              onValidate={() => loadQc(true)}
              validateLabel="Run Battery QC Validate"
            />
            {!loading && !error && !qc && (
              <p className="text-sm text-muted-foreground">No battery QC data available.</p>
            )}
            {qc && (qc.overall_confidence_score ?? qc.validity_score) != null && (
              <ValidityDashboard qc={qc} scopeLabel="Battery" showLegacyFlags={false} showIrbDisclaimer />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Per-session QC (single task)
          </h3>
          {!qc?.session_summaries?.length ? (
            <p className="text-sm text-muted-foreground">No sessions linked to this battery yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="pb-2 pr-4">Task</th>
                    <th className="pb-2 pr-4">Session</th>
                    <th className="pb-2 pr-4">Created</th>
                    <th className="pb-2 pr-4">Score</th>
                    <th className="pb-2 pr-4">Classification</th>
                    <th className="pb-2 pr-4">Interpretable</th>
                    <th className="pb-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {qc.session_summaries.map((s) => {
                    const score = s.overall_confidence_score;
                    return (
                      <tr key={s.session_id}>
                        <td className="py-2.5 pr-4 font-medium">
                          {s.task_name ? getTaskDisplayName(s.task_name) : "—"}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">
                          {s.session_id.slice(0, 8)}…
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{formatDate(s.created_at)}</td>
                        <td className={`py-2.5 pr-4 font-semibold ${score != null ? qcScoreColor(score) : ""}`}>
                          {score != null ? `${score}/100` : "—"}
                        </td>
                        <td className="py-2.5 pr-4">{formatValidityClassification(s.validity_classification)}</td>
                        <td className="py-2.5 pr-4">
                          {s.assessment_interpretable == null
                            ? "—"
                            : s.assessment_interpretable
                              ? "Yes"
                              : "No"}
                        </td>
                        <td className="py-2.5 text-right">
                          <Link
                            to={`/admin/sessions/${s.session_id}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            Session QC →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
