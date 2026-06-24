import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  Sparkles,
  BarChart3,
  Layers,
  Brain,
  ShieldCheck,
  AlertTriangle,
  CircleHelp,
  GitCompare,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  ChangeOverTimeChart,
  DomainRadarChart,
  AggregatedDomainBarChart,
  BatteryCompositionChart,
  DomainTrendChart,
  BatteryCompareTaskPercentTable,
  buildBatteryTaskCompareRows,
  mergeReportPerTaskWithSessionTaskResults,
  orderedAssignedTestNamesForBattery,
  assignmentWeightPercentsForBatteryGroup,
  flattenLatestTaskFeedForBattery,
} from "@/components/charts";
import { Button } from "@/components/ui/Button";
import { MainAdaptiveResultsSummary } from "@/components/results/MainAdaptiveResultsSummary";
import { ScoredTaskMetricsSummary } from "@/components/results/ScoredTaskMetricsSummary";
import { getTaskDisplayName } from "@/config/tasks";
import { useAuthStore } from "@/stores/authStore";
import {
  sessionsService,
  usersMeService,
  type Assignment,
  type TaskResultItem,
  type AggregatedReport,
} from "@/services";

/* ── helpers ─────────────────────────────────────────────────────── */

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center py-2">
      <div className="flex-1 border-t border-border/60" />
      <span className="mx-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex-1 border-t border-border/60" />
    </div>
  );
}

/* ── style maps ──────────────────────────────────────────────────── */

const CAVEAT_STYLES: Record<string, string> = {
  medication: "border-blue-500/60 bg-blue-500/10",
  validity: "border-amber-500/60 bg-amber-500/10",
  device: "border-orange-500/60 bg-orange-500/10",
};

const SIGNAL_BORDER: Record<string, string> = {
  strong_flag: "border-l-rose-500",
  mild_flag: "border-l-amber-500",
  normal: "border-l-emerald-500",
};

const SIGNAL_DOT: Record<string, string> = {
  strong_flag: "bg-rose-500",
  mild_flag: "bg-amber-500",
  normal: "bg-emerald-500",
};

const SIGNAL_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  strong_flag: { bg: "bg-rose-500/20", text: "text-rose-700 dark:text-rose-400", label: "Strong Flag" },
  mild_flag: { bg: "bg-amber-500/20", text: "text-amber-700 dark:text-amber-400", label: "Mild Flag" },
  normal: { bg: "bg-emerald-500/20", text: "text-emerald-700 dark:text-emerald-400", label: "Normal" },
};

const INTERPRETATION_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  typical: { bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-700 dark:text-emerald-400", label: "Typical" },
  possible_adhd: { bg: "bg-amber-500/15 border-amber-500/40", text: "text-amber-700 dark:text-amber-400", label: "Possible ADHD" },
  strongly_consistent: { bg: "bg-rose-500/15 border-rose-500/40", text: "text-rose-700 dark:text-rose-400", label: "Strongly Consistent with ADHD" },
};

/** Battery weights stacked bar + legend (cycles for batteries with more tests than colors). */
const BATTERY_WEIGHT_SEGMENT_HEX = [
  "#AACDDC",
  "#8494FF",
  "#FFF2D0",
  "#F0FFDF",
  "#C5D89D",
  "#91C4C3",
  "#E5BEB5",
  "#DEE791",
  "#C0C9EE",
  "#E9A5F1",
  "#E8F9FF",
  "#C1BAA1",
  "#FFEEA9",
] as const;

const FRIENDLY_DOMAIN_LABELS: Record<string, string> = {
  "Reward/Impulsivity": "Impulse Control",
  "Sustained Attention": "Focus",
  "Temporal Processing": "Time Sense",
  Inhibition: "Self-Control",
  "Working Memory": "Short-Term Memory",
};

function toFriendlyDomainLabel(label: string): string {
  return FRIENDLY_DOMAIN_LABELS[label] ?? label;
}

const DOMAIN_TOOLTIP_BY_LABEL: Record<string, string> = {
  "Reward/Impulsivity": "Measures reward-driven choices and impulse control. Higher severity suggests more difficulty delaying rewards or resisting impulsive responses.",
  "Sustained Attention": "Measures focus consistency over time. This helps identify lapses in attention and performance variability during longer tasks.",
  "Temporal Processing": "Measures time estimation and timing precision. This domain reflects how accurately and consistently time intervals are perceived or reproduced.",
  Inhibition: "Measures ability to suppress automatic or incorrect responses. Higher values indicate more difficulty stopping responses when needed.",
  "Working Memory": "Measures short-term holding and manipulation of information, including forward/backward span tasks.",
};

const Z_SCORE_TOOLTIP =
  "z-score shows how far your result is from the typical range. Around 0 is close to typical, and higher absolute values mean a larger difference.";

/** SectionTitleWithInfo copy for the domain radar — rings match DomainRadarChart Z_MAX scaling. */
const OVERALL_PROFILE_SHAPE_INFO =
  "This spider chart plots each domain’s combined z-score: distance from the center is how far that score is from the age-norm average, in standard deviation (SD) units. " +
  "The guide rings labeled z = 1, 2, and 3 mean about one, two, or three SD from that average on this chart (using the size of the z-score, not its sign). " +
  "Closer to the center is closer to typical; farther toward an axis edge is a larger deviation. Values beyond |z| = 3 are drawn on the outer ring.";

/* ── small components ────────────────────────────────────────────── */

function DotOnLine({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`relative h-4 w-full ${className ?? ""}`}>
      <div className="absolute inset-0 flex rounded-full overflow-hidden">
        <div className="bg-emerald-500/25" style={{ width: "49%" }} />
        <div className="bg-amber-500/25" style={{ width: "16%" }} />
        <div className="bg-rose-500/25" style={{ width: "35%" }} />
      </div>
      <div className="absolute inset-y-0 left-0 right-0 flex items-center">
        <div className="h-0.5 w-full bg-border/60 rounded" />
      </div>
      <div
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ${
          clamped < 50 ? "bg-emerald-500" : clamped < 65 ? "bg-amber-500" : "bg-rose-500"
        }`}
        style={{ left: `${clamped}%` }}
      />
    </div>
  );
}

function fileSafeUserName(name?: string | null, email?: string | null): string {
  const base = (name?.trim() || email?.split("@")[0] || "user").trim();
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";
}

function InlineInfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <CircleHelp className="h-3.5 w-3.5 cursor-help text-muted-foreground/80" />
      <span className="pointer-events-none absolute left-1/2 top-full z-[110] mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] font-normal leading-relaxed text-popover-foreground shadow-md group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  );
}

function SectionTitleWithInfo({ title, info }: { title: string; info: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <InlineInfoTooltip text={info} />
    </div>
  );
}

function SignalLegend() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Normal
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
        Mild Flag
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
        Strong Flag
      </span>
    </div>
  );
}

/* ── types ────────────────────────────────────────────────────────── */

type SessionInfo = {
  session_id: string;
  created_at: string | null;
  mode: string;
  battery_id?: string | null;
  battery_title?: string | null;
};

type ViewTab = "aggregated" | "battery" | "ai_suggestions";

type BatteryViewMode = "single" | "compare";

function batteryGroupKey(s: SessionInfo): string {
  return s.battery_id ?? "__unassigned__";
}

function formatBatteryTitle(s: SessionInfo): string {
  if (!s.battery_id) return "Not linked to a battery";
  return (s.battery_title && s.battery_title.trim()) || "Battery";
}

/** Dropdown label for a whole battery (no dates, tasks, or session ids). */
function completeBatteryLabel(g: BatteryGroup): string {
  if (!g.battery_id) return "Not linked to a battery";
  return (g.battery_title && g.battery_title.trim()) || "Battery";
}

type BatteryGroup = {
  key: string;
  battery_id: string | null;
  battery_title: string | null;
  sessions: SessionInfo[];
};

/** Higher = more ADHD-like per overall_interpretation. */
function interpretationRank(i: string | undefined): number {
  if (i === "strongly_consistent") return 2;
  if (i === "possible_adhd") return 1;
  return 0;
}

type InterpretationTone = "supportive" | "caution" | "strong";

function getTopSummaryContent(
  interpretation: "typical" | "possible_adhd" | "strongly_consistent" | null,
  sessionCount: number,
  singleAssessmentPhrase = "from this assessment",
): {
  title: string;
  message: string;
  tone: InterpretationTone;
} {
  const sessionText =
    sessionCount > 1
      ? `across ${sessionCount} sessions`
      : singleAssessmentPhrase;

  if (interpretation === "strongly_consistent") {
    return {
      title: "Your results suggest a high likelihood of ADHD-related traits",
      message: `Your performance patterns ${sessionText} show strong indicators commonly associated with ADHD. This report supports discussion with a qualified clinician, not a standalone diagnosis.`,
      tone: "strong",
    };
  }

  if (interpretation === "possible_adhd") {
    return {
      title: "Your results suggest possible ADHD-related traits",
      message: `Your performance patterns ${sessionText} show some indicators that may be associated with ADHD. A clinician can help interpret these findings in your full medical context.`,
      tone: "caution",
    };
  }

  return {
    title: "Your results are currently within a typical range",
    message: `Your performance patterns ${sessionText} do not show a strong ADHD-like signal at this time. Continue tracking over future sessions for a clearer trend.`,
    tone: "supportive",
  };
}

type SessionReport = {
  per_task: {
    task_name: string;
    metrics: Record<string, unknown>;
    z_scores?: Record<string, unknown>;
  }[];
  domain_summary: {
    domain: string;
    label: string;
    tasks: { task_name: string; metrics: Record<string, unknown>; z_scores?: Record<string, { value: number; z_score: number }> }[];
    domain_z_score?: number;
    abnormality_probability?: number;
    severity_band?: string;
    signal?: "normal" | "mild_flag" | "strong_flag";
    signal_severity?: number;
    reliability?: string;
  }[];
  adhd_severity_index?: number;
  overall_interpretation?: "typical" | "possible_adhd" | "strongly_consistent";
  overall_interpretation_detail?: { label: string; strong_count: number; mild_count: number; normal_count: number };
  change_over_time?: {
    baseline_session_id: string;
    baseline_date: string | null;
    current_session_id: string;
    current_date: string | null;
    domains: {
      domain: string;
      label: string;
      baseline_z: number | null;
      current_z: number | null;
      delta_z: number | null;
      delta_z_corrected?: number | null;
      practice_effect?: number | null;
      ci_low: number | null;
      ci_high: number | null;
    }[];
  } | null;
  caveats: { caveat_type: string; message: string }[];
  generated_at?: string;
  narrative?: {
    summary_paragraph?: string;
    domain_narratives?: Record<string, string>;
    caveat_statements?: string[];
    footer?: string;
    narrative_fallback?: boolean;
  };
};

function BatteryComparePanel({
  reportA,
  reportB,
  loading,
  latestTaskFeedA,
  latestTaskFeedB,
  assignmentTestNamesA,
  assignmentTestNamesB,
  weightPercentByKeyA,
  weightPercentByKeyB,
}: {
  reportA: SessionReport | null;
  reportB: SessionReport | null;
  loading: boolean;
  /**
   * Per-test metrics from the most recent sessions in battery 1 that actually contain each task —
   * matches aggregated “Battery weights” logic (not only the single latest-report session).
   */
  latestTaskFeedA: { task_name: string; metrics: Record<string, unknown>; created_at: string | null }[];
  latestTaskFeedB: { task_name: string; metrics: Record<string, unknown>; created_at: string | null }[];
  /** Full roster from `/users/me/assignments` for each battery — rows shown even without % yet. */
  assignmentTestNamesA: string[];
  assignmentTestNamesB: string[];
  /** Canonical task → share (0–100) of that battery for discrete score denominators */
  weightPercentByKeyA: Map<string, number>;
  weightPercentByKeyB: Map<string, number>;
}) {
  const taskCompareRows = useMemo(
    () =>
      reportA && reportB
        ? buildBatteryTaskCompareRows(
            mergeReportPerTaskWithSessionTaskResults(reportA.per_task, latestTaskFeedA),
            mergeReportPerTaskWithSessionTaskResults(reportB.per_task, latestTaskFeedB),
            {
              assignedTestNamesA: assignmentTestNamesA,
              assignedTestNamesB: assignmentTestNamesB,
              weightPercentByKeyA: weightPercentByKeyA,
              weightPercentByKeyB: weightPercentByKeyB,
            },
          )
        : [],
    [
      reportA,
      reportB,
      latestTaskFeedA,
      latestTaskFeedB,
      assignmentTestNamesA,
      assignmentTestNamesB,
      weightPercentByKeyA,
      weightPercentByKeyB,
    ],
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="animate-pulse text-muted-foreground">Loading both assessments…</p>
      </div>
    );
  }
  if (!reportA || !reportB) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
        Choose two completed battery assessments below. Both need a scored report before comparison.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        Decision support only—not a diagnosis. Each cell uses the latest saved outcome for that test on that battery,
        blended with each run&apos;s report when helpful; pts/max uses your assignment weights.
      </p>
      <BatteryCompareTaskPercentTable
        rows={taskCompareRows}
        batteryLabel1="Battery 1 (pts/max or %)"
        batteryLabel2="Battery 2 (pts/max or %)"
        hideIntro
      />
    </div>
  );
}

/* ==================================================================
   MAIN COMPONENT
   ================================================================== */

export default function UserReport() {
  const me = useAuthStore((s) => s.me);

  /* ── shared state ─────────────────────────────────────────────── */
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [results, setResults] = useState<TaskResultItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("");
  const [tab, setTab] = useState<ViewTab>("aggregated");
  const [batteryView, setBatteryView] = useState<BatteryViewMode>("single");

  /* ── single-battery assessment (one scored session tied to that run) ─ */
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  /** Compare uses latest scored completion per whole battery (`batteryGroups[].sessions[0]`). */
  const [compareBatteryKeyA, setCompareBatteryKeyA] = useState<string | null>(null);
  const [compareBatteryKeyB, setCompareBatteryKeyB] = useState<string | null>(null);
  const [reportCompareA, setReportCompareA] = useState<SessionReport | null>(null);
  const [reportCompareB, setReportCompareB] = useState<SessionReport | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  const [report, setReport] = useState<SessionReport | null>(null);
  const [longitudinal, setLongitudinal] = useState<{
    domains?: { domain: string; delta_z: number; ci_low?: number; ci_high?: number }[];
    baseline_session_id?: string;
  } | { status: string; message: string } | null>(null);
  const [treatmentPlan, setTreatmentPlan] = useState<{
    anchor_task?: string;
    domains_to_retest?: { domain: string; z_score: number; abnormality: string }[];
    precision_reached?: boolean;
  } | null>(null);
  const [domainRanking, setDomainRanking] = useState<{ domain: string; z_score: number; abnormality: string }[] | null>(null);

  /* ── aggregated state ─────────────────────────────────────────── */
  const [aggregated, setAggregated] = useState<AggregatedReport | null>(null);
  const [aggLoading, setAggLoading] = useState(false);

  /* ── initial data fetch ───────────────────────────────────────── */
  useEffect(() => {
    Promise.all([
      usersMeService.getSessions(),
      usersMeService.getTaskResults(),
      usersMeService.getMode(),
      usersMeService.getAssignments().catch(() => ({ assignments: [], active_battery_id: null as string | null })),
    ])
      .then(([sess, res, m, asn]) => {
        setSessions(sess);
        setResults(res);
        setMode(m.mode);
        setAssignments(asn.assignments ?? []);
        if (sess.length > 0) setSelectedSessionId(sess[0].session_id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ── fetch aggregated report ──────────────────────────────────── */
  useEffect(() => {
    if (tab !== "aggregated" || sessions.length === 0) return;
    setAggLoading(true);
    usersMeService
      .getAggregatedReport()
      .then(setAggregated)
      .catch(() => setAggregated(null))
      .finally(() => setAggLoading(false));
  }, [tab, sessions.length]);

  const batteryGroups = useMemo((): BatteryGroup[] => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of sessions) {
      const k = batteryGroupKey(s);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return [...map.entries()]
      .map(([key, sess]) => ({
        key,
        battery_id: sess[0].battery_id ?? null,
        battery_title: sess[0].battery_title ?? null,
        sessions: sess,
      }))
      .sort((a, b) => {
        const ta = a.sessions[0]?.created_at ?? "";
        const tb = b.sessions[0]?.created_at ?? "";
        return tb.localeCompare(ta);
      });
  }, [sessions]);

  /* Default compare slots to two different batteries (latest completion each). */
  useEffect(() => {
    if (batteryGroups.length < 2) {
      if (batteryGroups.length === 1) {
        const k = batteryGroups[0].key;
        setCompareBatteryKeyA(k);
        setCompareBatteryKeyB(k);
      } else {
        setCompareBatteryKeyA(null);
        setCompareBatteryKeyB(null);
      }
      return;
    }
    const oldest = batteryGroups[batteryGroups.length - 1].key;
    const newest = batteryGroups[0].key;
    setCompareBatteryKeyA((prev) =>
      prev && batteryGroups.some((g) => g.key === prev) ? prev : oldest,
    );
    setCompareBatteryKeyB((prev) =>
      prev && batteryGroups.some((g) => g.key === prev) ? prev : newest,
    );
  }, [batteryGroups]);

  const compareSessionAId = useMemo(() => {
    const g = batteryGroups.find((x) => x.key === compareBatteryKeyA);
    return g?.sessions[0]?.session_id ?? null;
  }, [batteryGroups, compareBatteryKeyA]);

  const compareSessionBId = useMemo(() => {
    const g = batteryGroups.find((x) => x.key === compareBatteryKeyB);
    return g?.sessions[0]?.session_id ?? null;
  }, [batteryGroups, compareBatteryKeyB]);

  const compareAssignmentTestsA = useMemo(
    () => orderedAssignedTestNamesForBattery(assignments, compareBatteryKeyA),
    [assignments, compareBatteryKeyA],
  );
  const compareAssignmentTestsB = useMemo(
    () => orderedAssignedTestNamesForBattery(assignments, compareBatteryKeyB),
    [assignments, compareBatteryKeyB],
  );

  const compareWeightPctMapA = useMemo(
    () => assignmentWeightPercentsForBatteryGroup(assignments, compareBatteryKeyA),
    [assignments, compareBatteryKeyA],
  );
  const compareWeightPctMapB = useMemo(
    () => assignmentWeightPercentsForBatteryGroup(assignments, compareBatteryKeyB),
    [assignments, compareBatteryKeyB],
  );

  const compareBatterySessionsA = useMemo(
    () => batteryGroups.find((g) => g.key === compareBatteryKeyA)?.sessions ?? [],
    [batteryGroups, compareBatteryKeyA],
  );
  const compareBatterySessionsB = useMemo(
    () => batteryGroups.find((g) => g.key === compareBatteryKeyB)?.sessions ?? [],
    [batteryGroups, compareBatteryKeyB],
  );

  const latestCompareTaskFeedA = useMemo(
    () => flattenLatestTaskFeedForBattery(results, compareBatterySessionsA),
    [results, compareBatterySessionsA],
  );
  const latestCompareTaskFeedB = useMemo(
    () => flattenLatestTaskFeedForBattery(results, compareBatterySessionsB),
    [results, compareBatterySessionsB],
  );

  const currentBatteryGroupKey = useMemo(() => {
    const hit = sessions.find((x) => x.session_id === selectedSessionId);
    return hit ? batteryGroupKey(hit) : batteryGroups[0]?.key ?? null;
  }, [sessions, selectedSessionId, batteryGroups]);

  /* ── fetch single-battery reports ───────────────────────────────── */
  useEffect(() => {
    if (tab !== "battery" || batteryView !== "single" || !selectedSessionId) return;
    setReport(null);
    setLongitudinal(null);
    setTreatmentPlan(null);
    setDomainRanking(null);

    sessionsService.getReport(selectedSessionId).then(setReport).catch(() => setReport(null));
    sessionsService.getLongitudinal(selectedSessionId).then(setLongitudinal).catch(() => setLongitudinal(null));

    if (mode === "treatment_efficacy") {
      sessionsService.getTreatmentPlan(selectedSessionId).then(setTreatmentPlan).catch(() => setTreatmentPlan(null));
      sessionsService.getDomainRanking(selectedSessionId).then(setDomainRanking).catch(() => setDomainRanking(null));
    }
  }, [selectedSessionId, mode, tab, batteryView, sessions]);

  /* ── compare: load two scored reports ──────────────────────────── */
  useEffect(() => {
    if (tab !== "battery" || batteryView !== "compare") return;
    if (!compareSessionAId || !compareSessionBId || compareSessionAId === compareSessionBId) {
      setReportCompareA(null);
      setReportCompareB(null);
      return;
    }
    setCompareLoading(true);
    setReportCompareA(null);
    setReportCompareB(null);
    Promise.all([
      sessionsService.getReport(compareSessionAId),
      sessionsService.getReport(compareSessionBId),
    ])
      .then(([ra, rb]) => {
        setReportCompareA(ra);
        setReportCompareB(rb);
      })
      .catch(() => {
        setReportCompareA(null);
        setReportCompareB(null);
      })
      .finally(() => setCompareLoading(false));
  }, [tab, batteryView, compareSessionAId, compareSessionBId]);

  /* ── derived data ─────────────────────────────────────────────── */
  const sessionTaskResults = useMemo(
    () => results.filter((r) => r.session_id === selectedSessionId),
    [results, selectedSessionId],
  );

  const latestSessionIdForSelectedBattery = useMemo(() => {
    const g = batteryGroups.find((x) => x.key === currentBatteryGroupKey);
    return g?.sessions[0]?.session_id ?? null;
  }, [batteryGroups, currentBatteryGroupKey]);

  const isLatestForSelectedBattery =
    !!(
      selectedSessionId &&
      latestSessionIdForSelectedBattery &&
      selectedSessionId === latestSessionIdForSelectedBattery
    );

  const isLatestAssessmentOverall =
    sessions.length > 0 && selectedSessionId === sessions[0].session_id;

  const selectedSessionDate = sessions.find((s) => s.session_id === selectedSessionId)?.created_at ?? null;

  const topSummary = useMemo(() => {
    if (tab === "battery" && batteryView === "compare" && reportCompareA && reportCompareB) {
      const rankDiff =
        interpretationRank(reportCompareA.overall_interpretation) -
        interpretationRank(reportCompareB.overall_interpretation);
      if (rankDiff > 0) {
        return {
          title: "Battery 2 suggests a weaker ADHD-like pattern than battery 1",
          message:
            "Between these two complete batteries the aggregate clinical signal shifted toward typical. Discuss with your clinician—context (sleep, stress, meds, validity) matters; this is not a verdict of recovered vs not recovered on its own.",
          tone: "supportive" as const,
        };
      }
      if (rankDiff < 0) {
        return {
          title: "Battery 2 suggests a stronger ADHD-like pattern than battery 1",
          message:
            "Battery 2 aligns more strongly with ADHD-like aggregates than battery 1. Review testing conditions and clinical context.",
          tone: "caution" as const,
        };
      }
      return {
        title: "Both complete batteries sit at the same aggregate signal tier",
        message:
          "Overall interpretation category matches between selections. Use the domain table below for where change shows up.",
        tone: "supportive" as const,
      };
    }

    const interpretation =
      tab === "aggregated"
        ? (aggregated?.overall_interpretation ?? null)
        : tab === "battery" && batteryView === "single"
          ? (report?.overall_interpretation ?? null)
          : (aggregated?.overall_interpretation ?? report?.overall_interpretation ?? null);

    const sessionCount =
      tab === "aggregated"
        ? (aggregated?.session_count ?? sessions.length)
        : 1;

    const phrase =
      tab === "battery" && batteryView === "single"
        ? "from this battery assessment"
        : "from this assessment";

    return getTopSummaryContent(interpretation, sessionCount, phrase);
  }, [
    tab,
    batteryView,
    aggregated?.overall_interpretation,
    aggregated?.session_count,
    report?.overall_interpretation,
    reportCompareA?.overall_interpretation,
    reportCompareB?.overall_interpretation,
    sessions.length,
  ]);

  const showAiSuggestionsTab =
    aggregated?.overall_interpretation === "strongly_consistent" ||
    (tab === "battery" && batteryView === "single" && report?.overall_interpretation === "strongly_consistent") ||
    (tab === "battery" && batteryView === "compare" && reportCompareB?.overall_interpretation === "strongly_consistent");

  const aiSuggestionDomains = useMemo(() => {
    if (tab === "aggregated" && aggregated?.domain_summary?.length) {
      return aggregated.domain_summary
        .filter((d) => d.signal === "strong_flag" || d.signal === "mild_flag")
        .sort((a, b) => (b.signal_severity ?? 0) - (a.signal_severity ?? 0))
        .slice(0, 3)
        .map((d) => toFriendlyDomainLabel(d.label));
    }
    const dom =
      tab === "battery" && batteryView === "compare"
        ? reportCompareB?.domain_summary
        : report?.domain_summary;
    if (dom?.length) {
      return dom
        .filter((d) => d.signal === "strong_flag" || d.signal === "mild_flag")
        .sort((a, b) => (b.signal_severity ?? 0) - (a.signal_severity ?? 0))
        .slice(0, 3)
        .map((d) => toFriendlyDomainLabel(d.label));
    }
    return [];
  }, [
    tab,
    batteryView,
    aggregated?.domain_summary,
    report?.domain_summary,
    reportCompareB?.domain_summary,
  ]);

  useEffect(() => {
    if (tab === "ai_suggestions" && !showAiSuggestionsTab) {
      setTab("aggregated");
    }
  }, [tab, showAiSuggestionsTab]);

  /* ── export ───────────────────────────────────────────────────── */
  const exportAggregatedPdf = () => {
    if (!aggregated || aggregated.error) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    let y = margin + 26;

    const palette = {
      headerBg: [29, 78, 216] as const,
      headerText: [255, 255, 255] as const,
      sectionTitle: [31, 41, 55] as const,
      body: [55, 65, 81] as const,
      muted: [107, 114, 128] as const,
      cardBorder: [226, 232, 240] as const,
      cardBg: [248, 250, 252] as const,
      noteBg: [255, 247, 237] as const,
      noteBorder: [251, 191, 36] as const,
      verdictPositiveBg: [254, 226, 226] as const,
      verdictPositiveBorder: [239, 68, 68] as const,
      verdictPositiveText: [153, 27, 27] as const,
      verdictNegativeBg: [220, 252, 231] as const,
      verdictNegativeBorder: [34, 197, 94] as const,
      verdictNegativeText: [21, 128, 61] as const,
      verdictBorderlineBg: [254, 243, 199] as const,
      verdictBorderlineBorder: [245, 158, 11] as const,
      verdictBorderlineText: [146, 64, 14] as const,
    };

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - margin - 12) {
        doc.addPage();
        y = margin;
      }
    };

    const addSectionTitle = (text: string) => {
      ensureSpace(26);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...palette.sectionTitle);
      doc.text(text, margin, y);
      y += 18;
    };

    const addParagraph = (text: string, size = 10.5, color: readonly [number, number, number] = palette.body) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, contentWidth);
      ensureSpace(lines.length * (size + 3) + 6);
      doc.text(lines, margin, y);
      y += lines.length * (size + 3) + 6;
    };

    const addRow = (label: string, value: string) => {
      ensureSpace(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...palette.sectionTitle);
      doc.text(`${label}:`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...palette.body);
      doc.text(value, margin + 115, y);
      y += 15;
    };

    const toVerdict = (interpretation: string | null | undefined) => {
      if (interpretation === "strongly_consistent") {
        return {
          label: "ADHD Positive",
          subtitle: "Result pattern is strongly consistent with ADHD traits.",
          bg: palette.verdictPositiveBg,
          border: palette.verdictPositiveBorder,
          text: palette.verdictPositiveText,
        };
      }
      if (interpretation === "possible_adhd") {
        return {
          label: "Borderline / Possible ADHD",
          subtitle: "Result pattern suggests possible ADHD traits; clinical confirmation recommended.",
          bg: palette.verdictBorderlineBg,
          border: palette.verdictBorderlineBorder,
          text: palette.verdictBorderlineText,
        };
      }
      return {
        label: "ADHD Negative",
        subtitle: "Result pattern is currently within a typical range.",
        bg: palette.verdictNegativeBg,
        border: palette.verdictNegativeBorder,
        text: palette.verdictNegativeText,
      };
    };

    const drawCard = (height: number, bg: readonly [number, number, number], border: readonly [number, number, number]) => {
      ensureSpace(height + 10);
      doc.setFillColor(...bg);
      doc.setDrawColor(...border);
      doc.roundedRect(margin, y, contentWidth, height, 8, 8, "FD");
    };

    const drawDomainGraph = (rows: { label: string; value: number }[]) => {
      if (!rows.length) return;
      const chartHeight = 28 + rows.length * 18 + 22;
      ensureSpace(chartHeight + 12);
      drawCard(chartHeight, [255, 255, 255], palette.cardBorder);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...palette.sectionTitle);
      doc.text("Domain Severity Graph (0-100)", margin + 10, y + 16);

      const chartLeft = margin + 10;
      const chartRight = margin + contentWidth - 12;
      const labelWidth = 118;
      const valueWidth = 30;
      const gap = 8;
      const barStartX = chartLeft + labelWidth + gap;
      const barEndX = chartRight - valueWidth;
      const barWidth = Math.max(70, barEndX - barStartX);
      const fitLabel = (label: string) => {
        const maxW = labelWidth - 4;
        if (doc.getTextWidth(label) <= maxW) return label;
        let out = label;
        while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxW) out = out.slice(0, -1);
        return `${out}...`;
      };
      let rowY = y + 34;
      rows.forEach((r) => {
        const clamped = Math.max(0, Math.min(100, r.value));
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...palette.body);
        doc.text(fitLabel(r.label), chartLeft, rowY + 7);
        doc.setFillColor(241, 245, 249);
        doc.rect(barStartX, rowY, barWidth, 8, "F");
        doc.setFillColor(clamped < 50 ? 34 : clamped < 70 ? 245 : 239, clamped < 50 ? 197 : clamped < 70 ? 158 : 68, clamped < 50 ? 94 : clamped < 70 ? 11 : 68);
        doc.rect(barStartX, rowY, (barWidth * clamped) / 100, 8, "F");
        doc.setFontSize(8.5);
        doc.setTextColor(...palette.muted);
        doc.text(`${Math.round(clamped)}%`, chartRight, rowY + 7, { align: "right" });
        rowY += 18;
      });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...palette.muted);
      doc.text("0", barStartX, y + chartHeight - 8);
      doc.text("50", barStartX + barWidth / 2 - 4, y + chartHeight - 8);
      doc.text("100", barStartX + barWidth - 8, y + chartHeight - 8);
      y += chartHeight + 10;
    };

    // Header
    const headerHeight = 74;
    doc.setFillColor(...palette.headerBg);
    doc.roundedRect(margin, margin, contentWidth, headerHeight, 10, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...palette.headerText);
    doc.text("ADHD Results Summary", margin + 14, margin + 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text("All Sessions (Weighted) - Patient-Friendly Report", margin + 14, margin + 50);
    y = margin + headerHeight + 20;

    const verdict = toVerdict(aggregated.overall_interpretation);
    ensureSpace(68);
    doc.setFillColor(verdict.bg[0], verdict.bg[1], verdict.bg[2]);
    doc.setDrawColor(verdict.border[0], verdict.border[1], verdict.border[2]);
    doc.roundedRect(margin, y, contentWidth, 58, 10, 10, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(verdict.text[0], verdict.text[1], verdict.text[2]);
    doc.text(`Final Verdict: ${verdict.label}`, margin + 12, y + 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(verdict.subtitle, margin + 12, y + 42);
    y += 72;

    addSectionTitle("Overview");
    addParagraph(
      "This report summarizes your trends across sessions. It is meant to support discussion with a qualified clinician and is not a standalone medical diagnosis.",
      10.5,
      palette.body,
    );
    addRow("Generated", new Date().toLocaleString());
    addRow("Sessions included", String(aggregated.session_count ?? 0));
    addRow("Overall interpretation", (aggregated.overall_interpretation ?? "typical").replace(/_/g, " "));
    addRow("ADHD status", verdict.label);

    if (aggregated.overall_interpretation_detail) {
      addParagraph(
        `Signal counts: ${aggregated.overall_interpretation_detail.strong_count} strong, ` +
        `${aggregated.overall_interpretation_detail.mild_count} mild, ` +
        `${aggregated.overall_interpretation_detail.normal_count} normal.`,
        10,
        palette.muted,
      );
    }

    if (aggregated.battery_composition?.length) {
      addSectionTitle("Battery composition (each battery = 100%)");
      addParagraph(
        "Each row is one battery. Test percentages sum to 100% for that battery (clinical assignment weights).",
        9.5,
        palette.muted,
      );
      aggregated.battery_composition.forEach((bat) => {
        addParagraph(`${bat.battery_title} — total 100%`, 10.5, palette.sectionTitle);
        bat.items.forEach((it) => {
          addParagraph(
            `  ${getTaskDisplayName(it.test_name)}: ${it.weight_percent.toFixed(1)}%`,
            10,
            palette.body,
          );
        });
        y += 4;
      });
    }

    addSectionTitle("Top Summary");
    drawCard(72, palette.cardBg, palette.cardBorder);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.setTextColor(...palette.sectionTitle);
    doc.text(topSummary.title, margin + 12, y + 21);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...palette.body);
    const summaryLines = doc.splitTextToSize(topSummary.message, contentWidth - 24);
    doc.text(summaryLines, margin + 12, y + 39);
    y += 84;

    if (aggregated.domain_summary?.length) {
      addSectionTitle("Domain Breakdown");
      aggregated.domain_summary.forEach((d) => {
        const blockHeight = 58;
        drawCard(blockHeight, [255, 255, 255], palette.cardBorder);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.setTextColor(...palette.sectionTitle);
        doc.text(d.label, margin + 10, y + 18);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.8);
        doc.setTextColor(...palette.body);
        doc.text(
          `Signal: ${(d.signal ?? "normal").replace(/_/g, " ")}    ` +
          `z-score: ${d.domain_z_score != null ? d.domain_z_score.toFixed(2) : "N/A"}    ` +
          `P(abnormal): ${d.abnormality_probability != null ? `${Math.round(d.abnormality_probability * 100)}%` : "N/A"}`,
          margin + 10,
          y + 35,
        );
        doc.text(
          `Sessions: ${d.session_count ?? 0}`,
          margin + 10,
          y + 49,
        );
        y += blockHeight + 8;
      });

      drawDomainGraph(
        aggregated.domain_summary.map((d) => ({
          label: d.label,
          value:
            d.signal_severity != null
              ? d.signal_severity
              : d.domain_z_score != null
                ? Math.max(0, Math.min(100, 50 + d.domain_z_score * 15))
                : 0,
        })),
      );
    }

    if (aggregated.overall_interpretation === "strongly_consistent") {
      const focusAreas = (aggregated.domain_summary ?? [])
        .filter((d) => d.signal === "strong_flag" || d.signal === "mild_flag")
        .sort((a, b) => (b.signal_severity ?? 0) - (a.signal_severity ?? 0))
        .slice(0, 3)
        .map((d) => toFriendlyDomainLabel(d.label));

      addSectionTitle("AI Suggestions");
      drawCard(92, palette.cardBg, palette.cardBorder);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...palette.body);
      const intro = doc.splitTextToSize(
        "Supportive next steps for discussion with a qualified clinician:",
        contentWidth - 24,
      );
      doc.text(intro, margin + 12, y + 18);
      const suggestions = [
        `Top focus areas: ${focusAreas.length ? focusAreas.join(", ") : "Focus, Self-Control, Time Sense"}.`,
        "Repeat testing after adequate sleep and stable daily routine.",
        "Share this report with a clinician for full contextual interpretation.",
      ];
      suggestions.forEach((item, i) => {
        doc.text(`- ${item}`, margin + 12, y + 36 + i * 16);
      });
      y += 104;
    }

    addSectionTitle("Important Note");
    drawCard(54, palette.noteBg, palette.noteBorder);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...palette.body);
    const noteLines = doc.splitTextToSize(
      "These findings support decision-making and are not a standalone medical diagnosis. Please review this report with a qualified clinician for final diagnosis and treatment planning.",
      contentWidth - 24,
    );
    doc.text(noteLines, margin + 12, y + 22);
    y += 66;

    // Footer
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...palette.muted);
    doc.text("Generated by ADHD Platform", margin, pageHeight - 22);
    doc.text(`${new Date().toISOString().slice(0, 10)}`, pageWidth - margin - 70, pageHeight - 22);

    const userSlug = fileSafeUserName(me?.name, me?.email);
    doc.save(`adhd-results-${userSlug}-aggregated-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportSingleSessionPdf = () => {
    if (!selectedSessionId) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    let y = margin + 26;

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - margin - 12) {
        doc.addPage();
        y = margin;
      }
    };

    const addHeading = (text: string, size = 13) => {
      ensureSpace(size + 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.setTextColor(31, 41, 55);
      doc.text(text, margin, y);
      y += size + 8;
    };

    const addParagraph = (text: string, size = 10.5) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(55, 65, 81);
      const lines = doc.splitTextToSize(text, contentWidth);
      ensureSpace(lines.length * (size + 3) + 6);
      doc.text(lines, margin, y);
      y += lines.length * (size + 3) + 6;
    };

    type PdfGraphRow = { label: string; value: number; kind?: "severity" | "confidence" };

    const barColorForValue = (value: number, kind: PdfGraphRow["kind"]) => {
      const clamped = Math.max(0, Math.min(100, value));
      if (kind === "confidence") {
        if (clamped >= 75) return [34, 197, 94] as const;
        if (clamped >= 60) return [245, 158, 11] as const;
        return [239, 68, 68] as const;
      }
      if (clamped < 50) return [34, 197, 94] as const;
      if (clamped < 70) return [245, 158, 11] as const;
      return [239, 68, 68] as const;
    };

    const drawDomainGraph = (rows: PdfGraphRow[]) => {
      if (!rows.length) return;
      const chartHeight = 28 + rows.length * 18 + 22;
      ensureSpace(chartHeight + 12);
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, y, contentWidth, chartHeight, 8, 8, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(31, 41, 55);
      const chartTitle = rows.every((r) => r.kind === "confidence")
        ? "Data Quality Overview (0-100)"
        : "Domain Severity Graph (0-100)";
      doc.text(chartTitle, margin + 10, y + 16);

      const chartLeft = margin + 10;
      const chartRight = margin + contentWidth - 12;
      const labelWidth = 118;
      const valueWidth = 30;
      const gap = 8;
      const barStartX = chartLeft + labelWidth + gap;
      const barEndX = chartRight - valueWidth;
      const barWidth = Math.max(70, barEndX - barStartX);
      const fitLabel = (label: string) => {
        const maxW = labelWidth - 4;
        if (doc.getTextWidth(label) <= maxW) return label;
        let out = label;
        while (out.length > 1 && doc.getTextWidth(`${out}...`) > maxW) out = out.slice(0, -1);
        return `${out}...`;
      };
      let rowY = y + 34;
      rows.forEach((r) => {
        const clamped = Math.max(0, Math.min(100, r.value));
        const [br, bg, bb] = barColorForValue(clamped, r.kind ?? "severity");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(55, 65, 81);
        doc.text(fitLabel(r.label), chartLeft, rowY + 7);
        doc.setFillColor(241, 245, 249);
        doc.rect(barStartX, rowY, barWidth, 8, "F");
        doc.setFillColor(br, bg, bb);
        doc.rect(barStartX, rowY, (barWidth * clamped) / 100, 8, "F");
        doc.setFontSize(8.5);
        doc.setTextColor(107, 114, 128);
        doc.text(`${Math.round(clamped)}%`, chartRight, rowY + 7, { align: "right" });
        rowY += 18;
      });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(107, 114, 128);
      doc.text("0", barStartX, y + chartHeight - 8);
      doc.text("50", barStartX + barWidth / 2 - 4, y + chartHeight - 8);
      doc.text("100", barStartX + barWidth - 8, y + chartHeight - 8);
      y += chartHeight + 10;
    };

    const toSingleSessionGraphRows = (): PdfGraphRow[] => {
      if (report?.domain_summary?.length) {
        return report.domain_summary.map((d) => ({
          label: d.label,
          kind: "severity" as const,
          value:
            d.signal_severity != null
              ? d.signal_severity
              : d.domain_z_score != null
                ? Math.max(0, Math.min(100, 50 + d.domain_z_score * 15))
                : 0,
        }));
      }

      const taskRows = sessionTaskResults
        .map((r) => {
          const numericValues = Object.values(r.metrics || {}).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
          if (!numericValues.length) return null;
          const avg = numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;
          return {
            label: getTaskDisplayName(r.task_name),
            kind: "severity" as const,
            value: Math.max(0, Math.min(100, avg)),
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .slice(0, 8);

      if (taskRows.length) return taskRows;

      return [];
    };

    // Header card
    doc.setFillColor(29, 78, 216);
    doc.roundedRect(margin, margin, contentWidth, 72, 10, 10, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text("ADHD Battery Assessment Report", margin + 14, margin + 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text("Single Battery Completion - Patient-Friendly Summary", margin + 14, margin + 50);
    y = margin + 92;

    const sessionDate = sessions.find((s) => s.session_id === selectedSessionId)?.created_at ?? null;
    const interpretation = report?.overall_interpretation
      ? report.overall_interpretation.replace(/_/g, " ")
      : "not available";

    addHeading("Overview");
    addParagraph(`Generated: ${new Date().toLocaleString()}`);
    addParagraph(`Session date: ${formatDate(sessionDate)}`);
    addParagraph(`Overall interpretation: ${interpretation}`);

    if (report?.narrative?.summary_paragraph) {
      addHeading("Summary");
      addParagraph(report.narrative.summary_paragraph);
    }

    if (report?.domain_summary?.length) {
      addHeading("Domain Breakdown");
      report.domain_summary.forEach((d) => {
        ensureSpace(56);
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(margin, y, contentWidth, 50, 8, 8, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(31, 41, 55);
        doc.text(d.label, margin + 10, y + 17);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.8);
        doc.setTextColor(55, 65, 81);
        doc.text(
          `Signal: ${(d.signal ?? "normal").replace(/_/g, " ")}    z-score: ${d.domain_z_score != null ? d.domain_z_score.toFixed(2) : "N/A"}    P(abnormal): ${d.abnormality_probability != null ? `${Math.round(d.abnormality_probability * 100)}%` : "N/A"}`,
          margin + 10,
          y + 33,
        );
        y += 58;
      });

    }

    const graphRows = toSingleSessionGraphRows();
    if (graphRows.length > 0) {
      addHeading("Session Graph");
      drawDomainGraph(graphRows);
    }

    if (report?.overall_interpretation === "strongly_consistent") {
      const focusAreas = (report.domain_summary ?? [])
        .filter((d) => d.signal === "strong_flag" || d.signal === "mild_flag")
        .sort((a, b) => (b.signal_severity ?? 0) - (a.signal_severity ?? 0))
        .slice(0, 3)
        .map((d) => toFriendlyDomainLabel(d.label));

      addHeading("AI Suggestions");
      addParagraph("Supportive next steps for discussion with a qualified clinician:");
      addParagraph(`- Top focus areas: ${focusAreas.length ? focusAreas.join(", ") : "Focus, Self-Control, Time Sense"}.`, 10);
      addParagraph("- Repeat testing after adequate sleep and stable routine.", 10);
      addParagraph("- Review these findings with a clinician for final diagnosis.", 10);
    }

    if (sessionTaskResults.length) {
      addHeading("Task Results");
      sessionTaskResults.forEach((r) => {
        ensureSpace(40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(31, 41, 55);
        doc.text(getTaskDisplayName(r.task_name), margin, y);
        y += 14;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(55, 65, 81);
        const metricText = Object.entries(r.metrics || {})
          .slice(0, 6)
          .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" ? v.toFixed(2) : String(v)}`)
          .join(" | ");
        addParagraph(metricText || "No metrics available.", 9.5);
      });
    }

    addHeading("Important Note", 12);
    addParagraph("This report supports decision-making and does not replace a formal clinical diagnosis.");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text("Generated by ADHD Platform", margin, pageHeight - 22);
    doc.text(`${new Date().toISOString().slice(0, 10)}`, pageWidth - margin - 70, pageHeight - 22);

    const userSlug = fileSafeUserName(me?.name, me?.email);
    doc.save(`adhd-results-${userSlug}-battery-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  if (!me) return null;

  /* ==================================================================
     RENDER
     ================================================================== */
  return (
    <DashboardLayout title="My Results">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          <Link to="/user" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </p>

        {/* Medical disclaimer */}
        <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            Decision Support Only — Not a Medical Diagnosis
          </p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
            These results are for informational and decision-support purposes only. They do not constitute a medical diagnosis. Consult a qualified healthcare professional for clinical assessment.
          </p>
        </div>

        {/* Top summary card */}
        {results.length > 0 && (
          <div
            className={`rounded-xl border p-5 shadow-sm animate-fade-in ${
              topSummary.tone === "strong"
                ? "border-rose-500/50 bg-gradient-to-r from-rose-500/10 via-card to-rose-500/5"
                : topSummary.tone === "caution"
                  ? "border-amber-500/50 bg-gradient-to-r from-amber-500/10 via-card to-amber-500/5"
                  : "border-emerald-500/50 bg-gradient-to-r from-emerald-500/10 via-card to-emerald-500/5"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 rounded-lg p-2 ${
                  topSummary.tone === "strong"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                    : topSummary.tone === "caution"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {topSummary.tone === "strong" ? (
                  <AlertTriangle className="h-5 w-5" />
                ) : topSummary.tone === "caution" ? (
                  <Brain className="h-5 w-5" />
                ) : (
                  <ShieldCheck className="h-5 w-5" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold text-foreground">
                  {topSummary.title}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {topSummary.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setTab("aggregated")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === "aggregated"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            All Sessions (Weighted)
          </button>
          <button
            onClick={() => setTab("battery")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === "battery"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Single Battery
          </button>
          {showAiSuggestionsTab && (
            <button
              onClick={() => setTab("ai_suggestions")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                tab === "ai_suggestions"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Suggestions
            </button>
          )}

          {/* Single battery: view mode + selectors */}
          {tab === "battery" && sessions.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => setBatteryView("single")}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    batteryView === "single"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  One battery
                </button>
                <button
                  type="button"
                  onClick={() => setBatteryView("compare")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    batteryView === "compare"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <GitCompare className="h-3 w-3" />
                  Compare
                </button>
              </div>
              {batteryView === "single" && (
                <>
                  <select
                    value={currentBatteryGroupKey ?? ""}
                    onChange={(e) => {
                      const g = batteryGroups.find((x) => x.key === e.target.value);
                      if (g?.sessions[0]) setSelectedSessionId(g.sessions[0].session_id);
                    }}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {batteryGroups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {(g.battery_title && g.battery_title.trim()) || (g.battery_id ? "Battery" : "Not linked to a battery")}{" "}
                        · {g.sessions.length} run{g.sessions.length !== 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const g = batteryGroups.find((x) => x.key === currentBatteryGroupKey);
                    if (!g || g.sessions.length <= 1) return null;
                    return (
                      <select
                        value={selectedSessionId ?? ""}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        title="Which completion of this battery"
                      >
                        {g.sessions.map((s) => (
                          <option key={s.session_id} value={s.session_id}>
                            {formatDate(s.created_at)}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </>
              )}
              {batteryView === "compare" && batteryGroups.length >= 2 && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Battery 1
                    <select
                      value={compareBatteryKeyA ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCompareBatteryKeyA(v);
                        if (v === compareBatteryKeyB) {
                          const alt = batteryGroups.find((g) => g.key !== v);
                          if (alt) setCompareBatteryKeyB(alt.key);
                        }
                      }}
                      className="min-w-[10rem] rounded-lg border border-input bg-background px-2 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {batteryGroups.map((g) => (
                        <option key={`a-${g.key}`} value={g.key}>
                          {completeBatteryLabel(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Battery 2
                    <select
                      value={compareBatteryKeyB ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCompareBatteryKeyB(v);
                        if (v === compareBatteryKeyA) {
                          const alt = batteryGroups.find((g) => g.key !== v);
                          if (alt) setCompareBatteryKeyA(alt.key);
                        }
                      }}
                      className="min-w-[10rem] rounded-lg border border-input bg-background px-2 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {batteryGroups.map((g) => (
                        <option key={`b-${g.key}`} value={g.key}>
                          {completeBatteryLabel(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="max-w-xs pb-2 text-[11px] leading-snug text-muted-foreground">
                    Whole batteries only—uses each battery’s latest scored completion (not separate tests).
                  </span>
                </div>
              )}
              {batteryView === "compare" && batteryGroups.length < 2 && (
                <span className="text-xs text-muted-foreground">
                  Two different batteries are required to compare.
                </span>
              )}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="ml-auto inline-flex items-center gap-1.5"
            disabled={
              tab === "aggregated"
                ? !aggregated || !!aggregated.error
                : tab === "battery" && batteryView === "single"
                  ? !report && sessionTaskResults.length === 0
                : tab === "battery" && batteryView === "compare"
                  ? compareLoading ||
                    !reportCompareA ||
                    !reportCompareB ||
                    !compareBatteryKeyA ||
                    !compareBatteryKeyB ||
                    compareBatteryKeyA === compareBatteryKeyB
                  : true
            }
            onClick={tab === "aggregated" ? exportAggregatedPdf : exportSingleSessionPdf}
          >
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>

        {/* Loading / empty */}
        {loading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="animate-pulse text-muted-foreground">Loading results…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
            <p className="text-muted-foreground">No results yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete assigned tests from your{" "}
              <Link to="/user" className="text-primary hover:underline">dashboard</Link>{" "}
              to see results here.
            </p>
          </div>
        ) : tab === "aggregated" ? (
          /* ============================================================
             AGGREGATED VIEW
             ============================================================ */
          aggLoading ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="animate-pulse text-muted-foreground">Computing aggregated report…</p>
            </div>
          ) : aggregated && !aggregated.error ? (
            <div className="space-y-6">
              {/* Info banner */}
              <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                <p className="font-semibold text-foreground">
                  Weighted mean across {aggregated.session_count} session{aggregated.session_count !== 1 ? "s" : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Combined scores blend your sessions over time (recent sessions count more; 30-day half-life).
                  The Battery weights section shows each battery as its own 100% split across tests—not one battery competing with another for “total %”.
                  Use “Single Battery” for one assigned battery/completion view, or Compare for two assessments.
                </p>
              </div>

              {/* Overall interpretation */}
              {aggregated.overall_interpretation && (
                <>
                  <SectionDivider label="Overall Signal" />
                  <div className="rounded-xl border border-border/60 bg-card p-4 animate-fade-in-up">
                    <div className="flex flex-wrap items-center gap-3">
                      {(() => {
                        const badge = INTERPRETATION_BADGE[aggregated.overall_interpretation] ?? INTERPRETATION_BADGE.typical;
                        return (
                          <span className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                      {aggregated.overall_interpretation_detail && (
                        <span className="text-xs text-muted-foreground">
                          {aggregated.overall_interpretation_detail.strong_count} strong flag{aggregated.overall_interpretation_detail.strong_count !== 1 ? "s" : ""},
                          {" "}{aggregated.overall_interpretation_detail.mild_count} mild flag{aggregated.overall_interpretation_detail.mild_count !== 1 ? "s" : ""},
                          {" "}{aggregated.overall_interpretation_detail.normal_count} normal
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Based on weighted aggregation of domain z-scores across all sessions.
                    </p>
                  </div>
                </>
              )}

              {/* Domain bar chart */}
              {aggregated.domain_summary.length > 0 && (
                <>
                  <SectionDivider label="Domain Severity" />
                  <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm animate-fade-in">
                    <SectionTitleWithInfo
                      title="Overall Domain Scores"
                      info="This graph compares your key thinking and behavior areas across all sessions. It helps show which areas need the most attention."
                    />
                    <AggregatedDomainBarChart domains={aggregated.domain_summary.map((d) => ({ ...d, label: toFriendlyDomainLabel(d.label) }))} />
                  </div>
                </>
              )}

              {/* Domain cards */}
              {aggregated.domain_summary.length > 0 && (
                <>
                  <SectionDivider label="Domain Details" />
                  <SignalLegend />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {aggregated.domain_summary.map((d, i) => {
                      const signalKey = d.signal ?? "normal";
                      const signalBorder = SIGNAL_BORDER[signalKey] ?? "";
                      const badge = SIGNAL_BADGE[signalKey] ?? SIGNAL_BADGE.normal;
                      return (
                        <div
                          key={d.domain}
                          className={`rounded-xl border border-border/60 bg-card p-4 shadow-sm ${signalBorder ? `border-l-4 ${signalBorder}` : ""} animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block h-2.5 w-2.5 rounded-full ${SIGNAL_DOT[signalKey] ?? "bg-muted"}`} />
                              <h4 className="text-sm font-semibold text-foreground">{toFriendlyDomainLabel(d.label)}</h4>
                              {DOMAIN_TOOLTIP_BY_LABEL[d.label] && <InlineInfoTooltip text={DOMAIN_TOOLTIP_BY_LABEL[d.label]} />}
                            </div>
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          </div>
                          {d.signal_severity != null && (
                            <div className="mb-2">
                              <DotOnLine value={d.signal_severity} />
                              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>0</span>
                                <span>Severity: {d.signal_severity.toFixed(0)}</span>
                                <span>100</span>
                              </div>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 text-xs">
                            {d.domain_z_score != null && (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                z = {d.domain_z_score.toFixed(2)}
                                <InlineInfoTooltip text={Z_SCORE_TOOLTIP} />
                              </span>
                            )}
                            {d.abnormality_probability != null && (
                              <span className="text-muted-foreground">P(abn) = {(d.abnormality_probability * 100).toFixed(0)}%</span>
                            )}
                            <span className="text-muted-foreground">{d.session_count} session{d.session_count !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Radar chart */}
              {aggregated.domain_summary.filter((d) => d.domain_z_score != null).length >= 3 && (
                <>
                  <SectionDivider label="Profile" />
                  <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm animate-fade-in">
                    <SectionTitleWithInfo
                      title="Overall Profile Shape"
                      info={OVERALL_PROFILE_SHAPE_INFO}
                    />
                    <DomainRadarChart
                      domains={aggregated.domain_summary.map((d) => ({
                        label: toFriendlyDomainLabel(d.label),
                        z_score: d.domain_z_score,
                        abnormality_probability: d.abnormality_probability,
                      }))}
                    />
                  </div>
                </>
              )}

              {/* Domain trend lines */}
              {aggregated.session_breakdown.length >= 2 && (
                <>
                  <SectionDivider label="Trends Over Sessions" />
                  <div className="space-y-4">
                    {aggregated.domain_summary.map((d) => {
                      const points = aggregated.session_breakdown
                        .filter((sb) => sb.domain_z_scores[d.domain] != null)
                        .map((sb) => ({
                          session_id: sb.session_id,
                          created_at: sb.created_at,
                          z_score: sb.domain_z_scores[d.domain],
                          weight: sb.weight,
                        }));
                      if (points.length < 2) return null;
                      return (
                        <div key={d.domain} className="rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in">
                          <DomainTrendChart domain={d.domain} label={d.label} points={points} />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Battery composition: each battery = 100% across its tests */}
              {aggregated.battery_composition && aggregated.battery_composition.length > 0 && (
                <>
                  <SectionDivider label="Battery weights" />
                  <div className="overflow-visible rounded-xl border border-border/60 bg-card p-5 shadow-sm animate-fade-in">
                    <SectionTitleWithInfo
                      title="Weight by test (each battery = 100%)"
                      info="Each row shows scored tests vs assigned tests (e.g. 7/7). Strip segments are weight share only."
                    />
                    <BatteryCompositionChart
                      batteries={aggregated.battery_composition}
                      segmentColors={[...BATTERY_WEIGHT_SEGMENT_HEX]}
                    />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {aggregated?.battery_composition && aggregated.battery_composition.length > 0 && (
                <div className="overflow-visible rounded-xl border border-border/60 bg-card p-5 shadow-sm">
                  <SectionDivider label="Battery weights" />
                  <SectionTitleWithInfo
                    title="Weight by test (each battery = 100%)"
                    info="Each battery row shows scored tests vs assigned (e.g. 7/7). Percentages are clinician weights."
                  />
                  <BatteryCompositionChart
                    batteries={aggregated.battery_composition}
                    segmentColors={[...BATTERY_WEIGHT_SEGMENT_HEX]}
                  />
                </div>
              )}
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center">
                <p className="text-muted-foreground">
                  {aggregated?.error ?? "No scored sessions available for aggregation."}
                </p>
              </div>
            </div>
          )
        ) : tab === "battery" && batteryView === "compare" ? (
          batteryGroups.length < 2 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
              You need two different batteries with scored results to compare complete batteries.
            </div>
          ) : (
            <BatteryComparePanel
              reportA={reportCompareA}
              reportB={reportCompareB}
              loading={compareLoading}
              latestTaskFeedA={latestCompareTaskFeedA}
              latestTaskFeedB={latestCompareTaskFeedB}
              assignmentTestNamesA={compareAssignmentTestsA}
              assignmentTestNamesB={compareAssignmentTestsB}
              weightPercentByKeyA={compareWeightPctMapA}
              weightPercentByKeyB={compareWeightPctMapB}
            />
          )
        ) : tab === "ai_suggestions" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
              <h3 className="text-base font-semibold text-foreground">AI Suggestions</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                These suggestions are supportive next steps for discussion with a qualified clinician. They are not a standalone diagnosis or treatment plan.
              </p>
            </div>

            {aiSuggestionDomains.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
                <p className="text-sm font-medium text-foreground">Top focus areas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {aiSuggestionDomains.map((d) => (
                    <span key={d} className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
              <p className="text-sm font-medium text-foreground">Suggested actions</p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                <li>Repeat testing after adequate sleep and stable routine for better trend confidence.</li>
                <li>Review focus, inhibition, and timing patterns with a clinician using this report.</li>
                <li>Track daily symptom impact (work/study/home) for 1-2 weeks before follow-up.</li>
                <li>Consider completing all assigned tasks in one sitting when possible for cleaner interpretation.</li>
              </ul>
            </div>
          </div>
        ) : tab === "battery" && batteryView === "single" ? (
          /* ============================================================
             SINGLE BATTERY (one scored completion — session record)
             ============================================================ */
          <div className="space-y-6">
            {/* Battery assessment label */}
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                isLatestForSelectedBattery ? "border-primary/30 bg-primary/5" : "border-border/60 bg-muted/30"
              }`}
            >
              <p className="font-semibold text-foreground">
                {(() => {
                  const s = sessions.find((x) => x.session_id === selectedSessionId);
                  const title = s ? formatBatteryTitle(s) : "Battery assessment";
                  return `${title} — ${formatDate(selectedSessionDate)}`;
                })()}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isLatestForSelectedBattery
                  ? "This is the newest scored completion for this battery. Use Battery + date to switch runs."
                  : "Older completion on this battery. Pick another run above if multiple exist."}{" "}
                {!isLatestAssessmentOverall && (
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Your newest assessment overall uses a different visit—keep that in mind for recovery tracking.
                  </span>
                )}
              </p>
            </div>

            {/* AI narrative */}
            {report?.narrative && !report.narrative.narrative_fallback && report.narrative.summary_paragraph && (
              <>
                <SectionDivider label="AI Interpretation" />
                <div className="rounded-xl border border-border/60 bg-card p-4 overflow-hidden animate-fade-in-up">
                  <div className="-mx-4 -mt-4 mb-4 h-1 bg-gradient-to-r from-primary/60 via-accent/40 to-primary/60" />
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      <Sparkles className="h-3 w-3" />
                      AI-assisted interpretation
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{report.narrative.summary_paragraph}</p>
                </div>
              </>
            )}

            {/* Signal summary */}
            {report?.overall_interpretation && (
              <>
                <SectionDivider label="Signal Summary" />
                <div className="rounded-xl border border-border/60 bg-card p-4 animate-fade-in-up">
                  <div className="flex flex-wrap items-center gap-3">
                    {(() => {
                      const badge = INTERPRETATION_BADGE[report.overall_interpretation] ?? INTERPRETATION_BADGE.typical;
                      return (
                        <span className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
                    {report.overall_interpretation_detail && (
                      <span className="text-xs text-muted-foreground">
                        {report.overall_interpretation_detail.strong_count} strong flag{report.overall_interpretation_detail.strong_count !== 1 ? "s" : ""},
                        {" "}{report.overall_interpretation_detail.mild_count} mild flag{report.overall_interpretation_detail.mild_count !== 1 ? "s" : ""},
                        {" "}{report.overall_interpretation_detail.normal_count} normal
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    ADHD consistency interpretation for this battery completion based on domain signal patterns.
                  </p>
                </div>
              </>
            )}

            {/* Caveats */}
            {report?.caveats && report.caveats.length > 0 && (
              <>
                <SectionDivider label="Caveats" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Context caveats</p>
                  {report.caveats.map((c, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-4 py-2 text-sm animate-fade-in stagger-${Math.min(i + 1, 8)} ${CAVEAT_STYLES[c.caveat_type] ?? "border-muted bg-muted/30"}`}
                    >
                      {c.message}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Domain cards */}
            {report?.domain_summary && report.domain_summary.length > 0 && (
              <>
                <SectionDivider label="Domains" />
                <SignalLegend />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {report.domain_summary.map((d, i) => {
                    const keyMetrics = d.tasks.flatMap((t) =>
                      Object.entries(t.metrics)
                        .filter(([k]) => ["mean_rt", "median_rt", "omission_rate", "commission_rate", "ssrt_ms", "max_forward_span", "max_backward_span"].includes(k))
                        .slice(0, 2)
                    );
                    const domainNarrative = report.narrative && !report.narrative.narrative_fallback && report.narrative.domain_narratives?.[d.domain];
                    const signalKey = d.signal ?? "normal";
                    const signalBorder = SIGNAL_BORDER[signalKey] ?? "";
                    const badge = SIGNAL_BADGE[signalKey] ?? SIGNAL_BADGE.normal;
                    return (
                      <div
                        key={d.domain}
                        className={`rounded-xl border border-border/60 bg-card p-4 shadow-sm ${signalBorder ? `border-l-4 ${signalBorder}` : ""} animate-fade-in-up stagger-${Math.min(i + 1, 8)}`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block h-2.5 w-2.5 rounded-full ${SIGNAL_DOT[signalKey] ?? "bg-muted"}`} />
                            <h4 className="text-sm font-semibold text-foreground">{toFriendlyDomainLabel(d.label)}</h4>
                            {DOMAIN_TOOLTIP_BY_LABEL[d.label] && <InlineInfoTooltip text={DOMAIN_TOOLTIP_BY_LABEL[d.label]} />}
                          </div>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </div>
                        {d.signal_severity != null && (
                          <div className="mb-2">
                            <DotOnLine value={d.signal_severity} />
                            <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>0</span>
                              <span>Severity: {d.signal_severity.toFixed(0)}</span>
                              <span>100</span>
                            </div>
                          </div>
                        )}
                        <div className="mb-2 flex flex-wrap gap-2 text-xs">
                          {d.domain_z_score != null && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              z = {d.domain_z_score}
                              <InlineInfoTooltip text={Z_SCORE_TOOLTIP} />
                            </span>
                          )}
                          {d.abnormality_probability != null && (
                            <span className="text-muted-foreground">P(abn) = {(d.abnormality_probability * 100).toFixed(0)}%</span>
                          )}
                          {d.reliability && (
                            <span className={`rounded px-1.5 py-0.5 ${
                              d.reliability === "High" ? "bg-emerald-500/10 text-emerald-600" :
                              d.reliability === "Medium" ? "bg-amber-500/10 text-amber-600" :
                              "bg-rose-500/10 text-rose-600"
                            }`}>{d.reliability} reliability</span>
                          )}
                        </div>
                        {domainNarrative && (
                          <p className="mb-2 text-sm leading-relaxed text-foreground/90">{domainNarrative}</p>
                        )}
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {keyMetrics.slice(0, 4).map(([k, v], mi) => (
                            <p key={mi}>{k.replace(/_/g, " ")}: {typeof v === "number" ? v.toFixed(2) : String(v)}</p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Radar chart */}
            {report?.domain_summary && report.domain_summary.filter((d) => d.domain_z_score != null).length >= 3 && (
              <>
                <SectionDivider label="Charts" />
                <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in">
                  <h4 className="mb-2 text-sm font-semibold">Domain Profile</h4>
                  <DomainRadarChart
                    domains={report.domain_summary.map((d) => ({
                      label: toFriendlyDomainLabel(d.label),
                      z_score: d.domain_z_score ?? null,
                      abnormality_probability: d.abnormality_probability ?? null,
                    }))}
                  />
                </div>
              </>
            )}

            {/* Change over time */}
            {report?.change_over_time && report.change_over_time.domains.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm animate-fade-in">
                <h4 className="mb-1 text-sm font-semibold">Progress Since Baseline</h4>
                <p className="mb-3 text-xs text-muted-foreground">
                  This chart compares current scores with your baseline. Negative Δz means improvement and positive Δz means worsening. Lines show confidence ranges.
                </p>
                <ChangeOverTimeChart
                  domains={report.change_over_time.domains}
                  baselineDate={report.change_over_time.baseline_date}
                  currentDate={report.change_over_time.current_date}
                />
              </div>
            )}

            {/* Longitudinal fallback */}
            {longitudinal && "domains" in longitudinal && longitudinal.domains && longitudinal.domains.length > 0 && !report?.change_over_time && (
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in">
                <h4 className="mb-2 text-sm font-semibold">Change from Baseline</h4>
                <p className="mb-3 text-xs text-muted-foreground">Δz per domain vs baseline. Negative = improvement.</p>
                <ul className="space-y-2">
                  {longitudinal.domains.map((d) => (
                    <li key={d.domain} className="flex justify-between rounded border border-border/40 bg-muted/20 px-3 py-2 text-sm">
                      <span className="font-medium capitalize">{d.domain.replace(/_/g, " ")}</span>
                      <span className={d.delta_z != null && d.delta_z > 0 ? "text-amber-600" : d.delta_z != null && d.delta_z < 0 ? "text-emerald-600" : "text-muted-foreground"}>
                        Δz = {d.delta_z != null ? d.delta_z.toFixed(2) : "—"}
                        {d.ci_low != null && d.ci_high != null && ` [${d.ci_low.toFixed(2)}, ${d.ci_high.toFixed(2)}]`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Treatment plan */}
            {treatmentPlan && (treatmentPlan.domains_to_retest?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in">
                <h4 className="mb-2 text-sm font-semibold">Suggested Follow-Up (Treatment Mode)</h4>
                <p className="mb-3 text-xs text-muted-foreground">Top domains to retest based on current abnormality.</p>
                <ul className="space-y-2">
                  {treatmentPlan.domains_to_retest?.map((d) => (
                    <li key={d.domain} className="rounded border border-border/40 bg-muted/20 px-3 py-2 text-sm">
                      <span className="font-medium capitalize">{d.domain.replace(/_/g, " ")}</span>
                      <span className="ml-2 text-muted-foreground">z={d.z_score != null ? d.z_score.toFixed(2) : "—"} • {d.abnormality}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Domain ranking */}
            {domainRanking && domainRanking.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in">
                <h4 className="mb-2 text-sm font-semibold">Domain Abnormality Ranking</h4>
                <p className="mb-3 text-xs text-muted-foreground">Domains ranked by severity (highest concern first).</p>
                <ol className="list-inside list-decimal space-y-2">
                  {domainRanking.map((d) => (
                    <li key={d.domain} className="rounded border border-border/40 bg-muted/20 px-3 py-2 text-sm">
                      <span className="font-medium capitalize">{d.domain.replace(/_/g, " ")}</span>
                      <span className="ml-2 text-muted-foreground">z={d.z_score != null ? d.z_score.toFixed(2) : "—"} • {d.abnormality}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Task results for this session */}
            <SectionDivider label="Task Results" />
            {sessionTaskResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">No task results for this session.</p>
            ) : (
              sessionTaskResults.map((r, idx) => (
                <article
                  key={`${r.session_id}-${r.task_name}-${idx}`}
                  className={`rounded-xl border border-border/60 bg-card p-4 shadow-sm animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-foreground">{getTaskDisplayName(r.task_name)}</h3>
                    <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                  </div>
                  <MainAdaptiveResultsSummary raw={r.metrics.main_adaptive_debug} />
                  <ScoredTaskMetricsSummary metrics={r.metrics} />
                </article>
              ))
            )}
          </div>
        )
        : null}

      </div>
    </DashboardLayout>
  );
}
