import { useState } from "react";
import { ChevronDown, ChevronUp, Gauge } from "lucide-react";
import { SHOW_MAIN_ADAPTIVE_DEBUG_PANEL } from "@/config/mainAdaptiveDebug";
import { mainAdaptiveDebugStore } from "@/stores/mainAdaptiveDebugStore";

/**
 * Mirrors the last main-adaptive checkpoint / evaluation on the user dashboard
 * so you can glance at live stats after navigating home from a task (SPA session).
 */
export function DashboardLiveAdaptiveHud() {
  const [open, setOpen] = useState(true);
  const snap = mainAdaptiveDebugStore();

  if (!SHOW_MAIN_ADAPTIVE_DEBUG_PANEL) return null;
  if (!snap.taskKey || !snap.checkpoint) return null;

  const ev = snap.evaluation;

  return (
    <div className="pointer-events-auto fixed bottom-6 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-hidden rounded-xl border border-border/80 bg-card/95 shadow-xl backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-left text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-primary" />
          Live adaptive (last task)
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="max-h-[min(52vh,28rem)] space-y-2 overflow-y-auto px-3 py-2 text-xs leading-snug">
          <p>
            <span className="font-semibold text-foreground">{snap.taskKey}</span>
            <span className="text-muted-foreground">
              {" "}
              · checkpoint #{snap.historyCheckpointCount} · updated{" "}
              {new Date(snap.updatedAt).toLocaleTimeString()}
            </span>
          </p>
          {ev && (
            <p className="rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px]">
              <span className="text-foreground">{ev.decision}</span>
              <span className="text-muted-foreground"> — {ev.adaptiveStoppingReason}</span>
            </p>
          )}
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-[10px] text-muted-foreground">
            {JSON.stringify(snap.checkpoint, null, 0)}
          </pre>
        </div>
      )}
    </div>
  );
}
