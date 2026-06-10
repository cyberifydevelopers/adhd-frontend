import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Pill } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { usersMeService } from "@/services";

type MedicationItem = {
  name: string;
  strength: string | null;
  form: string | null;
  quantity: number | null;
  schedule_time?: string | null;
  duration_days?: number | null;
  is_stopped?: boolean;
  time_last_taken: string | null;
};

function formatSchedule(value?: string | null): string {
  if (!value) return "—";
  if (value === "day_night") return "Day + Night";
  if (value === "day") return "Day";
  if (value === "night") return "Night";
  return value;
}

export default function UserMedication() {
  const [loading, setLoading] = useState(true);
  const [medications, setMedications] = useState<MedicationItem[]>([]);

  useEffect(() => {
    usersMeService
      .getIntake()
      .then((r) => setMedications((r.medications ?? []) as MedicationItem[]))
      .catch(() => setMedications([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout title="My Medication">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Medications assigned by your clinician are listed below.
          </p>
          <Link to="/user" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="animate-pulse text-muted-foreground">Loading medications…</p>
          </div>
        ) : medications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <Pill className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" />
            <p className="text-muted-foreground">No medication assigned.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-card shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Medication</th>
                  <th className="px-3 py-2">Strength</th>
                  <th className="px-3 py-2">Form</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Schedule</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {medications.map((m, idx) => (
                  <tr key={`${m.name}-${idx}`} className={m.is_stopped ? "opacity-60" : ""}>
                    <td className={`px-3 py-2 font-medium ${m.is_stopped ? "line-through" : ""}`}>{m.name}</td>
                    <td className={`px-3 py-2 ${m.is_stopped ? "line-through" : ""}`}>{m.strength ?? "—"}</td>
                    <td className={`px-3 py-2 ${m.is_stopped ? "line-through" : ""}`}>{m.form ?? "—"}</td>
                    <td className={`px-3 py-2 ${m.is_stopped ? "line-through" : ""}`}>{m.quantity ?? "—"}</td>
                    <td className={`px-3 py-2 ${m.is_stopped ? "line-through" : ""}`}>{formatSchedule(m.schedule_time)}</td>
                    <td className={`px-3 py-2 ${m.is_stopped ? "line-through" : ""}`}>
                      {m.duration_days ? `${m.duration_days} days` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${m.is_stopped ? "bg-rose-500/15 text-rose-700 dark:text-rose-400" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"}`}>
                        {m.is_stopped ? "Stopped" : "Active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
