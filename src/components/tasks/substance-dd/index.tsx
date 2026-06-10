import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Play } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskTransition } from "../TaskTransition";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { Button } from "@/components/ui/Button";
import { substanceDDStore } from "@/stores/substanceDDStore";
import { catStore } from "@/stores/catStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";
import { toast } from "@/lib/toast";

const FEEDBACK_SETTLE_MS = 1600;

export default function SubstanceDDTask() {
  usePrepareTaskFreshRun(() => {
    substanceDDStore.getState().prepareForFreshRun();
  });
  const phase = substanceDDStore((s) => s.phase);
  const trialIndex = substanceDDStore((s) => s.trialIndex);
  const trials = substanceDDStore((s) => s.trials);
  const maxTrials = substanceDDStore((s) => s.maxTrials);
  const startSession = substanceDDStore((s) => s.startSession);
  const recordChoice = substanceDDStore((s) => s.recordChoice);
  const finishAndSave = substanceDDStore((s) => s.finishAndSave);
  const setStimulusOnset = substanceDDStore((s) => s.setStimulusOnset);
  const markDistress = substanceDDStore((s) => s.markDistress);
  const sessionId = substanceDDStore((s) => s.sessionId);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const choiceEventsCompleted = substanceDDStore((s) => s.events.length);
  const cleanup = useCallback(() => {}, []);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "running";
  const mainCountdownStarted = useRef(false);

  const navigate = useNavigate();
  const isRouting = catStore((s) => s.isRouting);
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const clearTrigger = catStore((s) => s.clearTrigger);

  const handleStartSession = useCallback(() => {
    startCountdown("practice", () => {
      return startSession();
    });
  }, [startSession, startCountdown]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      return;
    }
    if (phase === "running" && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      startCountdown("main", () => {});
    }
  }, [phase, startCountdown]);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      if (!sessionId) return;
      const decision = await requestRoutingDecision(sessionId, "substance_dd", reason, {});
      if (!decision) {
        substanceDDStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        toast.info(
          `Extension (${decision.trials_to_add} trials) suggested; short-form routing will continue.`,
        );
      }
      if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        substanceDDStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        substanceDDStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "running") return;
    const reason = triggerReason || "trial_threshold";
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
    triggerReason,
    clearTrigger,
    finishAndSave,
    handleRoutingDecision,
  ]);

  useEffect(() => {
    if (phase === "complete") {
      const id = setTimeout(() => {
        finishAndSave().then(() => handleRoutingDecision("block_end"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, finishAndSave, handleRoutingDecision]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      e.preventDefault();
      const s = substanceDDStore.getState();
      if (s.phase !== "practice" && s.phase !== "running") return;
      recordChoice(e.code);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordChoice]);

  useEffect(() => {
    if (countdown?.phase === "main") return;
    if (shouldTrigger && phase === "running") return;
    if ((phase === "practice" || phase === "running") && trials.length > 0) setStimulusOnset();
  }, [phase, trialIndex, trials.length, setStimulusOnset, countdown, shouldTrigger]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="substance_dd" showMainAdaptivePanel={showMainAdaptivePanel} title="Substance delay discounting">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="substance_dd" showMainAdaptivePanel={showMainAdaptivePanel} title="Substance delay discounting">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="substance_dd" showMainAdaptivePanel={showMainAdaptivePanel} title="Substance delay discounting">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">Timing of rewards (neutral)</h2>
          <p className="text-muted-foreground">
            You will choose between a smaller hypothetical benefit now and a larger one after a delay. Amounts are
            symbolic only. Use <kbd className="rounded border px-1">←</kbd> for the left option and{" "}
            <kbd className="rounded border px-1">→</kbd> for the right.
          </p>
          <p className="text-sm text-muted-foreground">
            Main block: 12–30 scored trials (adaptive). Checkpoints every 6 trials after the minimum. Do not use this
            module where substance-related cognitive tasks are clinically inappropriate for your setting.
          </p>
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
    const t = trials[trialIndex];
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="substance_dd" showMainAdaptivePanel={showMainAdaptivePanel} title="Substance delay discounting">
        {phase === "practice" && (
          <p className="mb-2 text-center text-sm text-muted-foreground">Practice block</p>
        )}
        <TaskTrialCard
          progress={
            <>
              <PracticeProgressBar
                label={phase === "practice" ? "Practice" : "Main"}
                currentTrial={phase === "practice" ? choiceEventsCompleted : Math.min(choiceEventsCompleted, maxTrials)}
                maxTrials={Math.max(maxTrials, 1)}
              />
              <div className="flex justify-center">
                <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={markDistress}>
                  Uncomfortable — flag for review
                </Button>
              </div>
            </>
          }
          contentClassName="flex flex-col items-center justify-center"
        >
          <div className="flex gap-12">
            <div
              className={`rounded-xl border-2 p-6 text-center transition-colors ${
                t.immediateOnLeft ? "border-primary bg-primary/5" : "border-muted"
              }`}
            >
              <p className="text-3xl font-bold">${t.immediateAmount}</p>
              <p className="text-sm text-muted-foreground">Now</p>
            </div>
            <div
              className={`rounded-xl border-2 p-6 text-center transition-colors ${
                !t.immediateOnLeft ? "border-primary bg-primary/5" : "border-muted"
              }`}
            >
              <p className="text-3xl font-bold">${t.delayedAmount}</p>
              <p className="text-sm text-muted-foreground">in {t.delayDays} days</p>
            </div>
          </div>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="substance_dd" showMainAdaptivePanel={showMainAdaptivePanel} title="Substance delay discounting">
        <TaskTransition completedTask="substance_dd" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
