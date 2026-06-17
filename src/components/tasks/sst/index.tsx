import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { SSTInstructions } from "./SSTInstructions";
import { SSTStimulus } from "./SSTStimulus";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { sstStore } from "@/stores/sstStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function StopSignalTask() {
  usePrepareTaskFreshRun(() => {
    sstStore.getState().prepareForFreshRun();
  });

  const phase = sstStore((s) => s.phase);
  const trialIndex = sstStore((s) => s.trialIndex);
  const trials = sstStore((s) => s.trials);
  const maxTrials = sstStore((s) => s.maxTrials);
  const currentStimulus = sstStore((s) => s.currentStimulus);
  const startPractice = sstStore((s) => s.startPractice);
  const resumePractice = sstStore((s) => s.resumePractice);
  const restartMain = sstStore((s) => s.restartMain);
  const startExtension = sstStore((s) => s.startExtension);
  const advanceTrial = sstStore((s) => s.advanceTrial);
  const finishMain = sstStore((s) => s.finishMain);
  const practiceState = sstStore((s) => s.practiceState);
  const lastPracticeFeedback = sstStore((s) => s.lastPracticeFeedback);
  const lastPracticeCorrectKey = sstStore((s) => {
    const last = s._refs.practiceEvents[s._refs.practiceEvents.length - 1] as Record<string, unknown> | undefined;
    return (last?.correct_key as string | null | undefined) ?? null;
  });
  const practiceFeedbackKey = sstStore((s) => s._refs.practiceEvents.length);
  const mainFeedbackKey = sstStore((s) => s._refs.events.length);
  const lastMainEvent = sstStore((s) => s._refs.events[s._refs.events.length - 1] as Record<string, unknown> | undefined);
  const practiceReinstruction = sstStore((s) => s.practiceReinstruction);
  const practiceReinstructionLevel = sstStore((s) => s.practiceReinstructionLevel);
  const practiceReinstructionHint = sstStore((s) => s.practiceReinstructionHint);
  const mainReinstruction = sstStore((s) => s.mainReinstruction);
  const eventsCompleted = sstStore((s) => s.events.length);
  const finishExtension = sstStore((s) => s.finishExtension);
  const cleanup = sstStore((s) => s.cleanup);
  const resumeAfterPause = sstStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const sessionId = sstStore((s) => s.sessionId);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "main" || phase === "extension";
  const mainCountdownStarted = useRef(false);
  const handleStartPractice = useCallback(() => {
    startCountdown("practice", () => {
      if (mainReinstruction) return restartMain();
      return practiceReinstruction ? resumePractice() : startPractice();
    });
  }, [mainReinstruction, practiceReinstruction, restartMain, resumePractice, startPractice, startCountdown]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      return;
    }
    if (phase === "main" && !mainCountdownStarted.current) {
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
      const decision = await requestRoutingDecision(sessionId!, "sst", reason, {});
      if (!decision) {
        sstStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        sstStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        sstStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main" && phase !== "extension") return;
    const reason = triggerReason || "trial_threshold";
    cleanup();
    const id = setTimeout(() => {
      finishMain().then((shouldRoute) => {
        clearTrigger();
        if (shouldRoute) void handleRoutingDecision(reason);
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [shouldTrigger, sessionId, phase, triggerReason, clearTrigger, cleanup, finishMain, handleRoutingDecision]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (shouldTrigger && (phase === "main" || phase === "extension")) return;
    if ((phase === "practice" || phase === "main" || phase === "extension") && trials.length > 0 && trialIndex < trials.length) {
      advanceTrial();
    }
    return () => cleanup();
  }, [phase, trials, trialIndex, advanceTrial, cleanup, countdown, shouldTrigger, isPaused]);

  // Practice completion is handled by addPracticeEvent in the store

  useEffect(() => {
    if (phase === "main" && sessionId && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishMain().then((shouldRoute) => {
          if (shouldRoute) void handleRoutingDecision("block_end");
        });
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, sessionId, trialIndex, trials.length, finishMain, handleRoutingDecision]);

  useEffect(() => {
    if (phase === "extension" && sessionId && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishExtension().then(() => handleRoutingDecision("extension_complete"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, sessionId, trialIndex, trials.length, finishExtension, handleRoutingDecision]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        <SSTInstructions
          onStart={handleStartPractice}
          isReinstruction={practiceReinstruction}
          reinstructionLevel={practiceReinstructionLevel ?? undefined}
          reinstructionHint={practiceReinstructionHint ?? undefined}
        />
      </TaskLayout>
    );
  }

  if (phase === "practice" && trials.length === 0) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Practice complete. Starting main task...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "practice" || phase === "main" || phase === "extension") {
    const feedbackType = phase === "practice"
      ? lastPracticeFeedback
      : lastMainEvent
        ? ((lastMainEvent.is_correct === true
          ? "correct"
          : ((lastMainEvent.reaction_time_ms as number | null | undefined) == null ? "omission" : "incorrect")))
        : null;
    const feedbackAnswer = phase === "practice"
      ? lastPracticeCorrectKey
      : ((lastMainEvent?.correct_key as string | null | undefined) ?? null);
    const feedbackKey = phase === "practice" ? practiceFeedbackKey : mainFeedbackKey;
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        {phase === "extension" && (
          <p className="mb-2 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            phase === "practice" && practiceState ? (
              <PracticeProgressBar
                currentTrial={practiceState.totalTrialsCompleted}
                maxTrials={sstStore.getState()._refs.practiceConfig.maxTrials}
                subPhase={practiceState.subPhase}
              />
            ) : (
              <PracticeProgressBar
                currentTrial={eventsCompleted}
                maxTrials={maxTrials}
                label={phase === "extension" ? "Extension" : "Main"}
              />
            )
          }
        >
          <div className="relative w-full">
            <SSTStimulus
              stimulus={currentStimulus}
              completedTrials={
                phase === "practice"
                  ? (practiceState?.totalTrialsCompleted ?? 0)
                  : eventsCompleted
              }
              totalTrials={
                phase === "practice" ? sstStore.getState()._refs.practiceConfig.maxTrials : maxTrials
              }
              phase={phase}
              practiceSubPhase={practiceState?.subPhase}
            />
            {phase === "practice" && (
              <PracticeFeedback
                feedbackType={feedbackType}
                correctAnswer={feedbackAnswer}
                feedbackKey={feedbackKey}
              />
            )}
          </div>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="sst" showMainAdaptivePanel={showMainAdaptivePanel} title="SST">
        <TaskTransition completedTask="sst" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
