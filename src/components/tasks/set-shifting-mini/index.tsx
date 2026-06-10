import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { Button } from "@/components/ui/Button";
import { setShiftingMiniStore, setShiftingRuleText } from "@/stores/setShiftingMiniStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function SetShiftingMiniTask() {
  usePrepareTaskFreshRun(() => {
    setShiftingMiniStore.getState().prepareForFreshRun();
  });
  const phase = setShiftingMiniStore((s) => s.phase);
  const isPractice = setShiftingMiniStore((s) => s.isPractice);
  const showMainAdaptivePanel =
    !isPractice && phase !== "instructions" && phase !== "complete";
  const trialIndex = setShiftingMiniStore((s) => s.trialIndex);
  const trials = setShiftingMiniStore((s) => s.trials);
  const activeRule = setShiftingMiniStore((s) => s.activeRule);
  const status = setShiftingMiniStore((s) => s.status);
  const lastWasCorrect = setShiftingMiniStore((s) => s.lastWasCorrect);
  const lastTimedOut = setShiftingMiniStore((s) => s.lastTimedOut);
  const lastCorrectLabel = setShiftingMiniStore((s) => s.lastCorrectLabel);
  const practiceDoneTrials = setShiftingMiniStore((s) => s.practiceDoneTrials);
  const practiceTotalTrials = setShiftingMiniStore((s) => s.practiceTotalTrials);
  const mainDoneTrials = setShiftingMiniStore((s) => s.mainDoneTrials);
  const mainTotalTrials = setShiftingMiniStore((s) => s.mainTotalTrials);
  const startSession = setShiftingMiniStore((s) => s.startSession);
  const recordSelection = setShiftingMiniStore((s) => s.recordSelection);
  const finishAndSave = setShiftingMiniStore((s) => s.finishAndSave);
  const cleanup = setShiftingMiniStore((s) => s.cleanup);
  const resumeAfterPause = setShiftingMiniStore((s) => s.resumeAfterPause);
  const sessionId = setShiftingMiniStore((s) => s.sessionId);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const navigate = useNavigate();
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const clearTrigger = catStore((s) => s.clearTrigger);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const [saveDone, setSaveDone] = useState(false);
  const { countdown, startCountdown, cancelCountdown } = useTaskStartCountdown();

  const handleStartSession = useCallback(() => {
    startCountdown("practice", () => {
      return startSession();
    });
  }, [startSession, startCountdown]);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      if (!sessionId) return;
      const decision = await requestRoutingDecision(sessionId, "set_shifting_mini", reason, {});
      if (!decision) {
        setShiftingMiniStore.setState({ phase: "complete" });
        return;
      }
      if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        setShiftingMiniStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        setShiftingMiniStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId || isPaused) return;
    if (isPractice) return;
    if (
      phase === "instructions" ||
      phase === "complete" ||
      phase === "main_countdown_pending" ||
      phase === "main_countdown_go"
    ) {
      return;
    }
    const reason = triggerReason || "trial_threshold";
    cleanup();
    const id = setTimeout(() => {
      finishAndSave().then(() => {
        clearTrigger();
        handleRoutingDecision(reason);
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [
    shouldTrigger,
    sessionId,
    phase,
    isPractice,
    isPaused,
    triggerReason,
    clearTrigger,
    cleanup,
    finishAndSave,
    handleRoutingDecision,
  ]);

  /** Main 3-2-1 arms only after the store leaves `main_countdown_pending` (see setShiftingMiniStore). */
  useLayoutEffect(() => {
    if (phase !== "main_countdown_go") return;
    startCountdown("main", () => {
      const rule = setShiftingMiniStore.getState().trials[0]?.rule ?? null;
      setShiftingMiniStore.setState({
        phase: "running",
        status: "stimulus",
        activeRule: rule,
        lastWasCorrect: null,
        lastTimedOut: false,
        lastCorrectLabel: "",
      });
      setShiftingMiniStore.getState().startMainPhase();
    });
  }, [phase, startCountdown]);

  /* Trial feedback must never be hidden behind a stale 3-2-1 overlay. */
  useEffect(() => {
    if (phase === "feedback") cancelCountdown();
  }, [phase, cancelCountdown]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (phase !== "complete") {
      setSaveDone(false);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      finishAndSave()
        .then(() => handleRoutingDecision("block_end"))
        .finally(() => {
          if (!cancelled) setSaveDone(true);
        });
    }, FEEDBACK_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [phase, finishAndSave, handleRoutingDecision]);

  const totalRounds = isPractice ? practiceTotalTrials : mainTotalTrials;
  const roundsCompletedUi = Math.min(isPractice ? practiceDoneTrials : mainDoneTrials, totalRounds);
  const progressCurrent = (() => {
    if (!isPractice) {
      return phase === "feedback" ? trialIndex + 1 : mainDoneTrials;
    }
    return phase === "feedback" ? trialIndex + 1 : practiceDoneTrials;
  })();
  const progressMax = isPractice ? practiceTotalTrials : mainTotalTrials;
  const progressLabel = isPractice ? "Practice" : "Main";

  if (phase === "feedback") {
    const feedbackOrdinal = trialIndex + 1;
    const lastInBlock = trials.length > 0 && trialIndex === trials.length - 1;

    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <TaskTrialCard
          progress={
            progressMax > 0 ? (
              <PracticeProgressBar
                label={progressLabel}
                currentTrial={progressCurrent}
                maxTrials={progressMax}
              />
            ) : undefined
          }
          contentClassName="flex flex-col items-center justify-center gap-4"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {isPractice
              ? `Practice feedback — trial ${feedbackOrdinal} of ${practiceTotalTrials}`
              : `Main feedback — trial ${feedbackOrdinal} of ${mainTotalTrials}`}
          </p>
          {isPractice ? (
            <>
              {lastWasCorrect === true ? (
                <p className="text-2xl font-semibold text-emerald-600">Correct</p>
              ) : lastWasCorrect === false ? (
                <>
                  <p className="text-2xl font-semibold text-rose-600">Not quite</p>
                  <p className="text-sm text-muted-foreground">
                    {lastTimedOut ? "Time up." : "Incorrect choice."} Correct:{" "}
                    <span className="font-medium">{lastCorrectLabel || "—"}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Recorded…</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Response recorded.</p>
          )}
          {!isPractice && lastInBlock && (
            <p className="text-sm text-muted-foreground">Finishing task…</p>
          )}
          {!isPractice && !lastInBlock && (
            <p className="text-sm text-muted-foreground">Next trial shortly…</p>
          )}
          {isPractice && lastInBlock && (
            <p className="text-sm font-medium text-foreground">
              Practice complete — starting main test next.
            </p>
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (phase === "main_countdown_pending" || phase === "main_countdown_go") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Practice trial {practiceTotalTrials} of {practiceTotalTrials}
          </p>
          {lastWasCorrect === true ? (
            <p className="text-2xl font-semibold text-emerald-600">Correct</p>
          ) : lastWasCorrect === false ? (
            <>
              <p className="text-2xl font-semibold text-rose-600">Not quite</p>
              {lastTimedOut ? (
                <p className="text-sm text-muted-foreground">Time up.</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Correct:{" "}
                  <span className="font-medium text-foreground">{lastCorrectLabel || "—"}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Practice round finished.</p>
          )}
          <p className="text-sm text-muted-foreground">Practice complete — main task starts next.</p>
          <p className="text-xs text-muted-foreground">Get ready…</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">Set shifting (short)</h2>
          <p className="text-muted-foreground">
            You will see four shapes with colors. The banner tells you the current rule (for example, click square items).
            Click the <strong>one</strong> item that satisfies that rule.
          </p>
          <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
            <li>
              <strong>If two items look like they both match</strong> (e.g. two squares in different colors), only{" "}
              <strong>one</strong> is the scored answer. Use the grid order: <strong>start at the top-left</strong>, move
              left to right on the top row, then the bottom row — pick the <strong>first</strong> item along that path
              that clearly matches the rule.
            </li>
            <li>
              The rule can change after you meet a streak of correct trials; when it does, follow the new banner, not
              the old habit.
            </li>
            <li>You can take a moment to read the rule before each choice; respond before time runs out.</li>
          </ul>
          <Button
            onClick={handleStartSession}
            className="inline-flex items-center gap-1.5"
          >
            <Play className="h-4 w-4" />
            Begin
          </Button>
        </div>
      </TaskLayout>
    );
  }

  if ((phase === "practice" || phase === "running") && trials[trialIndex]) {
    const trial = trials[trialIndex];
    const wasSwitch = trial.previousRule && trial.previousRule !== trial.rule;
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <TaskTrialCard
          progress={
            progressMax > 0 ? (
              <PracticeProgressBar
                label={progressLabel}
                currentTrial={progressCurrent}
                maxTrials={progressMax}
              />
            ) : undefined
          }
          contentClassName="flex flex-col items-center justify-center gap-6"
        >
          <p className="rounded border border-border/60 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {isPractice ? "Practice" : "Main"} — completed {roundsCompletedUi} / {totalRounds}
          </p>
          <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            Rule: {activeRule ? setShiftingRuleText[activeRule] : setShiftingRuleText[trial.rule]}
          </div>
          {wasSwitch && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              Rule changed! Adapt quickly.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            {trial.items.map((item) => {
              const bgClass =
                item.color === "red"
                  ? "bg-rose-500/20 border-rose-500/40"
                  : item.color === "blue"
                    ? "bg-blue-500/20 border-blue-500/40"
                    : "bg-emerald-500/20 border-emerald-500/40";
              const shape =
                item.shape === "circle" ? "●" : item.shape === "square" ? "■" : "▲";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => status === "stimulus" && recordSelection(item.id)}
                  disabled={status !== "stimulus"}
                  className={`flex h-24 w-28 items-center justify-center rounded-xl border text-4xl font-bold transition ${bgClass} ${
                    status === "stimulus" ? "hover:scale-[1.02]" : "opacity-70"
                  }`}
                >
                  {shape}
                </button>
              );
            })}
          </div>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    if (!saveDone) {
      return (
        <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
          <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground">
            Saving Set Shifting Mini results...
          </div>
        </TaskLayout>
      );
    }
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="set_shifting_mini" showMainAdaptivePanel={showMainAdaptivePanel} title="Set-Shifting (Short)">
        <TaskTransition completedTask="set_shifting_mini" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
