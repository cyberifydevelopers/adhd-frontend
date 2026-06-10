import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { adminCatConfigService, type CATDecisionItem } from "@/services";
import { getTaskDisplayName } from "@/config/tasks";

const DOMAIN_LABELS: Record<string, string> = {
  sustained_attention: "Sustained Attention",
  inhibition: "Inhibition",
  executive_function: "Executive Function",
  working_memory: "Working Memory",
  temporal_processing: "Temporal Processing",
  reward_impulsivity: "Reward/Impulsivity",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getOutcomeColor(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "border-muted bg-muted/30";
  if (parsed.stop_battery === true) return "border-rose-500/60 bg-rose-500/10";
  if (parsed.extend_current_task === true) return "border-amber-500/60 bg-amber-500/10";
  if (parsed.next_task) return "border-blue-500/60 bg-blue-500/10";
  return "border-emerald-500/60 bg-emerald-500/10";
}

function getOutcomeLabel(parsed: Record<string, unknown> | null): string {
  if (!parsed) return "Unknown";
  if (parsed.stop_battery === true) return "Stop battery";
  if (parsed.extend_current_task === true) return `Extend (+${parsed.trials_to_add ?? 0} trials)`;
  if (parsed.next_task) return `Next: ${getTaskDisplayName(String(parsed.next_task))}`;
  return "Continue";
}

function DomainConfidenceChart({ domainMap }: { domainMap: Record<string, number> }) {
  const entries = Object.entries(domainMap).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Domain confidence</p>
      <div className="space-y-1">
        {entries.map(([domain, val]) => (
          <div key={domain} className="flex items-center gap-2">
            <span className="w-36 truncate text-xs">{DOMAIN_LABELS[domain] ?? domain}</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary/70 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, val * 100))}%` }}
              />
            </div>
            <span className="w-8 text-right text-xs font-medium">{(val * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionCard({ decision }: { decision: CATDecisionItem }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = decision.parsed_decision_json as Record<string, unknown> | null;
  const reasoning = parsed?.reasoning as string | undefined;
  const domainMap = (parsed?.domain_confidence_map as Record<string, number>) ?? {};

  return (
    <div className={`rounded-lg border p-3 transition-colors ${getOutcomeColor(parsed)}`}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs text-muted-foreground">{formatDate(decision.created_at)}</span>
        <span className="text-xs font-medium">
          {decision.task_completed ? getTaskDisplayName(decision.task_completed) : "—"} → {decision.decision_trigger}
        </span>
        <span className="ml-auto rounded px-2 py-0.5 text-xs font-medium">{getOutcomeLabel(parsed)}</span>
        {decision.used_fallback && (
          <span className="rounded bg-amber-500/30 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
            Fallback
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
          {decision.llm_model && (
            <p className="text-xs text-muted-foreground">Model: {decision.llm_model}</p>
          )}
          {reasoning && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Reasoning</p>
              <p className="text-sm">{reasoning}</p>
            </div>
          )}
          <DomainConfidenceChart domainMap={domainMap} />
          {decision.fallback_reason && (
            <p className="text-xs text-amber-600">Fallback reason: {decision.fallback_reason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function BatteryPathDiagram({ decisions }: { decisions: CATDecisionItem[] }) {
  const tasks: string[] = [];
  const seen = new Set<string>();
  for (const d of decisions) {
    const parsed = d.parsed_decision_json as Record<string, unknown> | null;
    if (parsed?.next_task && !seen.has(String(parsed.next_task))) {
      tasks.push(String(parsed.next_task));
      seen.add(String(parsed.next_task));
    }
    if (parsed?.stop_battery) break;
  }
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Battery path
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {tasks.map((task, i) => (
          <div key={`${task}-${i}`} className="flex items-center gap-2">
            <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium">
              {getTaskDisplayName(task)}
            </span>
            {i < tasks.length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CATRoutingLog({ sessionId }: { sessionId: string }) {
  const [decisions, setDecisions] = useState<CATDecisionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminCatConfigService
      .getSessionDecisions(sessionId)
      .then(setDecisions)
      .catch(() => setDecisions([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading CAT routing log…
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No CAT routing decisions for this session. The session may not have used the adaptive routing engine.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <BatteryPathDiagram decisions={decisions} />
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Decision timeline
        </p>
        <div className="space-y-2">
          {decisions.map((d) => (
            <DecisionCard key={d.decision_id} decision={d} />
          ))}
        </div>
      </div>
    </div>
  );
}
