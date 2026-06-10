import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Clock, GripVertical, Lock, RotateCcw, Save, Settings, Unlock } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import {
  buildSpecMaxTrialsPerTask,
  buildSpecMinTrialsPerTask,
  buildSpecPracticeConfigPerTask,
} from "@/config/catConfig";
import { adminCatConfigService, type CATConfigData, type MasterTaskItem } from "@/services";

const MODES = [
  { key: "diagnosis_no_substance", label: "Diagnosis (No Substance)" },
  { key: "diagnosis_with_substance", label: "Diagnosis (With Substance)" },
  { key: "treatment", label: "Treatment" },
];

const DOMAINS = [
  { key: "sustained_attention", label: "Sustained Attention" },
  { key: "inhibition", label: "Inhibition" },
  { key: "executive_function", label: "Executive Function" },
  { key: "working_memory", label: "Working Memory" },
  { key: "temporal_processing", label: "Temporal Processing" },
  { key: "reward_impulsivity", label: "Reward/Impulsivity" },
];

const LLM_MODELS = ["gpt-4o", "gpt-4o-mini"];
const DEFAULT_LLM_MODEL = "gpt-4o";
const DEFAULT_LLM_TEMPERATURE = 0.1;
const DEFAULT_STOP_BATTERY_THRESHOLD = 0.8;
const DEFAULT_CHECKPOINT_INTERVAL = 5;
const DEFAULT_DOMAIN_THRESHOLD = 0.7;
const DEFAULT_ANCHOR_TASKS = ["cpt", "sst", "digit_span"];
const TASK_WEIGHT_MIN = 0.1;
const TASK_WEIGHT_MAX = 1;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function defaultDomainThresholds(): Record<string, number> {
  return Object.fromEntries(DOMAINS.map((domain) => [domain.key, DEFAULT_DOMAIN_THRESHOLD]));
}

function normalizeTaskWeights(
  tasks: MasterTaskItem[],
  taskWeights?: Record<string, number> | null,
): Record<string, number> {
  return Object.fromEntries(
    tasks.map((task) => {
      const weight = taskWeights?.[task.task_name];
      const normalizedWeight =
        typeof weight === "number" && weight >= TASK_WEIGHT_MIN && weight <= TASK_WEIGHT_MAX
          ? weight
          : 1;
      return [task.task_name, normalizedWeight];
    }),
  );
}

function parseIntegerValue(value: string): number {
  return parseInt(value, 10) || 0;
}

function parseRangePercent(value: string): number {
  return parseInt(value, 10) / 100;
}

export default function AdminCATConfig() {
  const [mode, setMode] = useState(MODES[0].key);
  const [config, setConfig] = useState<CATConfigData | null>(null);
  const [tasks, setTasks] = useState<MasterTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<CATConfigData[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showAdvancedPrompt, setShowAdvancedPrompt] = useState(false);

  // Form state
  const [anchorTasks, setAnchorTasks] = useState<string[]>([]);
  const [optionalPool, setOptionalPool] = useState<string[]>([]);
  const [minTrials, setMinTrials] = useState<Record<string, number>>({});
  const [maxTrials, setMaxTrials] = useState<Record<string, number>>({});
  const [practiceConfig, setPracticeConfig] = useState<
    Record<
      string,
      {
        min_trials?: number;
        max_trials?: number;
        evaluation_interval?: number;
        pass_threshold?: number;
        continue_threshold?: number;
        final_trial_count?: number;
      }
    >
  >({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [stopThreshold, setStopThreshold] = useState(0.8);
  const [llmModel, setLlmModel] = useState("gpt-4o");
  const [llmTemp, setLlmTemp] = useState(0.1);
  const [checkpointInterval, setCheckpointInterval] = useState(5);
  const [promptTemplate, setPromptTemplate] = useState<string | null>(null);
  const [taskWeights, setTaskWeights] = useState<Record<string, number>>({});

  const applyConfigToForm = (c: CATConfigData) => {
    const minMap = c.min_trials_per_task || {};
    const maxMap = c.max_trials_per_task || {};
    const practiceMap = c.practice_config || {};

    setConfig(c);
    setAnchorTasks(c.anchor_tasks || []);
    setOptionalPool(c.optional_task_pool || []);
    setMinTrials(
      Object.keys(minMap).length > 0 ? minMap : buildSpecMinTrialsPerTask(),
    );
    setMaxTrials(
      Object.keys(maxMap).length > 0 ? maxMap : buildSpecMaxTrialsPerTask(),
    );
    setPracticeConfig(
      Object.keys(practiceMap).length > 0 ? practiceMap : buildSpecPracticeConfigPerTask(),
    );
    setThresholds(c.domain_confidence_thresholds || defaultDomainThresholds());
    setStopThreshold(c.stop_battery_threshold ?? DEFAULT_STOP_BATTERY_THRESHOLD);
    setLlmModel(c.llm_model || DEFAULT_LLM_MODEL);
    setLlmTemp(c.llm_temperature ?? DEFAULT_LLM_TEMPERATURE);
    setCheckpointInterval(c.checkpoint_interval ?? DEFAULT_CHECKPOINT_INTERVAL);
    setPromptTemplate(c.system_prompt_template || null);
  };

  useEffect(() => {
    adminCatConfigService.getMasterTaskList().then(setTasks).catch(() => setTasks([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    adminCatConfigService
      .getConfig(mode)
      .then((c) => {
        applyConfigToForm(c);
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, [mode]);

  useEffect(() => {
    if (tasks.length === 0) return;
    if (!config) {
      setTaskWeights(normalizeTaskWeights(tasks));
      setAnchorTasks(DEFAULT_ANCHOR_TASKS);
      setOptionalPool(
        tasks.map((t) => t.task_name).filter((taskName) => !DEFAULT_ANCHOR_TASKS.includes(taskName)),
      );
      setMinTrials(buildSpecMinTrialsPerTask());
      setMaxTrials(buildSpecMaxTrialsPerTask());
      setPracticeConfig(buildSpecPracticeConfigPerTask());
      setThresholds(defaultDomainThresholds());
      return;
    }
    setTaskWeights(normalizeTaskWeights(tasks, config.task_weights));
  }, [config, tasks]);

  const loadHistory = () => {
    adminCatConfigService.getConfigHistory(mode).then((h) => {
      setHistory(h.configs);
      setShowHistory(true);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await adminCatConfigService.saveConfig({
        mode,
        anchor_tasks: anchorTasks,
        optional_task_pool: optionalPool,
        min_trials_per_task: minTrials,
        max_trials_per_task: maxTrials,
        practice_config: practiceConfig,
        task_weights: taskWeights,
        domain_confidence_thresholds: thresholds,
        stop_battery_threshold: stopThreshold,
        llm_model: llmModel,
        llm_temperature: llmTemp,
        checkpoint_interval: checkpointInterval,
        system_prompt_template: promptTemplate,
      });
      setConfig(saved);
      toast.success("Config saved");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async (configId: string) => {
    try {
      await adminCatConfigService.activateConfig(configId);
      toast.success("Config version activated");
      setShowHistory(false);
      const c = await adminCatConfigService.getConfig(mode);
      applyConfigToForm(c);
      setTaskWeights(normalizeTaskWeights(tasks, c.task_weights));
    } catch {
      toast.error("Rollback failed");
    }
  };

  const toggleAnchor = (taskName: string) => {
    if (anchorTasks.includes(taskName)) {
      setAnchorTasks(anchorTasks.filter((t) => t !== taskName));
      setOptionalPool([...optionalPool, taskName]);
    } else {
      setAnchorTasks([...anchorTasks, taskName]);
      setOptionalPool(optionalPool.filter((t) => t !== taskName));
    }
  };

  const toggleOptional = (taskName: string) => {
    if (optionalPool.includes(taskName)) {
      setOptionalPool(optionalPool.filter((t) => t !== taskName));
    } else if (!anchorTasks.includes(taskName)) {
      setOptionalPool([...optionalPool, taskName]);
    }
  };

  const configJson = JSON.stringify(
    {
      mode,
      anchor_tasks: anchorTasks,
      optional_task_pool: optionalPool,
      min_trials_per_task: minTrials,
      max_trials_per_task: maxTrials,
      practice_config: practiceConfig,
      task_weights: taskWeights,
      domain_confidence_thresholds: thresholds,
      stop_battery_threshold: stopThreshold,
      llm_model: llmModel,
      llm_temperature: llmTemp,
      checkpoint_interval: checkpointInterval,
      system_prompt_template: promptTemplate,
    },
    null,
    2,
  );

  return (
    <DashboardLayout title="CAT Configuration">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowJson(!showJson)}>
              {showJson ? "Hide" : "Preview"} JSON
            </Button>
            <Button variant="outline" size="sm" onClick={loadHistory}>
              <Clock className="mr-1 h-3.5 w-3.5" /> History
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === m.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {config?.config_id && (
          <p className="text-xs text-muted-foreground">
            Active config: {config.config_id.slice(0, 8)}… • Last updated: {formatDate(config.created_at)}
          </p>
        )}

        {loading ? (
          <div className="py-8 text-center text-muted-foreground animate-pulse">Loading config…</div>
        ) : (
          <div className="space-y-6">
            {/* Anchor Tasks */}
            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Anchor Tasks (Required)
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Anchor tasks always run. The LLM cannot skip them. Drag to set preferred order.
              </p>
              <div className="space-y-2">
                {/* Anchors in order (draggable) */}
                {anchorTasks.map((taskName, idx) => {
                  const task = tasks.find((t) => t.task_name === taskName);
                  if (!task) return null;
                  return (
                    <div
                      key={task.task_name}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(idx));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
                        if (from === idx) return;
                        const next = [...anchorTasks];
                        const [removed] = next.splice(from, 1);
                        next.splice(idx, 0, removed);
                        setAnchorTasks(next);
                      }}
                      className="flex cursor-grab items-center gap-2 rounded-lg border border-primary/60 bg-primary/5 p-3 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Lock className="h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{task.display_name}</p>
                        <p className="text-xs text-muted-foreground">{task.domain_label}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleAnchor(task.task_name)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
                {/* Non-anchors as toggle cards */}
                <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                  {tasks
                    .filter((t) => !anchorTasks.includes(t.task_name))
                    .map((task) => (
                      <button
                        key={task.task_name}
                        onClick={() => toggleAnchor(task.task_name)}
                        className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/10 p-3 text-left transition-colors hover:border-border"
                      >
                        <Unlock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{task.display_name}</p>
                          <p className="text-xs text-muted-foreground">{task.domain_label}</p>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            </section>

            {/* Optional Pool */}
            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Optional Task Pool
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                LLM may dynamically add these tasks. Unchecked = LLM cannot assign.
              </p>
              <div className="space-y-2">
                {tasks
                  .filter((t) => !anchorTasks.includes(t.task_name))
                  .map((task) => {
                    const isOptional = optionalPool.includes(task.task_name);
                    return (
                      <label key={task.task_name} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isOptional}
                          onChange={() => toggleOptional(task.task_name)}
                          className="h-4 w-4 rounded border-border"
                        />
                        {task.display_name}
                        <span className="text-xs text-muted-foreground">({task.domain_label})</span>
                      </label>
                    );
                  })}
              </div>
            </section>

            {/* Trial Bounds */}
            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Trial Bounds
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Each weight must be between 0.1 and 1. These are the default relative importances for new batteries; when assigning a battery, the clinician can adjust per-test session weights for that case (still scaled to 100% of the session on save).
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-4 pb-3 mb-3 border-b border-border/40">
                  <label className="w-48 text-sm font-medium">Checkpoint Interval (trials)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={checkpointInterval}
                    onChange={(e) => setCheckpointInterval(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    className="h-8 w-20 rounded border border-border bg-background px-2 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">How often to checkpoint within a task</span>
                </div>
                <div className="rounded-lg border border-border/40 bg-muted/10 p-3">
                  <div className="grid grid-cols-[minmax(160px,1fr)_minmax(88px,100px)_minmax(170px,200px)_minmax(170px,200px)] items-center gap-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Name of Tests</span>
                    <span title="Relative importance; battery sums to 100%">Weight</span>
                    <span>Practice (Min / Max)</span>
                    <span>Main (Min / Max)</span>
                  </div>
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div
                        key={`trial-bounds-${task.task_name}`}
                        className="grid grid-cols-[minmax(160px,1fr)_minmax(88px,100px)_minmax(170px,200px)_minmax(170px,200px)] items-center gap-2"
                      >
                        <span className="text-sm">{task.display_name}</span>
                        <input
                          type="number"
                          min={0.1}
                          max={1}
                          step={0.1}
                          value={taskWeights[task.task_name] ?? ""}
                          placeholder="1"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            const clamped =
                              Number.isFinite(v)
                                ? Math.min(TASK_WEIGHT_MAX, Math.max(TASK_WEIGHT_MIN, v))
                                : TASK_WEIGHT_MIN;
                            setTaskWeights({
                              ...taskWeights,
                              [task.task_name]: clamped,
                            });
                          }}
                          className="h-8 w-full max-w-[100px] rounded border border-border bg-background px-2 text-sm"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={practiceConfig[task.task_name]?.min_trials ?? ""}
                            placeholder="Min"
                            onChange={(e) =>
                              setPracticeConfig({
                                ...practiceConfig,
                                [task.task_name]: {
                                  ...practiceConfig[task.task_name],
                                  min_trials: parseIntegerValue(e.target.value),
                                },
                              })
                            }
                            className="h-8 w-20 rounded border border-border bg-background px-2 text-sm"
                          />
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={practiceConfig[task.task_name]?.max_trials ?? ""}
                            placeholder="Max"
                            onChange={(e) =>
                              setPracticeConfig({
                                ...practiceConfig,
                                [task.task_name]: {
                                  ...practiceConfig[task.task_name],
                                  max_trials: parseIntegerValue(e.target.value),
                                },
                              })
                            }
                            className="h-8 w-20 rounded border border-border bg-background px-2 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={minTrials[task.task_name] ?? ""}
                            placeholder="Min"
                            onChange={(e) =>
                              setMinTrials({ ...minTrials, [task.task_name]: parseIntegerValue(e.target.value) })
                            }
                            className="h-8 w-20 rounded border border-border bg-background px-2 text-sm"
                          />
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={maxTrials[task.task_name] ?? ""}
                            placeholder="Max"
                            onChange={(e) =>
                              setMaxTrials({ ...maxTrials, [task.task_name]: parseIntegerValue(e.target.value) })
                            }
                            className="h-8 w-20 rounded border border-border bg-background px-2 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Domain Confidence Thresholds */}
            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Domain Confidence Thresholds
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Battery stops when ALL required domains exceed their threshold. Higher = more evidence required = longer battery.
              </p>
              <div className="space-y-3">
                {DOMAINS.map((domain) => (
                  <div key={domain.key} className="flex items-center gap-4">
                    <span className="w-44 text-sm">{domain.label}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((thresholds[domain.key] ?? 0.7) * 100)}
                      onChange={(e) =>
                        setThresholds({ ...thresholds, [domain.key]: parseRangePercent(e.target.value) })
                      }
                      className="flex-1"
                    />
                    <span className="w-12 text-right text-sm font-medium">
                      {((thresholds[domain.key] ?? DEFAULT_DOMAIN_THRESHOLD) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
                <div className="mt-4 flex items-center gap-4 border-t border-border/40 pt-3">
                  <span className="w-44 text-sm font-medium">Stop Battery Threshold</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(stopThreshold * 100)}
                    onChange={(e) => setStopThreshold(parseRangePercent(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-12 text-right text-sm font-medium">
                    {(stopThreshold * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </section>

            {/* LLM Settings */}
            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Settings className="mr-1 inline h-4 w-4" /> LLM Settings
              </h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <label className="w-32 text-sm">Model</label>
                  <select
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                  >
                    {LLM_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-4">
                  <label className="w-32 text-sm">Temperature</label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(llmTemp * 100)}
                    onChange={(e) => setLlmTemp(parseRangePercent(e.target.value))}
                    className="flex-1 max-w-xs"
                  />
                  <span className="w-12 text-right text-sm font-medium">{llmTemp.toFixed(2)}</span>
                </div>
                <div>
                  <button
                    onClick={() => setShowAdvancedPrompt(!showAdvancedPrompt)}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvancedPrompt ? "rotate-180" : ""}`} />
                    Advanced: System Prompt
                  </button>
                  {showAdvancedPrompt && (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={promptTemplate || ""}
                        onChange={(e) => setPromptTemplate(e.target.value || null)}
                        placeholder="Leave empty to use default routing prompt"
                        rows={8}
                        className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono"
                      />
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPromptTemplate(null)}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to default
                        </Button>
                        {promptTemplate && (
                          <span className="text-xs text-amber-600">Modified from default</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Preview JSON */}
        {showJson && (
          <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Config JSON (Read-only)
            </h3>
            <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-4 text-xs font-mono">
              {configJson}
            </pre>
          </section>
        )}

        {/* History modal */}
        {showHistory && (
          <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Config History — {MODES.find((m) => m.key === mode)?.label}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>Close</Button>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No previous versions</p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div
                    key={h.config_id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      h.is_active ? "border-primary/60 bg-primary/5" : "border-border/40"
                    }`}
                  >
                    <div className="text-sm">
                      <p className="font-medium">
                        {h.config_id?.slice(0, 8)}…
                        {h.is_active && <span className="ml-2 text-xs text-primary">(active)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(h.created_at)} • {h.anchor_tasks.length} anchors • model: {h.llm_model}
                      </p>
                    </div>
                    {!h.is_active && h.config_id && (
                      <Button variant="outline" size="sm" onClick={() => handleRollback(h.config_id!)}>
                        <RotateCcw className="mr-1 h-3.5 w-3.5" /> Rollback
                      </Button>
                    )}
                    {h.is_active && (
                      <span className="text-xs text-emerald-600"><Check className="inline h-3.5 w-3.5" /> Active</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
