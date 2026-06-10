import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Gauge } from "lucide-react";
import { ciTargetForMode } from "@/lib/mainAdaptiveEngine";
import { MAIN_ADAPTIVE_SPEC_SUMMARY } from "@/lib/mainAdaptiveSpecSummary";
import {
  firstFailingFlankerGate,
  firstFailingTimeEstimationGate,
  flankerConfidenceGates,
  timeEstimationConfidenceGates,
} from "@/lib/mainAdaptiveConfidenceHints";
import { formatCheckpointCorrectSummary } from "@/lib/mainAdaptiveCheckpointScore";
import { stoppingRuleRows } from "@/lib/mainAdaptiveStoppingProgress";
import { checkpointSummary, mainAdaptiveDecisionLabel } from "@/lib/mainAdaptiveDebugPresentation";
import { parsePersistedMainAdaptiveDebug } from "@/lib/mainAdaptiveDebugSnapshot";

function nextTaskSwitchingEvalTrial(completed: number, minT: number, every: number): number {
  if (every <= 0) return Math.max(completed, minT);
  if (completed < minT) return minT;
  const past = completed - minT;
  return minT + Math.ceil((past + 1) / every) * every;
}

type Props = { raw: unknown };

/**
 * Read-only summary from `metrics.main_adaptive_debug` (same data the floating debug panel used at score time).
 */
export function MainAdaptiveResultsSummary({ raw }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const snap = useMemo(() => parsePersistedMainAdaptiveDebug(raw), [raw]);
  if (!snap) return null;

  const taskKey = snap.taskKey;
  const policy = snap.policy;
  const checkpoint = snap.checkpoint;
  const mode = snap.mode;
  const ciTarget = useMemo(() => ciTargetForMode(mode), [mode]);
  const effectiveMax = snap.effectiveMaxTrials || policy.maxTrials;
  const trialsDone = checkpoint?.trialsCompleted ?? 0;
  const nextTsEval =
    taskKey === "task_switching" && trialsDone < effectiveMax
      ? nextTaskSwitchingEvalTrial(trialsDone, policy.minTrials, policy.checkpointEvery)
      : null;
  const ruleRows = stoppingRuleRows(
    taskKey,
    checkpoint,
    policy,
    effectiveMax,
    snap.recentCheckpoints,
  );
  const correctSummary = useMemo(
    () => formatCheckpointCorrectSummary(taskKey, checkpoint),
    [taskKey, checkpoint],
  );
  const specLines = MAIN_ADAPTIVE_SPEC_SUMMARY[taskKey];
  const decision = snap.evaluation?.decision;
  const decisionLabel = useMemo(
    () => mainAdaptiveDecisionLabel(taskKey, decision, checkpoint),
    [taskKey, decision, checkpoint],
  );

  const cpPlain = checkpoint ? (JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>) : null;

  const flankerCheckpointTrail = useMemo(() => {
    if (snap.recentCheckpoints.length > 0) return snap.recentCheckpoints;
    if (checkpoint) return [checkpoint];
    return [];
  }, [snap.recentCheckpoints, checkpoint]);

  const flankerGateRows = useMemo(() => {
    if (taskKey !== "flanker" || flankerCheckpointTrail.length === 0) return [];
    return flankerConfidenceGates(mode, flankerCheckpointTrail);
  }, [taskKey, mode, flankerCheckpointTrail]);

  const flankerTypicalBlocker = useMemo(
    () => (taskKey === "flanker" ? firstFailingFlankerGate(flankerGateRows) : null),
    [taskKey, flankerGateRows],
  );

  const timeEstCheckpointTrail = useMemo(() => {
    if (snap.recentCheckpoints.length > 0) return snap.recentCheckpoints;
    if (checkpoint) return [checkpoint];
    return [];
  }, [snap.recentCheckpoints, checkpoint]);

  const timeEstGateRows = useMemo(() => {
    if (taskKey !== "time_estimation" || timeEstCheckpointTrail.length === 0) return [];
    return timeEstimationConfidenceGates(timeEstCheckpointTrail, checkpoint ?? undefined);
  }, [taskKey, timeEstCheckpointTrail, checkpoint]);

  const timeEstTypicalBlocker = useMemo(
    () => (taskKey === "time_estimation" ? firstFailingTimeEstimationGate(timeEstGateRows) : null),
    [taskKey, timeEstGateRows],
  );

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-primary/25 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-2 border-b border-border/60 bg-primary/10 px-3 py-2 text-left text-xs font-semibold text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 shrink-0 text-primary" />
          Main adaptive (saved at score)
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>
      {!collapsed && (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto p-3 text-[11px] leading-snug text-foreground">
          {snap.capturedAt ? (
            <p className="text-[10px] text-muted-foreground">Captured {new Date(snap.capturedAt).toLocaleString()}</p>
          ) : null}

          <div>
            <p className="font-semibold text-primary">Task</p>
            <p className="font-mono text-muted-foreground">{taskKey}</p>
            <p className="mt-1 text-muted-foreground">
              Mode: <span className="text-foreground">{mode}</span> · CI target ~{ciTarget.toFixed(2)} (binomial where
              applicable)
            </p>
          </div>

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

          {taskKey === "task_switching" && checkpoint != null && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Trial rounds (main block)</p>
              <ul className="mt-1.5 space-y-1 font-mono text-[10px] text-foreground">
                <li>
                  <span className="text-muted-foreground">Progress:</span> {checkpoint.trialsCompleted} / {effectiveMax}{" "}
                  scored trials
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
            </div>
          )}

          {taskKey === "flanker" && flankerGateRows.length > 0 && (
            <div className="rounded-lg border border-primary/35 bg-primary/5 p-2.5 shadow-sm">
              <p className="font-semibold text-primary">Confidence (engine)</p>
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
            <div className="mt-1 overflow-x-auto rounded-md border border-border/60">
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
          </div>

          <div>
            <p className="font-semibold text-primary">Correctness (latest checkpoint)</p>
            <p className="break-words font-mono text-[10px] text-foreground">
              {correctSummary ?? (
                <span className="text-muted-foreground">— not available for this task at this checkpoint</span>
              )}
            </p>
            {taskKey === "time_estimation" ? (
              <p className="mt-1 text-[9px] text-muted-foreground">
                ±1 s tolerance per reproduction; adaptive early stop uses timing stability (not this rate).
              </p>
            ) : null}
            {taskKey === "cpt" ? (
              <p className="mt-1 text-[9px] text-muted-foreground">
                CPT early stop uses Wilson CI on omissions/commissions and lapse/slope stability — not overall % correct.
                High withhold % alone does not trigger stop; target omissions and lapse rate must also stabilize.
              </p>
            ) : null}
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
                Checkpoint every: <span className="text-foreground">{policy.checkpointEvery}</span>
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
            <p className="font-semibold text-primary">CAT block-end (at score)</p>
            <p className={snap.catShouldTrigger ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
              Active trigger: {snap.catShouldTrigger ? "yes" : "no"}
              {snap.catTriggerReason ? ` (${snap.catTriggerReason})` : ""}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Last signal (latched):{" "}
              <span className="font-mono text-foreground">{snap.catLastBlockEndReason ?? "—"}</span>
            </p>
          </div>

          <div>
            <p className="font-semibold text-primary">Evaluation at score</p>
            <p className="text-muted-foreground">
              Trial {checkpoint?.trialsCompleted ?? "—"}:{" "}
              <span className="text-foreground">
                {snap.atEvaluationPoint ? "evaluation boundary — engine ran" : "between checkpoints — engine skipped"}
              </span>
              {taskKey === "task_switching" && nextTsEval != null ? (
                <>
                  {" · "}
                  Next evaluation at trial: <span className="font-mono text-foreground">{nextTsEval}</span>
                </>
              ) : null}
              {" · "}Rolling checkpoints: <span className="text-foreground">{snap.historyCheckpointCount}</span>
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Last full evaluation at trial:{" "}
              <span className="font-mono text-foreground">
                {snap.lastEvaluatedTrialsCompleted != null ? snap.lastEvaluatedTrialsCompleted : "—"}
              </span>
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
                Engine reason:{" "}
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
                {snap.evaluation && (snap.evaluation.validityFlags?.length ?? 0) > 0 && (
                  <li className="text-amber-700 dark:text-amber-300">
                    Flags: {(snap.evaluation.validityFlags ?? []).join(", ")}
                  </li>
                )}
              </ul>
            )}
            <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">
              {cpPlain ? checkpointSummary(cpPlain) : "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
