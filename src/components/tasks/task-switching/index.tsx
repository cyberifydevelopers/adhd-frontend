import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskSwitchingInstructions } from "./TaskSwitchingInstructions";
import { TaskSwitchingStimulus } from "./TaskSwitchingStimulus";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { taskSwitchingStore } from "@/stores/taskSwitchingStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { rtTrialStateAfterPauseCleanup } from "@/lib/taskPauseGuard";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function TaskSwitchingTask() {
  usePrepareTaskFreshRun(() => {
    taskSwitchingStore.getState().prepareForFreshRun();
  });
  const phase = taskSwitchingStore((s) => s.phase);
  const status = taskSwitchingStore((s) => s.status);
  const trialIndex = taskSwitchingStore((s) => s.trialIndex);
  const trials = taskSwitchingStore((s) => s.trials);
  const maxTrials = taskSwitchingStore((s) => s.maxTrials);
  const startPractice = taskSwitchingStore((s) => s.startPractice);
  const resumePractice = taskSwitchingStore((s) => s.resumePractice);
  const restartMain = taskSwitchingStore((s) => s.restartMain);
  const scheduleStimulus = taskSwitchingStore((s) => s.scheduleStimulus);
  const recordResponse = taskSwitchingStore((s) => s.recordResponse);
  const startExtension = taskSwitchingStore((s) => s.startExtension);
  const finishMain = taskSwitchingStore((s) => s.finishMain);
  const finishExtension = taskSwitchingStore((s) => s.finishExtension);
  const cleanup = taskSwitchingStore((s) => s.cleanup);
  const resumeAfterPause = taskSwitchingStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  useEffect(() => {
    if (isPaused) return;
    const advance = rtTrialStateAfterPauseCleanup(taskSwitchingStore.getState());
    if (advance) taskSwitchingStore.setState(advance);
  }, [isPaused]);
  const sessionId = taskSwitchingStore((s) => s.sessionId);
  const practiceState = taskSwitchingStore((s) => s.practiceState);
  const lastPracticeFeedback = taskSwitchingStore((s) => s.lastPracticeFeedback);
  const lastPracticeCorrectKey = taskSwitchingStore((s) => {
    const last = s._refs.practiceEvents[s._refs.practiceEvents.length - 1] as Record<string, unknown> | undefined;
    return (last?.correct_key as string | null | undefined) ?? null;
  });
  const practiceFeedbackKey = taskSwitchingStore((s) => s._refs.practiceEvents.length);
  const mainFeedbackKey = taskSwitchingStore((s) => s._refs.events.length);
  const lastMainEvent = taskSwitchingStore((s) => s._refs.events[s._refs.events.length - 1] as Record<string, unknown> | undefined);
  const practiceReinstruction = taskSwitchingStore((s) => s.practiceReinstruction);
  const practiceReinstructionLevel = taskSwitchingStore((s) => s.practiceReinstructionLevel);
  const practiceReinstructionHint = taskSwitchingStore((s) => s.practiceReinstructionHint);
  const mainReinstruction = taskSwitchingStore((s) => s.mainReinstruction);
  const specReinstructionBanner = taskSwitchingStore((s) => s.specReinstructionBanner);
  const eventsCompleted = taskSwitchingStore((s) => s.events.length);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "main" || phase === "extension";
  const mainCountdownStarted = useRef(false);
  /**
   * Main countdown sets React state on the next paint; the stimulus effect runs in the same flush
   * and would still see countdown === null. Gate blocks scheduling until onComplete runs.
   */
  const mainCountdownGateRef = useRef(false);
  const handleStartPractice = useCallback(() => {
    startCountdown("practice", () => {
      if (mainReinstruction) return restartMain();
      return practiceReinstruction ? resumePractice() : startPractice();
    });
  }, [mainReinstruction, practiceReinstruction, restartMain, resumePractice, startPractice, startCountdown]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      mainCountdownGateRef.current = false;
      return;
    }
    if (phase === "complete") {
      mainCountdownGateRef.current = false;
      return;
    }
    if (phase === "main" && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      mainCountdownGateRef.current = true;
      startCountdown("main", () => {
        mainCountdownGateRef.current = false;
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
      const decision = await requestRoutingDecision(sessionId!, "task_switching", reason, {});
      if (!decision) {
        catStore.setState({ pendingNextTask: null });
        taskSwitchingStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        taskSwitchingStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        catStore.setState({ pendingNextTask: null });
        taskSwitchingStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main" && phase !== "extension") return;
    const reason = triggerReason || "trial_threshold";
    /** Keep `shouldTriggerBlockEnd` true until finishMain so the store does not schedule more trials. */
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
      const key = e.code === "ArrowLeft" || e.key === "ArrowLeft"
        ? "ArrowLeft"
        : e.code === "ArrowRight" || e.key === "ArrowRight"
          ? "ArrowRight"
          : null;
      if (!key) return;
      e.preventDefault();
      const s = taskSwitchingStore.getState();
      if (s.status !== "stimulus") return;
      const trial = s.trials[s.trialIndex];
      if (!trial) return;
      recordResponse(key, key === trial.correctKey);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordResponse]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase === "main" && mainCountdownGateRef.current) return;
    if (shouldTrigger && (phase === "main" || phase === "extension")) return;
    if ((phase === "practice" || phase === "main" || phase === "extension") && status === "waiting") {
      const trial = trials[trialIndex];
      if (trial) scheduleStimulus(trial, trialIndex);
    }
  }, [phase, status, trialIndex, trials, scheduleStimulus, countdown, shouldTrigger, isPaused]);

  // Practice completion is handled by addPracticeEvent in the store
  // (evaluates at block boundaries and transitions phases automatically)

  useEffect(() => {
    if (shouldTrigger) return;
    if (phase === "main" && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishMain().then((shouldRoute) => {
          if (shouldRoute) void handleRoutingDecision("block_end");
        });
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, trialIndex, trials.length, shouldTrigger, finishMain, handleRoutingDecision]);

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
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        <TaskSwitchingInstructions
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
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        {phase === "extension" && (
          <p className="mb-2 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        {specReinstructionBanner && (phase === "main" || phase === "extension") ? (
          <div
            role="status"
            className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-center text-sm text-foreground"
          >
            {specReinstructionBanner}
          </div>
        ) : null}
        <TaskTrialCard
          progress={
            phase === "practice" && practiceState ? (
              <PracticeProgressBar
                currentTrial={practiceState.totalTrialsCompleted}
                maxTrials={taskSwitchingStore.getState()._refs.practiceConfig.maxTrials}
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
          contentClassName="flex flex-col items-center justify-center"
        >
          {status === "waiting" && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-7xl font-bold text-foreground" aria-hidden>+</div>
              <p className="text-muted-foreground">Fixate until the next item appears</p>
            </div>
          )}
          {status === "stimulus" && currentTrial && (
            <TaskSwitchingStimulus stimulus={currentTrial.stimulus} task={currentTrial.task} />
          )}
          {status === "responded" && <div className="text-muted-foreground">Recorded</div>}
          {phase === "practice" && (
            <PracticeFeedback
              feedbackType={feedbackType}
              correctAnswer={feedbackAnswer}
              feedbackKey={feedbackKey}
            />
          )}
          {phase === "practice" ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Practice completed{" "}
              {Math.min(practiceState?.totalTrialsCompleted ?? 0, taskSwitchingStore.getState()._refs.practiceConfig.maxTrials)}{" "}
              / {taskSwitchingStore.getState()._refs.practiceConfig.maxTrials}
              {practiceState?.subPhase === "final" ? " — Final" : ""}
            </p>
          ) : (
            <p className="mt-8 text-sm text-muted-foreground">
              Completed {Math.min(eventsCompleted, maxTrials)} / {maxTrials}
            </p>
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "practice" && trials.length === 0) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Practice complete. Starting main task...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="task_switching" showMainAdaptivePanel={showMainAdaptivePanel} title="Task Switching">
        <TaskTransition completedTask="task_switching" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
