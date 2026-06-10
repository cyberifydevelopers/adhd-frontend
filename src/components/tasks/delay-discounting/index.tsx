import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskTransition } from "../TaskTransition";
import { DelayDiscountingInstructions } from "./DelayDiscountingInstructions";
import { DelayDiscountingChoice } from "./DelayDiscountingChoice";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { delayDiscountingStore } from "@/stores/delayDiscountingStore";
import { catStore } from "@/stores/catStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function DelayDiscountingTask() {
  usePrepareTaskFreshRun(() => {
    delayDiscountingStore.getState().prepareForFreshRun();
  });
  const phase = delayDiscountingStore((s) => s.phase);
  const trialIndex = delayDiscountingStore((s) => s.trialIndex);
  const trials = delayDiscountingStore((s) => s.trials);
  const maxTrials = delayDiscountingStore((s) => s.maxTrials);
  const startSession = delayDiscountingStore((s) => s.startSession);
  const startExtension = delayDiscountingStore((s) => s.startExtension);
  const recordChoice = delayDiscountingStore((s) => s.recordChoice);
  const finishAndSave = delayDiscountingStore((s) => s.finishAndSave);
  const setStimulusOnset = delayDiscountingStore((s) => s.setStimulusOnset);
  const sessionId = delayDiscountingStore((s) => s.sessionId);
  const choiceEventsCompleted = delayDiscountingStore((s) => s.events.length);
  const cleanup = useCallback(() => {}, []);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "running" || phase === "extension";
  const mainCountdownStarted = useRef(false);
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


  const navigate = useNavigate();
  const isRouting = catStore((s) => s.isRouting);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const clearTrigger = catStore((s) => s.clearTrigger);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      const decision = await requestRoutingDecision(sessionId!, "delay_discounting", reason, {});
      if (!decision) {
        delayDiscountingStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        delayDiscountingStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        delayDiscountingStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "running" && phase !== "extension") return;
    const reason = triggerReason || "trial_threshold";
    const id = setTimeout(() => {
      finishAndSave().then(() => {
        clearTrigger();
        handleRoutingDecision(reason);
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [shouldTrigger, sessionId, phase, triggerReason, clearTrigger, finishAndSave, handleRoutingDecision]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      e.preventDefault();
      const s = delayDiscountingStore.getState();
      if (s.phase !== "practice" && s.phase !== "running" && s.phase !== "extension") return;
      const trial = s.trials[s.trialIndex];
      if (!trial) return;
      recordChoice(e.code);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordChoice]);

  useEffect(() => {
    if (countdown?.phase === "main") return;
    if (shouldTrigger && (phase === "running" || phase === "extension")) return;
    if ((phase === "practice" || phase === "running" || phase === "extension") && trials.length > 0) {
      setStimulusOnset();
    }
  }, [phase, trialIndex, trials.length, setStimulusOnset, countdown, shouldTrigger]);

  useEffect(() => {
    if (phase === "complete") {
      const id = setTimeout(() => {
        finishAndSave().then(() => handleRoutingDecision("block_end"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, finishAndSave, handleRoutingDecision]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="delay_discounting" showMainAdaptivePanel={showMainAdaptivePanel} title="Delay Discounting">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="delay_discounting" showMainAdaptivePanel={showMainAdaptivePanel} title="Delay Discounting">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="delay_discounting" showMainAdaptivePanel={showMainAdaptivePanel} title="Delay Discounting">
        <DelayDiscountingInstructions onStart={handleStartSession} />
      </TaskLayout>
    );
  }

  if ((phase === "practice" || phase === "running" || phase === "extension") && trials[trialIndex]) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="delay_discounting" showMainAdaptivePanel={showMainAdaptivePanel} title="Delay Discounting">
        {phase === "practice" && (
          <p className="mb-2 text-sm text-muted-foreground">Practice block</p>
        )}
        {phase === "extension" && (
          <p className="mb-2 text-center text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={
                phase === "practice" ? "Practice" : phase === "extension" ? "Extension" : "Main"
              }
              currentTrial={Math.min(choiceEventsCompleted, Math.max(maxTrials, 1))}
              maxTrials={Math.max(maxTrials, 1)}
            />
          }
          contentClassName="flex flex-col items-center justify-center gap-6"
        >
          <DelayDiscountingChoice trial={trials[trialIndex]} />
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} mainAdaptiveTaskKey="delay_discounting" showMainAdaptivePanel={showMainAdaptivePanel} title="Delay Discounting">
        <TaskTransition completedTask="delay_discounting" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
