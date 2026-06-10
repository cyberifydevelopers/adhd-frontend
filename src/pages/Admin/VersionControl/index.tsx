import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { adminVersioningService } from "@/services";
import { toast } from "@/lib/toast";

const NORMS_EXAMPLE = JSON.stringify({
  age_bands: {
    "6-8": {
      cpt: { omission_rate: { mean: 0.08, sd: 0.04 }, commission_rate: { mean: 0.18, sd: 0.08 }, median_rt: { mean: 520, sd: 85 }, lapse_rate: { mean: 0.06, sd: 0.03 } },
      sst: { ssrt: { mean: 280, sd: 55 }, go_omission_rate: { mean: 0.07, sd: 0.04 }, stop_success_rate: { mean: 0.48, sd: 0.08 } },
      digit_span: { max_forward_span: { mean: 5.0, sd: 1.0 }, max_backward_span: { mean: 3.5, sd: 1.0 } },
      time_estimation: { mean_abs_error: { mean: 1.2, sd: 0.5 }, mean_bias: { mean: 0.3, sd: 0.4 } },
      simple_rt: { mean_rt: { mean: 380, sd: 70 }, rt_cov: { mean: 0.25, sd: 0.08 } },
      choice_rt: { mean_rt: { mean: 550, sd: 90 }, accuracy: { mean: 0.88, sd: 0.06 } },
      flanker: { interference_cost_ms: { mean: 95, sd: 35 }, incongruent_accuracy: { mean: 0.85, sd: 0.07 } },
      task_switching: { switch_cost_ms: { mean: 250, sd: 80 }, switch_accuracy: { mean: 0.82, sd: 0.08 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.65, sd: 0.15 } },
    },
    "9-11": {
      cpt: { omission_rate: { mean: 0.06, sd: 0.03 }, commission_rate: { mean: 0.14, sd: 0.07 }, median_rt: { mean: 470, sd: 75 }, lapse_rate: { mean: 0.04, sd: 0.02 } },
      sst: { ssrt: { mean: 250, sd: 48 }, go_omission_rate: { mean: 0.05, sd: 0.03 }, stop_success_rate: { mean: 0.50, sd: 0.07 } },
      digit_span: { max_forward_span: { mean: 5.8, sd: 1.1 }, max_backward_span: { mean: 4.2, sd: 1.1 } },
      time_estimation: { mean_abs_error: { mean: 0.9, sd: 0.4 }, mean_bias: { mean: 0.2, sd: 0.35 } },
      simple_rt: { mean_rt: { mean: 340, sd: 60 }, rt_cov: { mean: 0.22, sd: 0.07 } },
      choice_rt: { mean_rt: { mean: 490, sd: 80 }, accuracy: { mean: 0.91, sd: 0.05 } },
      flanker: { interference_cost_ms: { mean: 80, sd: 30 }, incongruent_accuracy: { mean: 0.89, sd: 0.06 } },
      task_switching: { switch_cost_ms: { mean: 200, sd: 65 }, switch_accuracy: { mean: 0.86, sd: 0.07 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.58, sd: 0.14 } },
    },
    "12-14": {
      cpt: { omission_rate: { mean: 0.04, sd: 0.02 }, commission_rate: { mean: 0.11, sd: 0.06 }, median_rt: { mean: 440, sd: 68 }, lapse_rate: { mean: 0.03, sd: 0.02 } },
      sst: { ssrt: { mean: 230, sd: 43 }, go_omission_rate: { mean: 0.04, sd: 0.03 }, stop_success_rate: { mean: 0.51, sd: 0.06 } },
      digit_span: { max_forward_span: { mean: 6.2, sd: 1.1 }, max_backward_span: { mean: 4.8, sd: 1.2 } },
      time_estimation: { mean_abs_error: { mean: 0.7, sd: 0.35 }, mean_bias: { mean: 0.15, sd: 0.3 } },
      simple_rt: { mean_rt: { mean: 310, sd: 50 }, rt_cov: { mean: 0.20, sd: 0.06 } },
      choice_rt: { mean_rt: { mean: 450, sd: 70 }, accuracy: { mean: 0.93, sd: 0.04 } },
      flanker: { interference_cost_ms: { mean: 70, sd: 25 }, incongruent_accuracy: { mean: 0.92, sd: 0.05 } },
      task_switching: { switch_cost_ms: { mean: 160, sd: 55 }, switch_accuracy: { mean: 0.89, sd: 0.06 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.50, sd: 0.13 } },
    },
    "15-17": {
      cpt: { omission_rate: { mean: 0.03, sd: 0.02 }, commission_rate: { mean: 0.10, sd: 0.05 }, median_rt: { mean: 420, sd: 62 }, lapse_rate: { mean: 0.02, sd: 0.015 } },
      sst: { ssrt: { mean: 215, sd: 40 }, go_omission_rate: { mean: 0.03, sd: 0.02 }, stop_success_rate: { mean: 0.52, sd: 0.06 } },
      digit_span: { max_forward_span: { mean: 6.5, sd: 1.2 }, max_backward_span: { mean: 5.0, sd: 1.2 } },
      time_estimation: { mean_abs_error: { mean: 0.6, sd: 0.3 }, mean_bias: { mean: 0.1, sd: 0.25 } },
      simple_rt: { mean_rt: { mean: 290, sd: 45 }, rt_cov: { mean: 0.18, sd: 0.05 } },
      choice_rt: { mean_rt: { mean: 420, sd: 65 }, accuracy: { mean: 0.94, sd: 0.04 } },
      flanker: { interference_cost_ms: { mean: 60, sd: 22 }, incongruent_accuracy: { mean: 0.93, sd: 0.04 } },
      task_switching: { switch_cost_ms: { mean: 140, sd: 48 }, switch_accuracy: { mean: 0.91, sd: 0.05 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.45, sd: 0.12 } },
    },
    "18+": {
      cpt: { omission_rate: { mean: 0.03, sd: 0.02 }, commission_rate: { mean: 0.09, sd: 0.05 }, median_rt: { mean: 410, sd: 60 }, lapse_rate: { mean: 0.02, sd: 0.01 } },
      sst: { ssrt: { mean: 210, sd: 38 }, go_omission_rate: { mean: 0.03, sd: 0.02 }, stop_success_rate: { mean: 0.52, sd: 0.05 } },
      digit_span: { max_forward_span: { mean: 6.8, sd: 1.2 }, max_backward_span: { mean: 5.2, sd: 1.3 } },
      time_estimation: { mean_abs_error: { mean: 0.5, sd: 0.25 }, mean_bias: { mean: 0.08, sd: 0.2 } },
      simple_rt: { mean_rt: { mean: 280, sd: 42 }, rt_cov: { mean: 0.17, sd: 0.05 } },
      choice_rt: { mean_rt: { mean: 400, sd: 60 }, accuracy: { mean: 0.95, sd: 0.03 } },
      flanker: { interference_cost_ms: { mean: 55, sd: 20 }, incongruent_accuracy: { mean: 0.94, sd: 0.04 } },
      task_switching: { switch_cost_ms: { mean: 120, sd: 42 }, switch_accuracy: { mean: 0.92, sd: 0.05 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.40, sd: 0.12 } },
    },
    default: {
      cpt: { omission_rate: { mean: 0.05, sd: 0.03 }, commission_rate: { mean: 0.12, sd: 0.06 }, median_rt: { mean: 440, sd: 70 }, lapse_rate: { mean: 0.03, sd: 0.02 } },
      sst: { ssrt: { mean: 230, sd: 45 }, go_omission_rate: { mean: 0.04, sd: 0.03 }, stop_success_rate: { mean: 0.50, sd: 0.06 } },
      digit_span: { max_forward_span: { mean: 6.2, sd: 1.2 }, max_backward_span: { mean: 4.8, sd: 1.2 } },
      time_estimation: { mean_abs_error: { mean: 0.8, sd: 0.35 }, mean_bias: { mean: 0.15, sd: 0.3 } },
      simple_rt: { mean_rt: { mean: 320, sd: 55 }, rt_cov: { mean: 0.20, sd: 0.06 } },
      choice_rt: { mean_rt: { mean: 450, sd: 72 }, accuracy: { mean: 0.92, sd: 0.04 } },
      flanker: { interference_cost_ms: { mean: 70, sd: 25 }, incongruent_accuracy: { mean: 0.91, sd: 0.05 } },
      task_switching: { switch_cost_ms: { mean: 170, sd: 58 }, switch_accuracy: { mean: 0.88, sd: 0.06 } },
      delay_discounting: { immediate_choice_rate: { mean: 0.50, sd: 0.13 } },
    },
  },
}, null, 2);

export default function AdminVersionControl() {
  const [protocols, setProtocols] = useState<{ version: string; config: Record<string, unknown>; active: boolean }[]>([]);
  const [norms, setNorms] = useState<{ version: string; keys: string[] }[]>([]);
  const [protocolHistory, setProtocolHistory] = useState<{ timestamp: string | null; target_type: string | null }[]>([]);
  const [rescoreSessionId, setRescoreSessionId] = useState("");
  const [normsVersion, setNormsVersion] = useState("");
  const [normsJson, setNormsJson] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      adminVersioningService.getProtocol(),
      adminVersioningService.getNorms(),
      adminVersioningService.getProtocolHistory(),
    ])
      .then(([p, n, h]) => {
        setProtocols(p);
        setNorms(n);
        setProtocolHistory(h);
      })
      .catch(() => toast.error("Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  const handleProtocolActivate = (version: string) => {
    adminVersioningService
      .updateProtocol({ version, active: true })
      .then(() => {
        toast.success(`Protocol ${version} activated`);
        load();
      })
      .catch(() => toast.error("Failed to update protocol"));
  };

  const handleNormsUpload = () => {
    const version = normsVersion.trim();
    if (!version) {
      toast.error("Enter a norm version");
      return;
    }
    if (!normsJson.trim()) {
      toast.error("Enter population data JSON");
      return;
    }
    let population_data: Record<string, unknown>;
    try {
      population_data = JSON.parse(normsJson);
    } catch {
      toast.error("Invalid JSON");
      return;
    }
    setUploading(true);
    adminVersioningService
      .uploadNorms({ version, population_data })
      .then(() => {
        toast.success(`Norms ${version} uploaded`);
        setNormsVersion("");
        setNormsJson("");
        load();
      })
      .catch(() => toast.error("Failed to upload norms"))
      .finally(() => setUploading(false));
  };

  const handleRescore = () => {
    if (!rescoreSessionId.trim()) {
      toast.error("Enter session ID");
      return;
    }
    adminVersioningService
      .rescoreSession(rescoreSessionId.trim())
      .then((r) => {
        toast.success(`Rescored: ${r.tasks_scored.join(", ") || "none"}`);
      })
      .catch(() => toast.error("Failed to rescore"));
  };

  return (
    <DashboardLayout title="Version Control">
      <div className="space-y-6">
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Protocol config
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : protocols.length === 0 ? (
            <p className="text-sm text-muted-foreground">No protocol versions</p>
          ) : (
            <div className="space-y-2">
              {protocols.map((p) => (
                <div
                  key={p.version}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3"
                >
                  <div>
                    <span className="font-medium">{p.version}</span>
                    {p.active && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                        active
                      </span>
                    )}
                  </div>
                  {!p.active && (
                    <Button size="sm" variant="outline" onClick={() => handleProtocolActivate(p.version)}>
                      Activate
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {protocolHistory.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Protocol update history</p>
              <ul className="max-h-24 overflow-auto text-xs">
                {protocolHistory.slice(0, 10).map((h, i) => (
                  <li key={i}>
                    {h.target_type ?? "—"} @ {h.timestamp ? new Date(h.timestamp).toLocaleString() : "—"}
                  </li>
                ))}
                {protocolHistory.length > 10 && (
                  <li className="text-muted-foreground">… {protocolHistory.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Normative data
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Version (e.g. 1.0)"
                  value={normsVersion}
                  onChange={(e) => setNormsVersion(e.target.value)}
                  className="h-9 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
                />
                <textarea
                  placeholder={
                    '{\n  "age_bands": {\n    "default": {\n      "cpt": { "omission_rate": { "mean": 0.05, "sd": 0.03 }, ... },\n      "sst": { ... },\n      ...\n    }\n  }\n}'
                  }
                  value={normsJson}
                  onChange={(e) => setNormsJson(e.target.value)}
                  rows={12}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleNormsUpload} disabled={uploading}>
                    {uploading ? "Uploading…" : "Upload norms"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNormsJson(NORMS_EXAMPLE);
                      setNormsVersion((v) => v || "1.0");
                    }}
                  >
                    Load example
                  </Button>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowStructure((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showStructure ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  Expected structure reference
                </button>
                {showStructure && (
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border bg-muted/30 p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Age bands: <code className="rounded bg-muted px-1">6-8</code>, <code className="rounded bg-muted px-1">9-11</code>, <code className="rounded bg-muted px-1">12-14</code>, <code className="rounded bg-muted px-1">15-17</code>, <code className="rounded bg-muted px-1">18+</code>, <code className="rounded bg-muted px-1">default</code> (fallback).
                      Each band contains tasks with metrics as <code className="rounded bg-muted px-1">{`{ "mean": number, "sd": number }`}</code>.
                    </p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="pb-1.5 font-medium">Task</th>
                          <th className="pb-1.5 font-medium">Metrics</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        <tr><td className="py-1.5 font-mono">cpt</td><td className="py-1.5 font-mono">omission_rate, commission_rate, median_rt, lapse_rate</td></tr>
                        <tr><td className="py-1.5 font-mono">sst</td><td className="py-1.5 font-mono">ssrt, go_omission_rate, stop_success_rate</td></tr>
                        <tr><td className="py-1.5 font-mono">digit_span</td><td className="py-1.5 font-mono">max_forward_span, max_backward_span</td></tr>
                        <tr><td className="py-1.5 font-mono">time_estimation</td><td className="py-1.5 font-mono">mean_abs_error, mean_bias</td></tr>
                        <tr><td className="py-1.5 font-mono">simple_rt</td><td className="py-1.5 font-mono">mean_rt, rt_cov</td></tr>
                        <tr><td className="py-1.5 font-mono">choice_rt</td><td className="py-1.5 font-mono">mean_rt, accuracy</td></tr>
                        <tr><td className="py-1.5 font-mono">flanker</td><td className="py-1.5 font-mono">interference_cost_ms, incongruent_accuracy</td></tr>
                        <tr><td className="py-1.5 font-mono">task_switching</td><td className="py-1.5 font-mono">switch_cost_ms, switch_accuracy</td></tr>
                        <tr><td className="py-1.5 font-mono">delay_discounting</td><td className="py-1.5 font-mono">immediate_choice_rate</td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {norms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No norm versions</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {norms.map((n) => (
                    <li key={n.version}>
                      <span className="font-medium">{n.version}</span>
                      {n.keys.length > 0 && (
                        <span className="ml-2 text-muted-foreground">({n.keys.slice(0, 5).join(", ")}{n.keys.length > 5 ? "…" : ""})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Rescore session
          </h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Session ID (UUID)"
              value={rescoreSessionId}
              onChange={(e) => setRescoreSessionId(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
            />
            <Button size="sm" onClick={handleRescore}>
              Rescore
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Recomputes scores for all tasks in the session. Use session ID from Session Detail.
          </p>
        </section>
      </div>
    </DashboardLayout>
  );
}
