import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2, Archive, Plus, Save } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AssignTestsModal } from "@/components/admin/AssignTestsModal";
import { EditUserModal } from "@/components/admin/EditUserModal";
import { getTaskDisplayName } from "@/config/tasks";
import { Button } from "@/components/ui/Button";
import { formatValidityClassification, qcScoreColor } from "@/components/admin/qcValidityUi";
import { adminUsersService, type Battery } from "@/services";
import { adminSessionsService } from "@/services";
import { adminUserDetailStore } from "@/stores/adminUserDetailStore";
import { adminUsersStore } from "@/stores/adminUsersStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";

const DEFAULT_MEDICATION_FORMS = ["Tablet", "Syrup"];
type MedicationAction = "update" | "stop" | "delete";

const statusStyles: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [sessionDeleteConfirm, setSessionDeleteConfirm] = useState<{
    id: string;
    type: "soft" | "hard";
  } | null>(null);
  const [medicationDraft, setMedicationDraft] = useState<Array<{
    name: string;
    strength: string;
    form: string;
    quantity: string;
    schedule_time: "day" | "night" | "day_night";
    duration_days: string;
    is_stopped: boolean;
    action: MedicationAction;
  }>>([]);
  const [formularyItems, setFormularyItems] = useState<
    { name: string; common_strengths: string[]; common_forms: string[] }[]
  >([]);
  const [savingMeds, setSavingMeds] = useState(false);
  const [batteries, setBatteries] = useState<Battery[]>([]);

  const user = adminUserDetailStore((s) => s.user);
  const intake = adminUserDetailStore((s) => s.intake);
  const assignments = adminUserDetailStore((s) => s.assignments);
  const sessions = adminUserDetailStore((s) => s.sessions);
  const sessionsTotal = adminUserDetailStore((s) => s.sessionsTotal);
  const sessionsPage = adminUserDetailStore((s) => s.sessionsPage);
  const sessionsPageSize = adminUserDetailStore((s) => s.sessionsPageSize);
  const showDeletedSessions = adminUserDetailStore((s) => s.showDeletedSessions);
  const setShowDeletedSessions = adminUserDetailStore((s) => s.setShowDeletedSessions);
  const fetchSessions = adminUserDetailStore((s) => s.fetchSessions);
  const isLoading = adminUserDetailStore((s) => s.isLoading);
  const fetchUserDetail = adminUserDetailStore((s) => s.fetchUserDetail);
  const refetch = adminUserDetailStore((s) => s.refetch);

  const totalPages = Math.max(1, Math.ceil(sessionsTotal / sessionsPageSize));

  useEffect(() => {
    fetchUserDetail(userId ?? null);
  }, [userId, fetchUserDetail]);

  useEffect(() => {
    adminUsersService
      .getFormulary("", 100)
      .then((r) => setFormularyItems(r.items ?? []))
      .catch(() => setFormularyItems([]));
  }, []);

  useEffect(() => {
    if (!userId) return;
    adminUsersService
      .getBatteries(userId)
      .then(setBatteries)
      .catch(() => setBatteries([]));
  }, [userId]);

  useEffect(() => {
    const meds = intake?.medications ?? [];
    setMedicationDraft(
      meds.map((m) => ({
        name: m.name,
        strength: m.strength ?? "",
        form: m.form ?? "",
        quantity: m.quantity != null ? String(m.quantity) : "",
        schedule_time: (m.schedule_time as "day" | "night" | "day_night" | null) ?? "day",
        duration_days: m.duration_days != null ? String(m.duration_days) : "",
        is_stopped: Boolean(m.is_stopped),
        action: m.is_stopped ? "stop" : "update",
      })),
    );
  }, [intake?.medications]);

  if (!userId) return null;

  if (isLoading || !user) {
    return (
      <DashboardLayout title="User Details">
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="animate-pulse text-muted-foreground">Loading…</p>
        </div>
      </DashboardLayout>
    );
  }

  const sortedAssignments = [...assignments].sort((a, b) => a.test_order - b.test_order);
  const isTreatmentMode = user.mode === "treatment_efficacy" || user.mode === "treatment";

  const updateMedication = (
    index: number,
    patch: Partial<{
      name: string;
      strength: string;
      form: string;
      quantity: string;
      schedule_time: "day" | "night" | "day_night";
      duration_days: string;
      is_stopped: boolean;
      action: MedicationAction;
    }>,
  ) => {
    setMedicationDraft((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const handleSaveMedications = async () => {
    setSavingMeds(true);
    try {
      await adminUsersService.updateIntake(userId, {
        medications: medicationDraft
          .filter((m) => m.name.trim() && m.action !== "delete")
          .map((m) => ({
            name: m.name.trim(),
            strength: m.strength.trim() || undefined,
            form: m.form.trim() || undefined,
            quantity: m.quantity ? parseInt(m.quantity, 10) : undefined,
            schedule_time: m.schedule_time,
            duration_days: m.duration_days ? parseInt(m.duration_days, 10) : undefined,
            is_stopped: m.action === "stop",
          })),
      });
      toast.success("Medications updated");
      refetch();
    } catch {
      toast.error("Failed to update medications");
    } finally {
      setSavingMeds(false);
    }
  };

  const handleSessionDelete = async () => {
    if (!sessionDeleteConfirm) return;
    const { id, type } = sessionDeleteConfirm;
    try {
      if (type === "soft") {
        await adminSessionsService.softDeleteSession(id);
        toast.success("Session archived (soft deleted)");
      } else {
        await adminSessionsService.hardDeleteSession(id);
        toast.success("Session permanently deleted");
      }
      fetchSessions();
    } catch {
      toast.error("Failed to delete session");
    } finally {
      setSessionDeleteConfirm(null);
    }
  };

  return (
    <DashboardLayout title={`User: ${user.name}`}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to users
          </Link>
          <div className="flex flex-wrap gap-2">
            {sessions.length > 0 && !sessions[0].is_deleted && (
              <Link to={`/admin/sessions/${sessions[0].session_id}`}>
                <Button size="sm" variant="outline">
                  View latest results
                </Button>
              </Link>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowEditUserModal(true)}>
              Edit user
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAssignModal(true)}>
              Assign / edit tests
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-rose-500/60 text-rose-600 hover:bg-rose-500/10"
              disabled={deleting}
              onClick={() => setDeleteConfirm(true)}
            >
              {deleting ? "Deleting…" : "Delete user"}
            </Button>
          </div>
        </div>

        {/* Profile */}
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Profile
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="font-medium">{user.mode ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <span className={user.is_active ? "text-emerald-600" : "text-muted-foreground"}>
                  {user.is_active ? "Active" : "Inactive"}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        {/* Assign medicines (treatment mode only) */}
        {isTreatmentMode && (
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Assign Medicines
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="inline-flex items-center gap-1"
              onClick={() =>
                setMedicationDraft((prev) => [
                  ...prev,
                  {
                    name: "",
                    strength: "",
                    form: "",
                    quantity: "",
                    schedule_time: "day",
                    duration_days: "",
                    is_stopped: false,
                    action: "update",
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add medication
            </Button>
          </div>
          {medicationDraft.length === 0 ? (
            <p className="text-sm text-muted-foreground">No medications assigned.</p>
          ) : (
            <div className="space-y-2">
              {medicationDraft.map((m, index) => {
                const selected = formularyItems.find((f) => f.name === m.name);
                const strengths = selected?.common_strengths ?? [];
                const forms = Array.from(new Set([...(selected?.common_forms ?? []), ...DEFAULT_MEDICATION_FORMS]));
                const isStopped = m.action === "stop";
                const isDeleted = m.action === "delete";
                const isEditable = m.action === "update";
                return (
                  <div
                    key={`${m.name}-${index}`}
                    className={`rounded-lg border border-border/60 bg-muted/20 p-3 ${isStopped ? "opacity-70" : ""} ${isDeleted ? "opacity-50" : ""}`}
                  >
                    <div className="grid gap-2 md:grid-cols-7">
                      <select
                        value={m.name}
                        disabled={!isEditable}
                        onChange={(e) => {
                          const chosen = formularyItems.find((f) => f.name === e.target.value);
                          updateMedication(index, {
                            name: e.target.value,
                            strength: chosen?.common_strengths?.[0] ?? m.strength,
                            form: chosen?.common_forms?.[0] ?? m.form,
                          });
                        }}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm md:col-span-2 ${isStopped || isDeleted ? "line-through" : ""}`}
                      >
                        <option value="">Select medication…</option>
                        {formularyItems.map((f) => (
                          <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                      </select>
                      <select
                        value={m.strength}
                        disabled={!isEditable}
                        onChange={(e) => updateMedication(index, { strength: e.target.value })}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm ${isStopped || isDeleted ? "line-through" : ""}`}
                      >
                        <option value="">Strength</option>
                        {(strengths.length > 0 ? strengths : [m.strength].filter(Boolean)).map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <select
                        value={m.form}
                        disabled={!isEditable}
                        onChange={(e) => updateMedication(index, { form: e.target.value })}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm ${isStopped || isDeleted ? "line-through" : ""}`}
                      >
                        <option value="">Form</option>
                        {forms.map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                        {m.form && !forms.includes(m.form) && <option value={m.form}>{m.form}</option>}
                      </select>
                      <input
                        type="number"
                        min={1}
                        placeholder="Qty"
                        value={m.quantity}
                        disabled={!isEditable}
                        onChange={(e) => updateMedication(index, { quantity: e.target.value })}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm ${isStopped || isDeleted ? "line-through" : ""}`}
                      />
                      <select
                        value={m.schedule_time}
                        disabled={!isEditable}
                        onChange={(e) => updateMedication(index, { schedule_time: e.target.value as "day" | "night" | "day_night" })}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm ${isStopped || isDeleted ? "line-through" : ""}`}
                      >
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                        <option value="day_night">Day + Night</option>
                      </select>
                      <input
                        type="number"
                        min={1}
                        placeholder="Duration (days)"
                        value={m.duration_days}
                        disabled={!isEditable}
                        onChange={(e) => updateMedication(index, { duration_days: e.target.value })}
                        className={`rounded border border-border bg-background px-2 py-1.5 text-sm ${isStopped || isDeleted ? "line-through" : ""}`}
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">Action</label>
                      <select
                        value={m.action}
                        onChange={(e) => updateMedication(index, { action: e.target.value as MedicationAction })}
                        className="rounded border border-border bg-background px-2 py-1.5 text-xs"
                      >
                        <option value="update">Update medicine</option>
                        <option value="stop">Stop medicine</option>
                        <option value="delete">Delete medicine</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4">
            <Button size="sm" onClick={handleSaveMedications} disabled={savingMeds} className="inline-flex items-center gap-1">
              <Save className="h-3.5 w-3.5" />
              {savingMeds ? "Saving..." : "Save medicines"}
            </Button>
          </div>
        </section>
        )}

        {/* Intake (view only — filled by user on first login) */}
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Intake
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">Filled by the user on first login. View only.</p>
          {intake && (intake.intake_data || (intake.medications && intake.medications.length > 0)) ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(intake.intake_data ?? {})
                .filter(([k]) => !["sleep_hours", "substance_flags", "testing_environment"].includes(k))
                .map(
                ([k, v]) =>
                  v != null && (
                    <div key={k}>
                      <dt className="text-muted-foreground">{k.replace(/_/g, " ")}</dt>
                      <dd className="font-medium">
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </dd>
                    </div>
                  )
              )}
              {intake.medications && intake.medications.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-muted-foreground">Medications</dt>
                  <dd>
                    <ul className="space-y-1">
                      {intake.medications.map((m) => (
                        <li key={m.id} className="text-sm font-medium">
                          {m.name}
                          {m.strength && ` ${m.strength}`}
                          {m.time_last_taken &&
                            ` — Last taken: ${new Date(m.time_last_taken).toLocaleString()}`}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No intake data</p>
          )}
        </section>

        {/* Batteries — full battery QC */}
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Batteries & QC validation
          </h3>
          {batteries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No batteries assigned yet.</p>
          ) : (
            <ul className="space-y-2">
              {batteries.map((b) => (
                <li
                  key={b.battery_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                >
                  <div>
                    <p className="font-medium">{b.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.completed_tests ?? 0}/{b.total_tests ?? b.items.length} tasks completed · {b.status}
                    </p>
                    {b.validity_summary?.overall_confidence_score != null && (
                      <p className="mt-1 text-xs">
                        <span className="text-muted-foreground">Confidence: </span>
                        <span className={`font-semibold ${qcScoreColor(b.validity_summary.overall_confidence_score)}`}>
                          {b.validity_summary.overall_confidence_score}/100
                        </span>
                        {b.validity_summary.validity_classification && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {formatValidityClassification(b.validity_summary.validity_classification)}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <Link to={`/admin/users/${userId}/batteries/${b.battery_id}/qc`}>
                    <Button size="sm" variant="outline">
                      Full battery QC →
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Assignments */}
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Test assignments
          </h3>
          {sortedAssignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tests assigned</p>
          ) : (
            <ul className="space-y-2">
              {sortedAssignments.map((a) => (
                <li
                  key={a.test_name}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                >
                  <span className="font-medium">{getTaskDisplayName(a.test_name)}</span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      statusStyles[a.status] ?? statusStyles.pending
                    }`}
                  >
                    {a.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Session history — table with pagination */}
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Session history
            </h3>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDeletedSessions}
                onChange={(e) => setShowDeletedSessions(e.target.checked)}
                className="rounded border-border"
              />
              Show deleted
            </label>
          </div>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions yet</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 pr-4">Session ID</th>
                      <th className="pb-2 pr-4">Created</th>
                      <th className="pb-2 pr-4">Confidence</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {sessions.map((s) => (
                      <tr
                        key={s.session_id}
                        className={`${s.is_deleted ? "opacity-50" : ""}`}
                      >
                        <td className="py-2.5 pr-4">
                          <Link
                            to={`/admin/sessions/${s.session_id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {s.session_id.slice(0, 8)}…
                          </Link>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {formatDate(s.created_at)}
                        </td>
                        <td className="py-2.5 pr-4 text-xs">
                          {s.validity_summary?.overall_confidence_score != null ? (
                            <span className={qcScoreColor(s.validity_summary.overall_confidence_score)}>
                              {s.validity_summary.overall_confidence_score}/100
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          {s.is_deleted ? (
                            <span className="inline-flex rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                              Deleted
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="inline-flex gap-1">
                            {!s.is_deleted && (
                              <button
                                onClick={() => setSessionDeleteConfirm({ id: s.session_id, type: "soft" })}
                                className="rounded p-1.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600 transition-colors"
                                title="Soft delete (archive)"
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setSessionDeleteConfirm({ id: s.session_id, type: "hard" })}
                              className="rounded p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                              title="Permanently delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
                  <span className="text-xs text-muted-foreground">
                    Page {sessionsPage} of {totalPages} ({sessionsTotal} total)
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => fetchSessions(sessionsPage - 1)}
                      disabled={sessionsPage <= 1}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => fetchSessions(sessionsPage + 1)}
                      disabled={sessionsPage >= totalPages}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {showAssignModal && (
        <AssignTestsModal
          userId={userId}
          userName={user.name}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            refetch();
            setShowAssignModal(false);
          }}
        />
      )}
      {showEditUserModal && (
        <EditUserModal
          userId={userId}
          userName={user.name}
          initialName={user.name}
          initialEmail={user.email}
          initialIsActive={user.is_active}
          initialMode={user.mode}
          onClose={() => setShowEditUserModal(false)}
          onSuccess={() => refetch()}
        />
      )}
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(false)}
        title="Delete user"
        description="Permanently delete this user and all their data? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          setDeleting(true);
          try {
            await adminUsersService.deleteUser(userId);
            toast.success("User deleted");
            adminUsersStore.getState().fetchList(1, 20);
            navigate("/admin");
          } catch {
            toast.error("Failed to delete user");
          } finally {
            setDeleting(false);
          }
        }}
      />
      <ConfirmDialog
        open={!!sessionDeleteConfirm}
        onOpenChange={(open) => !open && setSessionDeleteConfirm(null)}
        title={sessionDeleteConfirm?.type === "hard" ? "Permanently delete session" : "Archive session"}
        description={
          sessionDeleteConfirm?.type === "hard"
            ? "This will permanently remove this session and all its data. This action cannot be undone."
            : "This will soft-delete (archive) the session. It can still be viewed if 'Show deleted' is enabled."
        }
        confirmLabel={sessionDeleteConfirm?.type === "hard" ? "Delete permanently" : "Archive"}
        variant="destructive"
        onConfirm={handleSessionDelete}
      />
    </DashboardLayout>
  );
}
