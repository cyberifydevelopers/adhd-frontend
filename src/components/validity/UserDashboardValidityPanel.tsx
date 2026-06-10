import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import type { QcDisplayData } from "@/components/admin/qcValidityUi";
import { ValidityDashboard } from "@/components/validity/ValidityDashboard";
import { usersMeService } from "@/services/usersMeService";

type Props = {
  batteryId: string | null;
  batteryTitle: string;
  hasScoredTasks: boolean;
  /** When true, omit outer section chrome (used inside dashboard tabs). */
  embedded?: boolean;
};

export function UserDashboardValidityPanel({
  batteryId,
  batteryTitle,
  hasScoredTasks,
  embedded = false,
}: Props) {
  const [qc, setQc] = useState<QcDisplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batteryId || !hasScoredTasks) {
      setQc(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    usersMeService
      .getBatteryQc(batteryId)
      .then((data) => setQc(data))
      .catch(() => {
        setQc(null);
        setError("Could not load validity indicators right now.");
      })
      .finally(() => setLoading(false));
  }, [batteryId, hasScoredTasks]);

  const body = (
    <>
      {!batteryId ? (
        <p className="text-sm text-muted-foreground">
          No active battery is linked yet. Validity indicators will appear here once assessments are assigned.
        </p>
      ) : !hasScoredTasks ? (
        <p className="text-sm text-muted-foreground">
          Complete your first task in <span className="font-medium text-foreground">{batteryTitle}</span> to
          see overall confidence, validity classification, and data-quality status here.
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading validity indicators…</p>
      ) : error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : qc ? (
        <ValidityDashboard
          qc={qc}
          scopeLabel="Battery"
          showLegacyFlags={false}
          showIrbDisclaimer
          compact
        />
      ) : (
        <p className="text-sm text-muted-foreground">No validity data available yet for this battery.</p>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="animate-fade-in">
        {hasScoredTasks && (
          <div className="mb-4 flex justify-end">
            <Link
              to="/user/results"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Open full results report
            </Link>
          </div>
        )}
        {body}
      </div>
    );
  }

  return (
    <section className="mb-6 animate-fade-in">
      <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-sm">{body}</div>
    </section>
  );
}
