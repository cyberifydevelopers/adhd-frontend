import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Gauge } from "lucide-react";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { MAIN_TASK_POLICY_PRESETS, ciTargetForMode } from "@/lib/mainAdaptiveEngine";
import { MAIN_ADAPTIVE_SPEC_SUMMARY } from "@/lib/mainAdaptiveSpecSummary";
import {
  cptConfidenceGates,
  firstFailingCptGate,
  firstFailingFlankerGate,
  firstFailingTimeEstimationGate,
  flankerConfidenceGates,
  timeEstimationConfidenceGates,
} from "@/lib/mainAdaptiveConfidenceHints";
import { formatCheckpointCorrectSummary } from "@/lib/mainAdaptiveCheckpointScore";
import { stoppingRuleRows } from "@/lib/mainAdaptiveStoppingProgress";
import { checkpointSummary, mainAdaptiveDecisionLabel } from "@/lib/mainAdaptiveDebugPresentation";
import { mainAdaptiveDebugStore } from "@/stores/mainAdaptiveDebugStore";
import { catStore } from "@/stores/catStore";

type Props = { taskKey: MainAdaptiveTrialTaskKey };

/** Next task-switching evaluation trial: min, then min+every, min+2every, … */
function nextTaskSwitchingEvalTrial(completed: number, minT: number, every: number): number {
  if (every <= 0) return Math.max(completed, minT);
  if (completed < minT) return minT;
  const past = completed - minT;
  return minT + Math.ceil((past + 1) / every) * every;
}

export function MainAdaptiveDebugPanel({ taskKey }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const snap = mainAdaptiveDebugStore((s) => s);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const lastBlockEndSignalReason = catStore((s) => s.lastBlockEndSignalReason);

  useEffect(() => {
    mainAdaptiveDebugStore.getState().resetForTask(taskKey);
  }, [taskKey]);

  const policy = snap.policy ?? MAIN_TASK_POLICY_PRESETS[taskKey];
  const specLines = MAIN_ADAPTIVE_SPEC_SUMMARY[taskKey];
  const mode = snap.taskKey === taskKey ? snap.mode : "diagnostic";
  const ciTarget = useMemo(() => ciTargetForMode(mode), [mode]);

  const decision = snap.taskKey === taskKey ? snap.evaluation?.decision : undefined;
  const decisionLabel = useMemo(
    () => mainAdaptiveDecisionLabel(taskKey, decision, checkpoint),
    [decision, taskKey],
  );

  const checkpoint = snap.taskKey === taskKey ? snap.checkpoint : null;
  const cpPlain = checkpoint ? (JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>) : null;

  const effectiveMax = snap.effectiveMaxTrials || policy.maxTrials;
  const trialsDone = checkpoint?.trialsCompleted ?? 0;
  const nextTsEval =
    taskKey === "task_switching" && trialsDone < effectiveMax
      ? nextTaskSwitchingEvalTrial(trialsDone, policy.minTrials, policy.checkpointEvery)
      : null;

  const adaptiveHistory = useMemo(
    () => ({
      checkpoints: snap.taskKey === taskKey ? snap.recentCheckpoints : [],
      lowConfidenceFlag: snap.rollingLowConfidence,
    }),
    [snap.taskKey, taskKey, snap.recentCheckpoints, snap.rollingLowConfidence],
  );

  const ruleRows = stoppingRuleRows(
    taskKey,
    checkpoint,
    policy,
    effectiveMax,
    snap.taskKey === taskKey ? snap.recentCheckpoints : [],
    adaptiveHistory,
  );

  const correctSummary = useMemo(
    () => formatCheckpointCorrectSummary(taskKey, checkpoint),
    [taskKey, checkpoint],
  );

  /** Rolling history can be empty on the first painted frame; fall back to latest checkpoint so gates still render. */
  const flankerCheckpointTrail = useMemo(() => {
    if (snap.taskKey !== taskKey) return [];
    if (snap.recentCheckpoints.length > 0) return snap.recentCheckpoints;
    if (checkpoint) return [checkpoint];
    return [];
  }, [snap.taskKey, snap.recentCheckpoints, taskKey, checkpoint]);

  const flankerGateRows = useMemo(() => {
    if (taskKey !== "flanker" || flankerCheckpointTrail.length === 0) return [];
    return flankerConfidenceGates(mode, flankerCheckpointTrail);
  }, [taskKey, mode, flankerCheckpointTrail]);

  const flankerTypicalBlocker = useMemo(
    () => (taskKey === "flanker" ? firstFailingFlankerGate(flankerGateRows) : null),
    [taskKey, flankerGateRows],
  );

  const cptGateRows = useMemo(() => {
    if (taskKey !== "cpt" || !checkpoint || snap.taskKey !== taskKey) return [];
    return cptConfidenceGates(snap.recentCheckpoints, checkpoint);
  }, [taskKey, snap.taskKey, snap.recentCheckpoints, checkpoint]);

  const cptTypicalBlocker = useMemo(
    () => (taskKey === "cpt" ? firstFailingCptGate(cptGateRows) : null),
    [taskKey, cptGateRows],
  );

  const timeEstCheckpointTrail = useMemo(() => {
    if (snap.taskKey !== taskKey) return [];
    if (snap.recentCheckpoints.length > 0) return snap.recentCheckpoints;
    if (checkpoint) return [checkpoint];
    return [];
  }, [snap.taskKey, snap.recentCheckpoints, taskKey, checkpoint]);

  const timeEstGateRows = useMemo(() => {
    if (taskKey !== "time_estimation" || timeEstCheckpointTrail.length === 0) return [];
    return timeEstimationConfidenceGates(timeEstCheckpointTrail, checkpoint ?? undefined);
  }, [taskKey, timeEstCheckpointTrail, checkpoint]);

  const timeEstTypicalBlocker = useMemo(
    () => (taskKey === "time_estimation" ? firstFailingTimeEstimationGate(timeEstGateRows) : null),
    [taskKey, timeEstGateRows],
  );

  return (
    <div
      className="fixed right-3 top-20 z-[500] w-[min(22rem,calc(100vw-1.5rem))] max-h-[calc(100vh-6rem)] overflow-hidden rounded-xl border border-primary/25 bg-card/95 shadow-xl backdrop-blur-md"
      aria-label="Main adaptive debug"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 bg-primary/10 px-3 py-2 text-left text-xs font-semibold text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 shrink-0 text-primary" />
          Main adaptive (debug)
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <div className="max-h-[min(36rem,calc(100vh-10rem))] space-y-3 overflow-y-auto p-3 text-[11px] leading-snug text-foreground">
          <div>
            <p className="font-semibold text-primary">Task</p>
            <p className="font-mono text-muted-foreground">{taskKey}</p>
            <p className="mt-1 text-muted-foreground">
              Mode: <span className="text-foreground">{mode}</span> · CI target ~{ciTarget.toFixed(2)} (binomial
              where applicable)
            </p>
          </div>

          {taskKey === "task_switching" && checkpoint != null && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Trial rounds (main block)</p>
              <ul className="mt-1.5 space-y-1 font-mono text-[10px] text-foreground">
                <li>
                  <span className="text-muted-foreground">Progress:</span>{" "}
                  {checkpoint.trialsCompleted} / {effectiveMax} scored trials
                </li>
                <li>
                  <span className="text-muted-foreground">Mix (switch · repeat):</span>{" "}
                  {checkpoint.switchTrials ?? 0} · {checkpoint.repeatTrials ?? 0}
                </li>
                <li>
                  <span className="text-muted-foreground">Since last difficulty change:</span>{" "}
                  {checkpoint.trialsAtCurrentDifficulty ?? checkpoint.trialsCompleted} / 24
                </li>
                {typeof checkpoint.switchRtCostMs === "number" ? (
                  <li>
                    <span className="text-muted-foreground">Switch cost (median Δ ms):</span>{" "}
                    {Math.round(checkpoint.switchRtCostMs * 100) / 100}
                  </li>
                ) : null}
              </ul>
              <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                Updates every scored trial. Engine checkpoints (full evaluation) at trials 48, 72, 96… up to max.
              </p>
            </div>
          )}

          {taskKey === "cpt" && cptGateRows.length > 0 && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Confidence (engine)</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                CPT early stop requires <strong className="text-foreground">all</strong> gates at a checkpoint
                (150, 210, 270, …). Perfect accuracy does not bypass lapse or time-on-task slope stability.
              </p>
              {snap.evaluation && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Last evaluation — confidence met:{" "}
                  <span
                    className={
                      snap.evaluation.confidenceMet
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "font-medium text-rose-600 dark:text-rose-400"
                    }
                  >
                    {snap.evaluation.confidenceMet ? "yes" : "no"}
                  </span>
                  {!snap.evaluation.confidenceMet && cptTypicalBlocker ? (
                    <>
                      {" "}
                      · likely blocker:{" "}
                      <span className="font-medium text-foreground">{cptTypicalBlocker}</span>
                    </>
                  ) : null}
                </p>
              )}
              <div className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-card/80">
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40">
                      <th className="px-2 py-1 font-medium">Gate</th>
                      <th className="px-2 py-1 font-medium">Met</th>
                      <th className="px-2 py-1 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cptGateRows.map((row) => (
                      <tr key={row.id} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1 align-top text-muted-foreground">{row.label}</td>
                        <td className="px-2 py-1 align-top">
                          {row.met ? (
                            <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">no</span>
                          )}
                        </td>
                        <td className="px-2 py-1 align-top font-mono text-[9px] text-foreground">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {taskKey === "time_estimation" && checkpoint != null && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Scored reproductions (main block)</p>
              <ul className="mt-1.5 space-y-1 font-mono text-[10px] text-foreground">
                <li>
                  <span className="text-muted-foreground">Progress:</span> {checkpoint.trialsCompleted} /{" "}
                  {effectiveMax} scored reproductions
                </li>
                {typeof checkpoint.meanAbsoluteErrorMs === "number" ? (
                  <li>
                    <span className="text-muted-foreground">Mean absolute error:</span>{" "}
                    {Math.round(checkpoint.meanAbsoluteErrorMs * 10) / 10} ms
                  </li>
                ) : null}
                {typeof checkpoint.timingVariabilityMs === "number" ? (
                  <li>
                    <span className="text-muted-foreground">Variability (MAD):</span>{" "}
                    {Math.round(checkpoint.timingVariabilityMs * 10) / 10} ms
                  </li>
                ) : null}
              </ul>
            </div>
          )}

          {taskKey === "time_estimation" && timeEstGateRows.length > 0 && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Stable-stop gates (engine)</p>
              {snap.evaluation && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Last evaluation — confidence met:{" "}
                  <span
                    className={
                      snap.evaluation.confidenceMet
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "font-medium text-rose-600 dark:text-rose-400"
                    }
                  >
                    {snap.evaluation.confidenceMet ? "yes" : "no"}
                  </span>
                  {!snap.evaluation.confidenceMet && timeEstTypicalBlocker ? (
                    <>
                      {" "}
                      · likely blocker:{" "}
                      <span className="font-medium text-foreground">{timeEstTypicalBlocker}</span>
                    </>
                  ) : null}
                </p>
              )}
              <div className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-card/80">
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40">
                      <th className="px-2 py-1 font-medium">Gate</th>
                      <th className="px-2 py-1 font-medium">Met</th>
                      <th className="px-2 py-1 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeEstGateRows.map((row) => (
                      <tr key={row.id} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1 align-top text-muted-foreground">{row.label}</td>
                        <td className="px-2 py-1 align-top">
                          {row.met ? (
                            <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">no</span>
                          )}
                        </td>
                        <td className="px-2 py-1 align-top font-mono text-[9px] text-foreground">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {taskKey === "flanker" && flankerGateRows.length > 0 && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Confidence (engine)</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                <strong className="font-medium text-foreground">Why confidence can be “no”:</strong> Flanker stopping
                needs <strong className="text-foreground">every</strong> row below — not 100% overall accuracy. Example:
                incongruent-error Wilson width may be just over the ~{ciTarget.toFixed(2)} target even when almost all
                responses are correct.
              </p>
              {snap.evaluation && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Last evaluation — confidence met:{" "}
                  <span
                    className={
                      snap.evaluation.confidenceMet
                        ? "font-medium text-emerald-600 dark:text-emerald-400"
                        : "font-medium text-rose-600 dark:text-rose-400"
                    }
                  >
                    {snap.evaluation.confidenceMet ? "yes" : "no"}
                  </span>
                  {!snap.evaluation.confidenceMet && flankerTypicalBlocker ? (
                    <>
                      {" "}
                      · likely blocker:{" "}
                      <span className="font-medium text-foreground">{flankerTypicalBlocker}</span>
                    </>
                  ) : null}
                </p>
              )}
              <div className="mt-2 overflow-x-auto rounded-md border border-border/60 bg-card/80">
                <table className="w-full border-collapse text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40">
                      <th className="px-2 py-1 font-medium">Gate</th>
                      <th className="px-2 py-1 font-medium">Met</th>
                      <th className="px-2 py-1 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flankerGateRows.map((row) => (
                      <tr key={row.id} className="border-b border-border/40 last:border-0">
                        <td className="px-2 py-1 align-top text-muted-foreground">{row.label}</td>
                        <td className="px-2 py-1 align-top">
                          {row.met ? (
                            <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">no</span>
                          )}
                        </td>
                        <td className="px-2 py-1 align-top font-mono text-[9px] text-foreground">{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <p className="font-semibold text-primary">Stopping rule tracker (a / n)</p>
            <p className="mb-1.5 text-[10px] text-muted-foreground">
              Numerator = current / accumulated; denominator = requirement or segment size. Met = gate satisfied for
              that row (when applicable).
            </p>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40">
                    <th className="px-2 py-1 font-medium">Rule</th>
                    <th className="px-2 py-1 font-mono font-medium">a / n</th>
                    <th className="px-2 py-1 font-medium">Met</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleRows.map((row) => (
                    <tr key={row.id} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-1 align-top text-muted-foreground">{row.label}</td>
                      <td className="px-2 py-1 align-top font-mono text-foreground">
                        {row.a} / {row.n}
                      </td>
                      <td className="px-2 py-1 align-top">
                        {row.met === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : row.met ? (
                          <span className="text-emerald-600 dark:text-emerald-400">yes</span>
                        ) : (
                          <span className="text-rose-600 dark:text-rose-400">no</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-1.5 space-y-1 text-[10px] text-muted-foreground">
              {ruleRows
                .filter((r) => r.hint)
                .map((r) => (
                  <li key={`h-${r.id}`}>{r.hint}</li>
                ))}
            </ul>
          </div>

          <div>
            <p className="font-semibold text-primary">Correctness (latest checkpoint)</p>
            <p className="break-words font-mono text-[10px] text-foreground">
              {correctSummary ?? (
                <span className="text-muted-foreground">
                  — not available for this task yet (no accuracy fields in checkpoint)
                </span>
              )}
            </p>
            {taskKey === "time_estimation" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Time estimation: ±1 s tolerance per scored reproduction. Early stop uses mean-error and MAD stability
                (see stable-stop gates), not this percentage alone.
              </p>
            )}
            {taskKey === "flanker" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Flanker: this row is overall correct / responses. Stable stopping also requires incongruent-error CI and
                interference cost stability (see below).
              </p>
            )}
            {taskKey === "cpt" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                CPT: early stop is <span className="text-foreground">not</span> driven by overall % correct or high
                withhold accuracy. The engine needs omission Wilson CI ≤ 0.08 (usually ≤2–3 target omissions at ~80
                targets), commission CI ≤ 0.08, stable RT variability, stable lapse rate, and stable time-on-task slope —
                all at trials 150, 210, 270, 330. A strong non-target line (~99% withholds) can still fail if targets
                are missed or lapse rate moves between checkpoints.
              </p>
            )}
          </div>

          <div>
            <p className="font-semibold text-primary">When adaptive stopping fires</p>
            <ul className="list-disc pl-4 text-[10px] text-muted-foreground">
              <li>
                Only after an <span className="text-foreground">evaluation checkpoint</span> (live panel shows{" "}
                <span className="text-foreground">evaluated</span>; otherwise rows advance but the engine does not
                decide stop yet).
              </li>
              <li>
                The engine returns{" "}
                <code className="rounded bg-muted px-0.5 font-mono text-[10px]">stop_stable</code>{" "}
                {taskKey === "digit_span"
                  ? "when the staircase battery completes (spanBatteryComplete), or "
                  : "when spec confidence rules pass, or "}
                <code className="rounded bg-muted px-0.5 font-mono text-[10px]">stop_max_low_confidence</code> when the
                session/spec max is reached without stability.
              </li>
              <li>
                Either outcome sets CAT block-end (
                <code className="rounded bg-muted px-0.5 font-mono text-[10px]">main_adaptive_stop</code>) so the UI can
                end the block like other CAT stops. The active trigger is cleared immediately for routing; the debug
                panel also shows the last signal (latched).
              </li>
              <li>
                Until then, keep collecting trials — the <span className="text-foreground">a / n</span> table tracks gates;
                the <span className="text-foreground">Outcome hint</span> reflects the last evaluation boundary (see Live
                evaluation).
              </li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-primary">Policy (spec presets)</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              <li>
                Min trials: <span className="text-foreground">{policy.minTrials}</span> · Max:{" "}
                <span className="text-foreground">{effectiveMax}</span>
                {snap.sessionMaxTrials != null ? (
                  <span className="text-muted-foreground"> (session max {snap.sessionMaxTrials})</span>
                ) : null}
              </li>
              <li>
                Checkpoint every: <span className="text-foreground">{policy.checkpointEvery}</span>{" "}
                <span className="text-muted-foreground">(task-specific unit)</span>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-primary">Stopping / difficulty (spec gist)</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {specLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-semibold text-primary">CAT block-end</p>
            <p className={shouldTrigger ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
              Active trigger: {shouldTrigger ? "yes" : "no"}
              {triggerReason ? ` (${triggerReason})` : ""}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Last signal (latched):{" "}
              <span className="font-mono text-foreground">
                {lastBlockEndSignalReason ?? "—"}
              </span>
              {lastBlockEndSignalReason ? (
                <>
                  {" — "}
                  Persists after the active flag clears for routing.
                </>
              ) : (
                <>
                  {" — "}
                  No block-end signal yet this run.
                </>
              )}
            </p>
          </div>

          <div>
            <p className="font-semibold text-primary">Live evaluation</p>
            <p className="text-muted-foreground">
              This refresh (trial {checkpoint?.trialsCompleted ?? "—"}):{" "}
              <span className="text-foreground">
                {!checkpoint
                  ? "no data yet"
                  : snap.atEvaluationPoint
                    ? "evaluation boundary — engine ran"
                    : "between checkpoints — engine skipped (trial metrics still update)"}
              </span>
              {taskKey === "task_switching" && nextTsEval != null ? (
                <>
                  {" · "}
                  Next evaluation at trial:{" "}
                  <span className="font-mono text-foreground">{nextTsEval}</span>
                </>
              ) : null}
              {" · "}
              Rolling checkpoints in history:{" "}
              <span className="text-foreground">{snap.taskKey === taskKey ? snap.historyCheckpointCount : 0}</span>
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Last full evaluation at trial:{" "}
              <span className="font-mono text-foreground">
                {snap.taskKey === taskKey && snap.lastEvaluatedTrialsCompleted != null
                  ? snap.lastEvaluatedTrialsCompleted
                  : "—"}
              </span>
              {" — "}
              Outcome / reason below reflect that run (persist until the next boundary).
            </p>
            <p className="mt-1 text-muted-foreground">
              <span className="font-medium text-foreground">Outcome hint:</span> {decisionLabel}
            </p>
            <p className="text-muted-foreground">
              Rolling low-confidence flag:{" "}
              <span className="text-foreground">{snap.rollingLowConfidence ? "yes" : "no"}</span>
            </p>
            {snap.evaluation && taskKey !== "flanker" && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Confidence uses task-specific gates in code (not always raw accuracy). Engine reason:{" "}
                <span className="font-mono text-foreground">{snap.evaluation.adaptiveStoppingReason}</span>
              </p>
            )}
            {snap.evaluation && (
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                <li>
                  Confidence met:{" "}
                  <span className="text-foreground">{snap.evaluation.confidenceMet ? "yes" : "no"}</span>
                </li>
                <li>
                  Recommended difficulty:{" "}
                  <span className="text-foreground">{snap.evaluation.recommendedDifficulty}</span>
                </li>
                <li>Reason: {snap.evaluation.adaptiveStoppingReason}</li>
                {snap.evaluation.validityFlags.length > 0 && (
                  <li className="text-amber-700 dark:text-amber-300">
                    Flags: {snap.evaluation.validityFlags.join(", ")}
                  </li>
                )}
              </ul>
            )}
            <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">
              {cpPlain ? checkpointSummary(cpPlain) : "Checkpoint metrics populate during main trials."}
            </p>
          </div>

          <p className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
            Hidden in production by default. Enable locally with{" "}
            <code className="rounded bg-muted px-1">VITE_SHOW_MAIN_ADAPTIVE_DEBUG=true</code> in{" "}
            <code className="rounded bg-muted px-1">.env.local</code>.
          </p>
        </div>
      )}
    </div>
  );
}
