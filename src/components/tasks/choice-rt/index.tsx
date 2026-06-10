import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { CRTInstructions } from "./CRTInstructions";
import { CRTTrial } from "./CRTTrial";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { crtStore, CORRECT_KEYS_CRT } from "@/stores/crtStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function ChoiceReactionTimeTask() {
  usePrepareTaskFreshRun(() => {
    crtStore.getState().prepareForFreshRun();
  });
  const phase = crtStore((s) => s.phase);
  const status = crtStore((s) => s.status);
  const trialIndex = crtStore((s) => s.trialIndex);
  const trials = crtStore((s) => s.trials);
  const maxTrials = crtStore((s) => s.maxTrials);
  const startPractice = crtStore((s) => s.startPractice);
  const resumePractice = crtStore((s) => s.resumePractice);
  const restartMain = crtStore((s) => s.restartMain);
  const scheduleStimulus = crtStore((s) => s.scheduleStimulus);
  const recordResponse = crtStore((s) => s.recordResponse);
  const startExtension = crtStore((s) => s.startExtension);
  const finishMain = crtStore((s) => s.finishMain);
  const finishExtension = crtStore((s) => s.finishExtension);
  const cleanup = crtStore((s) => s.cleanup);
  const resumeAfterPause = crtStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const sessionId = crtStore((s) => s.sessionId);
  const practiceState = crtStore((s) => s.practiceState);
  const lastPracticeFeedback = crtStore((s) => s.lastPracticeFeedback);
  const lastPracticeCorrectKey = crtStore((s) => {
    const last = s._refs.practiceEvents[s._refs.practiceEvents.length - 1] as Record<string, unknown> | undefined;
    return (last?.correct_key as string | null | undefined) ?? null;
  });
  const practiceFeedbackKey = crtStore((s) => s._refs.practiceEvents.length);
  const mainFeedbackKey = crtStore((s) => s._refs.events.length);
  const lastMainEvent = crtStore((s) => s._refs.events[s._refs.events.length - 1] as Record<string, unknown> | undefined);
  const practiceReinstruction = crtStore((s) => s.practiceReinstruction);
  const practiceReinstructionLevel = crtStore((s) => s.practiceReinstructionLevel);
  const practiceReinstructionHint = crtStore((s) => s.practiceReinstructionHint);
  const mainReinstruction = crtStore((s) => s.mainReinstruction);
  const eventsCompleted = crtStore((s) => s.events.length);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "main" || phase === "extension";
  const mainCountdownStarted = useRef(false);
  const mainCountdownCompleted = useRef(false);
  const handleStartPractice = useCallback(() => {
    startCountdown("practice", () => {
      if (mainReinstruction) return restartMain();
      return practiceReinstruction ? resumePractice() : startPractice();
    });
  }, [mainReinstruction, practiceReinstruction, restartMain, resumePractice, startPractice, startCountdown]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      mainCountdownCompleted.current = false;
      return;
    }
    if (phase === "main" && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      startCountdown("main", () => {
        mainCountdownCompleted.current = true;
      });
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
      const decision = await requestRoutingDecision(sessionId!, "choice_rt", reason, {});
      if (!decision) {
        crtStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        crtStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        crtStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main" && phase !== "extension") return;
    const reason = triggerReason || "trial_threshold";
    /** Keep `shouldTriggerBlockEnd` true until finishMain so crtStore does not schedule more trials / append trials (clearing early allowed stimulus for the next trial). */
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
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) return;
      e.preventDefault();
      const s = crtStore.getState();
      if (s.status !== "stimulus") return;
      const trial = s.trials[s.trialIndex];
      if (!trial) return;
      const isCorrect = e.code === CORRECT_KEYS_CRT[trial.direction];
      recordResponse(e.code, isCorrect);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordResponse]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase === "main" && !mainCountdownCompleted.current) return;
    if (shouldTrigger && (phase === "main" || phase === "extension")) return;
    if ((phase === "practice" || phase === "main" || phase === "extension") && status === "waiting") {
      const trial = trials[trialIndex];
      if (trial) scheduleStimulus(trial.foreperiod, trialIndex, trial.direction);
    }
  }, [phase, status, trialIndex, trials, scheduleStimulus, countdown, shouldTrigger, isPaused]);

  // Practice completion is handled by addPracticeEvent in the store
  // (evaluates at block boundaries and transitions phases automatically)

  useEffect(() => {
    if (phase === "main" && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishMain().then((shouldRoute) => {
          if (shouldRoute) void handleRoutingDecision("block_end");
        });
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, trialIndex, trials.length, finishMain, handleRoutingDecision]);

  useEffect(() => {
    if (phase === "extension" && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishExtension().then(() => handleRoutingDecision("extension_complete"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, trialIndex, trials.length, finishExtension, handleRoutingDecision]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        <CRTInstructions
          onStart={handleStartPractice}
          isReinstruction={practiceReinstruction}
          reinstructionLevel={practiceReinstructionLevel ?? undefined}
          reinstructionHint={practiceReinstructionHint ?? undefined}
        />
      </TaskLayout>
    );
  }

  if ((phase === "practice" || phase === "main" || phase === "extension") && trials.length > 0) {
    const currentTrial = trials[trialIndex];
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
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        {phase === "extension" && (
          <p className="mb-2 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            phase === "practice" && practiceState ? (
              <PracticeProgressBar
                currentTrial={practiceState.totalTrialsCompleted}
                maxTrials={crtStore.getState()._refs.practiceConfig.maxTrials}
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
            <CRTTrial
              status={status}
              direction={status === "stimulus" && currentTrial ? currentTrial.direction : null}
              completedTrials={
                phase === "practice" ? (practiceState?.totalTrialsCompleted ?? 0) : eventsCompleted
              }
              maxTrials={
                phase === "practice" ? crtStore.getState()._refs.practiceConfig.maxTrials : maxTrials
              }
              hideCompletedCaption={phase === "main" || phase === "extension"}
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

  if (phase === "practice" && trials.length === 0) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Practice complete. Starting main task...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="choice_rt" showMainAdaptivePanel={showMainAdaptivePanel} title="Choice Reaction Time">
        <TaskTransition completedTask="choice_rt" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
