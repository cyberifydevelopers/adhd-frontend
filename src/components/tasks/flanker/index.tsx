import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { FlankerInstructions } from "./FlankerInstructions";
import { FlankerStimulus } from "./FlankerStimulus";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { flankerStore, CORRECT_KEYS_FLANKER } from "@/stores/flankerStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function FlankerTask() {
  usePrepareTaskFreshRun(() => {
    flankerStore.getState().prepareForFreshRun();
  });
  const phase = flankerStore((s) => s.phase);
  const status = flankerStore((s) => s.status);
  const trialIndex = flankerStore((s) => s.trialIndex);
  const trials = flankerStore((s) => s.trials);
  const maxTrials = flankerStore((s) => s.maxTrials);
  const startPractice = flankerStore((s) => s.startPractice);
  const resumePractice = flankerStore((s) => s.resumePractice);
  const restartMain = flankerStore((s) => s.restartMain);
  const scheduleStimulus = flankerStore((s) => s.scheduleStimulus);
  const recordResponse = flankerStore((s) => s.recordResponse);
  const startExtension = flankerStore((s) => s.startExtension);
  const finishMain = flankerStore((s) => s.finishMain);
  const finishExtension = flankerStore((s) => s.finishExtension);
  const cleanup = flankerStore((s) => s.cleanup);
  const resumeAfterPause = flankerStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const sessionId = flankerStore((s) => s.sessionId);
  const practiceState = flankerStore((s) => s.practiceState);
  const lastPracticeFeedback = flankerStore((s) => s.lastPracticeFeedback);
  const lastPracticeCorrectKey = flankerStore((s) => {
    const last = s._refs.practiceEvents[s._refs.practiceEvents.length - 1] as Record<string, unknown> | undefined;
    return (last?.correct_key as string | null | undefined) ?? null;
  });
  const practiceFeedbackKey = flankerStore((s) => s._refs.practiceEvents.length);
  const mainFeedbackKey = flankerStore((s) => s._refs.events.length);
  const lastMainEvent = flankerStore((s) => s._refs.events[s._refs.events.length - 1] as Record<string, unknown> | undefined);
  const practiceReinstruction = flankerStore((s) => s.practiceReinstruction);
  const practiceReinstructionLevel = flankerStore((s) => s.practiceReinstructionLevel);
  const practiceReinstructionHint = flankerStore((s) => s.practiceReinstructionHint);
  const mainReinstruction = flankerStore((s) => s.mainReinstruction);
  const largeMainStimulus = flankerStore((s) => s.largeMainStimulus);
  const eventsCompleted = flankerStore((s) => s.events.length);
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
      startCountdown("main", () => {
        const s = flankerStore.getState();
        if (s.phase === "main" && s.status === "waiting" && s.trials[s.trialIndex]) {
          s.scheduleStimulus(s.trials[s.trialIndex]!, s.trialIndex);
        }
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
  const finishMainRef = useRef(finishMain);
  const handleRoutingRef = useRef<(reason: string) => Promise<void>>(async () => {});
  const cleanupRef = useRef(cleanup);
  const clearTriggerRef = useRef(clearTrigger);
  finishMainRef.current = finishMain;
  cleanupRef.current = cleanup;
  clearTriggerRef.current = clearTrigger;

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      const decision = await requestRoutingDecision(sessionId!, "flanker", reason, {});
      if (!decision) {
        flankerStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        flankerStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        flankerStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );
  handleRoutingRef.current = handleRoutingDecision;

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main" && phase !== "extension") return;
    const reason = triggerReason || "main_adaptive_stop";
    /** Keep `shouldTriggerBlockEnd` true until finishMain so flankerStore does not schedule more trials. */
    cleanupRef.current();
    const id = setTimeout(() => {
      void finishMainRef.current().then((shouldRoute) => {
        if (shouldRoute) {
          clearTriggerRef.current();
          void handleRoutingRef.current(reason);
        }
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
    // Intentionally minimal deps: unstable store fn refs were cancelling the stop timer on every render.
  }, [shouldTrigger, sessionId, phase, triggerReason]);

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
      const s = flankerStore.getState();
      if (s.status !== "stimulus") return;
      const trial = s.trials[s.trialIndex];
      if (!trial) return;
      const isCorrect = key === CORRECT_KEYS_FLANKER[trial.centerDirection];
      recordResponse(key, isCorrect);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recordResponse]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    // Store state is persistent across route changes. If Flanker was previously
    // completed, reset to a fresh instructions state when reopening the task.
    const current = flankerStore.getState();
    if (current.phase === "complete") {
      cleanup();
      flankerStore.setState({
        phase: "instructions",
        sessionId: null,
        trialIndex: 0,
        trials: [],
        status: "waiting",
        events: [],
        additionalTrials: 0,
        practiceState: null,
        lastPracticeFeedback: null,
        practiceReinstruction: false,
        mainReinstruction: false,
      });
      catStore.getState().resetForNewTask();
    }
  }, [cleanup]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (shouldTrigger && (phase === "main" || phase === "extension")) return;
    if ((phase === "practice" || phase === "main" || phase === "extension") && status === "waiting") {
      const trial = trials[trialIndex];
      if (trial) scheduleStimulus(trial, trialIndex);
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
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        <FlankerInstructions
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
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        {phase === "extension" && (
          <p className="mb-2 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            phase === "practice" && practiceState ? (
              <PracticeProgressBar
                currentTrial={practiceState.totalTrialsCompleted}
                maxTrials={flankerStore.getState()._refs.practiceConfig.maxTrials}
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
              <p className="text-muted-foreground">Fixate until arrows appear</p>
            </div>
          )}
          {status === "stimulus" && currentTrial && (
            <div className="flex flex-col items-center gap-6">
              <FlankerStimulus
                trial={currentTrial}
                size={largeMainStimulus ? "younger" : "standard"}
              />
              <p className="text-lg text-muted-foreground">Press the matching arrow key</p>
            </div>
          )}
          {status === "responded" && <div className="text-muted-foreground">Recorded</div>}
          {phase === "practice" ? (
            <p className="mt-8 text-sm text-muted-foreground">
              Practice completed{" "}
              {Math.min(practiceState?.totalTrialsCompleted ?? 0, flankerStore.getState()._refs.practiceConfig.maxTrials)}{" "}
              / {flankerStore.getState()._refs.practiceConfig.maxTrials}
              {practiceState?.subPhase === "final" ? " — Final" : ""}
            </p>
          ) : (
            <p className="mt-8 text-sm text-muted-foreground">
              Completed {Math.min(eventsCompleted, maxTrials)} / {maxTrials}
            </p>
          )}
          {phase === "practice" && (
            <PracticeFeedback
              feedbackType={feedbackType}
              correctAnswer={feedbackAnswer}
              feedbackKey={feedbackKey}
            />
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "practice" && trials.length === 0) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Practice complete. Starting main task...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="flanker" showMainAdaptivePanel={showMainAdaptivePanel} title="Flanker Task">
        <TaskTransition completedTask="flanker" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
