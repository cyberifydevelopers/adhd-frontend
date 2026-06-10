import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  FileText,
  GitBranch,
  LayoutDashboard,
  Trash2,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { getTaskDisplayName } from "@/config/tasks";
import { Button } from "@/components/ui/Button";
import { QcPanelControls } from "@/components/admin/qcValidityUi";
import { ValidityDashboard } from "@/components/validity/ValidityDashboard";
import {
  adminSessionsService,
  type SessionDetail,
  type SessionQcResult,
  type TrialEventItem,
} from "@/services";
import { CATRoutingLog } from "@/components/admin/CATRoutingLog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MainAdaptiveResultsSummary } from "@/components/results/MainAdaptiveResultsSummary";
import { ScoredTaskMetricsSummary } from "@/components/results/ScoredTaskMetricsSummary";
import { toast } from "@/lib/toast";

const RT_TASKS = ["cpt", "sst", "simple_rt", "choice_rt", "flanker", "task_switching"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function RtHistogram({ events }: { events: TrialEventItem[] }) {
  const rts = events
    .map((e) => e.reaction_time_ms)
    .filter((v): v is number => typeof v === "number" && v > 0 && v < 10000);
  if (rts.length === 0) return <p className="text-sm text-muted-foreground">No RT data</p>;
  const min = Math.min(...rts);
  const max = Math.max(...rts);
  const range = max - min || 1;
  const binCount = 12;
  const binWidth = range / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    low: min + i * binWidth,
    high: min + (i + 1) * binWidth,
    count: 0,
  }));
  for (const rt of rts) {
    let idx = binWidth > 0 ? Math.floor((rt - min) / binWidth) : 0;
    idx = Math.max(0, Math.min(idx, binCount - 1));
    bins[idx].count++;
  }
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">n={rts.length} • range {Math.round(min)}–{Math.round(max)} ms</p>
      <div className="flex h-24 items-end gap-0.5">
        {bins.map((b, i) => (
          <div
            key={i}
            className="min-w-[8px] flex-1 rounded-t bg-primary/60 transition-all"
            style={{ height: `${(b.count / maxCount) * 100}%`, minHeight: b.count ? 4 : 0 }}
            title={`${Math.round(b.low)}–${Math.round(b.high)} ms: ${b.count}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{Math.round(min)}</span>
        <span>{Math.round(max)} ms</span>
      </div>
    </div>
  );
}

function SsdStuckAlert({
  sessionId,
  hasSstEvents,
}: {
  sessionId: string;
  hasSstEvents: boolean;
}) {
  const [convergence, setConvergence] = useState<{
    stuck_at_floor: boolean;
    stuck_at_ceiling: boolean;
    message: string;
  } | null>(null);
  useEffect(() => {
    if (!hasSstEvents) return;
    adminSessionsService.getSstConvergence(sessionId).then(setConvergence).catch(() => setConvergence(null));
  }, [sessionId, hasSstEvents]);
  if (!convergence || (!convergence.stuck_at_floor && !convergence.stuck_at_ceiling)) return null;
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
      ⚠ {convergence.message}
    </div>
  );
}

function SsdTrajectoryChart({ events }: { events: TrialEventItem[] }) {
  const stopTrials = events
    .filter((e) => e.event_type === "stop" && e.isi_ms != null)
    .sort((a, b) => a.trial_index - b.trial_index)
    .map((e, i) => ({ idx: i + 1, ssd: e.isi_ms as number }));
  if (stopTrials.length === 0)
    return <p className="text-sm text-muted-foreground">No stop trial data (SSD)</p>;
  const ssds = stopTrials.map((t) => t.ssd);
  const minSsd = Math.min(...ssds);
  const maxSsd = Math.max(...ssds);
  const range = maxSsd - minSsd || 1;
  const pad = range * 0.1 || 10;
  const yMin = Math.max(0, minSsd - pad);
  const yMax = maxSsd + pad;
  const yRange = yMax - yMin || 1;
  const w = 320;
  const h = 120;
  const pts = stopTrials
    .map((t, i) => {
      const x = (i / Math.max(stopTrials.length - 1, 1)) * (w - 40) + 20;
      const y = h - 20 - ((t.ssd - yMin) / yRange) * (h - 40);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        n={stopTrials.length} stop trials • SSD range {Math.round(minSsd)}–{Math.round(maxSsd)} ms
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full max-w-md" preserveAspectRatio="xMidYMid meet">
        <polyline
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        <line
          x1="20"
          y1={h - 20}
          x2={w - 20}
          y2={h - 20}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <line
          x1="20"
          y1="20"
          x2="20"
          y2={h - 20}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <text x="10" y={h - 10} className="text-[10px] fill-muted-foreground">
          {Math.round(minSsd)}
        </text>
        <text x="10" y="24" className="text-[10px] fill-muted-foreground">
          {Math.round(maxSsd)}
        </text>
        <text x={w / 2 - 20} y={h - 2} className="text-[10px] fill-muted-foreground">
          Trial
        </text>
      </svg>
    </div>
  );
}

function TimeOnTaskChart({ events }: { events: TrialEventItem[] }) {
  const rts = events
    .filter((e) => typeof e.reaction_time_ms === "number" && e.reaction_time_ms > 0 && e.reaction_time_ms < 10000)
    .sort((a, b) => a.trial_index - b.trial_index);
  if (rts.length < 4) return <p className="text-sm text-muted-foreground">Insufficient trials for time-on-task</p>;
  const quarters = 4;
  const perQ = Math.ceil(rts.length / quarters);
  const quarterMeans = Array.from({ length: quarters }, (_, i) => {
    const start = i * perQ;
    const slice = rts.slice(start, Math.min(start + perQ, rts.length));
    const sum = slice.reduce((a, e) => a + (e.reaction_time_ms ?? 0), 0);
    return slice.length ? sum / slice.length : 0;
  });
  const minRT = Math.min(...quarterMeans.filter(Boolean), 1);
  const maxRT = Math.max(...quarterMeans);
  const range = maxRT - minRT || 1;
  const w = 320;
  const h = 120;
  const pts = quarterMeans
    .map((m, i) => {
      const x = (i / Math.max(quarters - 1, 1)) * (w - 40) + 20;
      const y = h - 20 - ((m - minRT) / range) * (h - 40);
      return `${x},${y}`;
    })
    .join(" ");
  const slope = quarters > 1 ? (quarterMeans[quarters - 1] - quarterMeans[0]) / (quarters - 1) : 0;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Mean RT by quarter • slope ≈ {slope.toFixed(1)} ms/quarter {slope > 5 ? "(possible fatigue)" : ""}
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full max-w-md" preserveAspectRatio="xMidYMid meet">
        <polyline
          fill="none"
          stroke="var(--chart-3)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        <line x1="20" y1={h - 20} x2={w - 20} y2={h - 20} stroke="var(--border)" strokeWidth="1" />
        <line x1="20" y1="20" x2="20" y2={h - 20} stroke="var(--border)" strokeWidth="1" />
        <text x="10" y={h - 10} className="text-[10px] fill-muted-foreground">{Math.round(minRT)}</text>
        <text x="10" y="24" className="text-[10px] fill-muted-foreground">{Math.round(maxRT)}</text>
        <text x={w / 2 - 30} y={h - 2} className="text-[10px] fill-muted-foreground">Quarter</text>
      </svg>
    </div>
  );
}

function IsiHistogram({ events }: { events: TrialEventItem[] }) {
  const isis = events
    .map((e) => (e as unknown as Record<string, unknown>).isi_ms)
    .filter((v): v is number => typeof v === "number" && v > 0 && v < 10000);
  if (isis.length === 0) return <p className="text-sm text-muted-foreground">No ISI data</p>;
  const minI = Math.min(...isis);
  const maxI = Math.max(...isis);
  const range = maxI - minI || 1;
  const binCount = 12;
  const binWidth = range / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ low: minI + i * binWidth, high: minI + (i + 1) * binWidth, count: 0 }));
  for (const v of isis) {
    const idx = Math.min(Math.floor((v - minI) / binWidth) || 0, binCount - 1);
    bins[Math.max(0, idx)].count++;
  }
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">n={isis.length} • range {Math.round(minI)}–{Math.round(maxI)} ms</p>
      <div className="flex h-20 items-end gap-0.5">
        {bins.map((b, i) => (
          <div
            key={i}
            className="min-w-[8px] flex-1 rounded-t"
            style={{
              height: `${(b.count / maxCount) * 100}%`,
              minHeight: b.count ? 4 : 0,
              backgroundColor: "var(--chart-4)",
            }}
            title={`${Math.round(b.low)}–${Math.round(b.high)} ms: ${b.count}`}
          />
        ))}
      </div>
    </div>
  );
}

function StopSuccessConvergenceChart({ events }: { events: TrialEventItem[] }) {
  const stopTrials = events
    .filter((e) => e.event_type === "stop")
    .sort((a, b) => a.trial_index - b.trial_index)
    .map((e) => ({ success: e.is_correct === true }));
  if (stopTrials.length === 0)
    return <p className="text-sm text-muted-foreground">No stop trial data</p>;
  const runningRate = stopTrials.map((_, i) => {
    const slice = stopTrials.slice(0, i + 1);
    const successes = slice.filter((t) => t.success).length;
    return (successes / slice.length) * 100;
  });
  const w = 320;
  const h = 120;
  const pts = runningRate
    .map((rate, i) => {
      const x = (i / Math.max(runningRate.length - 1, 1)) * (w - 40) + 20;
      const y = h - 20 - (rate / 100) * (h - 40);
      return `${x},${y}`;
    })
    .join(" ");
  const finalRate = runningRate[runningRate.length - 1];
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        Stop success rate (running) • final {finalRate.toFixed(1)}% • target ~50%
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full max-w-md" preserveAspectRatio="xMidYMid meet">
        <polyline
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={pts}
        />
        <line x1="20" y1={h - 20} x2={w - 20} y2={h - 20} stroke="var(--border)" strokeWidth="1" />
        <line x1="20" y1="20" x2="20" y2={h - 20} stroke="var(--border)" strokeWidth="1" />
        <line
          x1="20"
          y1={h - 20 - 0.5 * (h - 40)}
          x2={w - 20}
          y2={h - 20 - 0.5 * (h - 40)}
          stroke="var(--muted-foreground)"
          strokeWidth="1"
          strokeDasharray="4"
        />
        <text x="10" y={h - 10} className="text-[10px] fill-muted-foreground">0%</text>
        <text x="10" y="24" className="text-[10px] fill-muted-foreground">100%</text>
        <text x={w / 2 - 30} y={h - 2} className="text-[10px] fill-muted-foreground">Trial</text>
      </svg>
    </div>
  );
}

function OmissionCommissionChart({ metrics }: { metrics: Record<string, unknown> }) {
  const hasRate = "omission_rate" in metrics && metrics.omission_rate != null;
  const omit = Number(metrics.omission_rate ?? metrics.n_omissions ?? 0);
  const comm = Number(metrics.commission_rate ?? metrics.n_commissions ?? 0);
  if (omit === 0 && comm === 0) return null;
  const maxVal = hasRate ? 1 : Math.max(omit, comm, 1);
  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <p className="mb-1 text-xs text-muted-foreground">Omissions</p>
        <div className="h-8 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-amber-500/70"
            style={{ width: `${(omit / maxVal) * 100}%` }}
          />
        </div>
        <p className="mt-0.5 text-sm font-medium">
          {hasRate ? `${(omit * 100).toFixed(1)}%` : omit}
        </p>
      </div>
      <div className="flex-1">
        <p className="mb-1 text-xs text-muted-foreground">Commissions</p>
        <div className="h-8 overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-rose-500/70"
            style={{ width: `${(comm / maxVal) * 100}%` }}
          />
        </div>
        <p className="mt-0.5 text-sm font-medium">
          {hasRate ? `${(comm * 100).toFixed(1)}%` : comm}
        </p>
      </div>
    </div>
  );
}

const OMISSION_COMMISSION_TASKS = ["cpt", "srt", "choice_rt"];

function QcDebugPanel({ sessionId }: { sessionId: string }) {
  const [qc, setQc] = useState<SessionQcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQc = (recompute = false) => {
    setLoading(true);
    setError(null);
    const request = recompute
      ? adminSessionsService.validateQc(sessionId)
      : adminSessionsService.getQc(sessionId);
    request
      .then((data) => {
        setQc(data);
        if (recompute) toast.success("QC validated");
      })
      .catch((err: unknown) => {
        setQc(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (status === 403) {
          setError("Permission denied. Run QC Validate requires admin role; try Load QC instead.");
        } else if (status === 404) {
          setError("Session not found.");
        } else {
          setError(detail ?? "Failed to load QC. Check backend is running and migration 023 is applied.");
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    adminSessionsService
      .getQc(sessionId)
      .then(setQc)
      .catch((err: unknown) => {
        setQc(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        setError(
          status === 403
            ? "Permission denied."
            : (detail ?? "Failed to load QC. Check backend is running and migration 023 is applied."),
        );
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <div className="space-y-4">
      <QcPanelControls
        loading={loading}
        error={error}
        onReload={() => loadQc(false)}
        onValidate={() => loadQc(true)}
      />
      {!loading && !error && !qc && (
        <p className="text-sm text-muted-foreground">No QC data available for this session.</p>
      )}
      {qc && (qc.overall_confidence_score ?? qc.validity_score) != null && (
        <ValidityDashboard qc={qc} scopeLabel="Session" showLegacyFlags showIrbDisclaimer />
      )}
    </div>
  );
}

export default function AdminSessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [rtTask, setRtTask] = useState<string>("");
  const [rtEvents, setRtEvents] = useState<TrialEventItem[]>([]);
  const [rawEvents, setRawEvents] = useState<TrialEventItem[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "cat">("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    adminSessionsService
      .getDetail(sessionId)
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !rtTask) {
      setRtEvents([]);
      return;
    }
    adminSessionsService.getTrialEvents(sessionId, rtTask).then(setRtEvents);
  }, [sessionId, rtTask]);

  const loadRawEvents = () => {
    if (!sessionId) return;
    adminSessionsService.getTrialEvents(sessionId, undefined, true).then(setRawEvents);
  };

  const exportCsv = () => {
    if (rawEvents.length === 0) return;
    const headers = ["trial_index", "task_name", "stimulus_onset_ms", "keypress_ms", "reaction_time_ms", "response_key", "correct_key", "is_correct", "event_type", "isi_ms"];
    const rows = rawEvents.map((e) =>
      headers.map((h) => {
        const v = (e as unknown as Record<string, unknown>)[h];
        if (v === null || v === undefined) return "";
        return String(v);
      })
    );
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}-trials.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!sessionId) return null;
  if (loading || !session) {
    return (
      <DashboardLayout title="Session">
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="animate-pulse text-muted-foreground">Loading session…</p>
        </div>
      </DashboardLayout>
    );
  }

  const rtTaskOptions = RT_TASKS.filter((t) =>
    session.task_results.some((r) => r.task_name === t)
  );

  return (
    <DashboardLayout title={`Session: ${session.session_id.slice(0, 8)}…`}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            to={session.user_id ? `/admin/users/${session.user_id}` : "/admin"}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {session.user_name ? `${session.user_name}` : "users"}
          </Link>
          <Button
            size="sm"
            variant="outline"
            className="border-rose-500/60 text-rose-600 hover:bg-rose-500/10"
            disabled={deleting}
            onClick={() => setDeleteConfirm(true)}
          >
            {deleting ? "Deleting…" : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                Delete session
              </>
            )}
          </Button>
        </div>

        <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
          <button
            onClick={() => setActiveTab("overview")}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
              activeTab === "overview" ? "bg-card shadow-sm text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab("cat")}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ${
              activeTab === "cat" ? "bg-card shadow-sm text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            CAT Routing Log
          </button>
        </div>

        {activeTab === "cat" ? (
          <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              CAT Explainability Viewer
            </h3>
            {sessionId && <CATRoutingLog sessionId={sessionId} />}
          </section>
        ) : (
          <>
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Session info
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">User</dt>
              <dd>
                {session.user_id && (
                  <Link
                    to={`/admin/users/${session.user_id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {session.user_name ?? session.user_id}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{formatDate(session.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Mode</dt>
              <dd className="font-medium">{session.mode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Battery</dt>
              <dd className="font-medium">
                {session.battery_id ? (
                  <Link
                    to={`/admin/users/${session.user_id}/batteries/${session.battery_id}/qc`}
                    className="text-primary hover:underline"
                  >
                    {session.battery_title ?? "Battery"} — full battery QC →
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not linked to a battery</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up stagger-2">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            RT histogram
          </h3>
          {rtTaskOptions.length > 0 ? (
            <div className="space-y-4">
              <select
                value={rtTask}
                onChange={(e) => setRtTask(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">Select task…</option>
                {rtTaskOptions.map((t) => (
                  <option key={t} value={t}>
                    {getTaskDisplayName(t)}
                  </option>
                ))}
              </select>
              {rtTask && <RtHistogram events={rtEvents} />}
              {rtTask === "cpt" && <TimeOnTaskChart events={rtEvents} />}
              {rtTask === "sst" && (
                <>
                  <SsdStuckAlert sessionId={sessionId!} hasSstEvents={rtEvents.some((e) => e.event_type === "stop")} />
                  <SsdTrajectoryChart events={rtEvents} />
                  <StopSuccessConvergenceChart events={rtEvents} />
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No RT tasks in this session</p>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up stagger-3">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Task results
          </h3>
          <div className="space-y-4">
            {session.task_results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scored tasks yet</p>
            ) : (
              session.task_results.map((tr) => (
                <div
                  key={tr.task_name}
                  className="rounded-lg border border-border/40 bg-muted/20 p-3"
                >
                  <h4 className="mb-2 font-medium">{getTaskDisplayName(tr.task_name)}</h4>
                  {OMISSION_COMMISSION_TASKS.includes(tr.task_name) && (
                    <div className="mb-3">
                      <OmissionCommissionChart metrics={tr.metrics} />
                    </div>
                  )}
                  <MainAdaptiveResultsSummary raw={tr.metrics.main_adaptive_debug} />
                  <ScoredTaskMetricsSummary metrics={tr.metrics} />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up stagger-4">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Single session QC & validity
          </h3>
          {sessionId && <QcDebugPanel sessionId={sessionId} />}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up stagger-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            ISI distribution
          </h3>
          {rawEvents.length === 0 ? (
            <div>
              <Button variant="outline" size="sm" className="inline-flex items-center gap-1" onClick={loadRawEvents}>
                <FileText className="h-3.5 w-3.5" />
                Load trial log for ISI distribution
              </Button>
            </div>
          ) : (
            <IsiHistogram events={rawEvents} />
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up stagger-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Raw trial log
          </h3>
          {rawEvents.length === 0 ? (
            <div>
              <Button variant="outline" size="sm" onClick={loadRawEvents}>
                Load trial log
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="inline-flex items-center gap-1" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
                <Button variant="ghost" size="sm" className="inline-flex items-center gap-1" onClick={() => setRawEvents([])}>
                  <X className="h-3.5 w-3.5" />
                  Close
                </Button>
              </div>
              <div className="max-h-64 overflow-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90">
                    <tr>
                      <th className="px-2 py-1 text-left">trial</th>
                      <th className="px-2 py-1 text-left">task</th>
                      <th className="px-2 py-1 text-left">RT (ms)</th>
                      <th className="px-2 py-1 text-left">correct</th>
                      <th className="px-2 py-1 text-left">event_type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rawEvents.slice(0, 200).map((e, i) => (
                      <tr key={i} className={`border-t border-border/60 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                        <td className="px-2 py-1">{e.trial_index}</td>
                        <td className="px-2 py-1">{e.task_name}</td>
                        <td className="px-2 py-1">{e.reaction_time_ms ?? "—"}</td>
                        <td className="px-2 py-1">{e.is_correct == null ? "—" : e.is_correct ? "✓" : "✗"}</td>
                        <td className="px-2 py-1 truncate max-w-[120px]">{e.event_type ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rawEvents.length > 200 && (
                <p className="text-xs text-muted-foreground">Showing first 200 of {rawEvents.length} trials. Export CSV for full data.</p>
              )}
            </div>
          )}
        </section>

        </>
        )}

        <ConfirmDialog
          open={deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(false)}
          title="Delete session"
          description="Delete this session? This will soft-delete it (data preserved but hidden from user)."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={async () => {
            if (!sessionId || !session) return;
            setDeleting(true);
            try {
              await adminSessionsService.softDeleteSession(sessionId);
              toast.success("Session deleted");
              navigate(session.user_id ? `/admin/users/${session.user_id}` : "/admin");
            } catch {
              toast.error("Failed to delete session");
            } finally {
              setDeleting(false);
            }
          }}
        />
      </div>
    </DashboardLayout>
  );
}
