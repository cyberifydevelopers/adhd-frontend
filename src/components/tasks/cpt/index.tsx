import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { CPTInstructions } from "./CPTInstructions";
import { CPTStimulus } from "./CPTStimulus";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { cptStore } from "@/stores/cptStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";
import { registerCptBlockEndHandler } from "@/lib/cptBlockEnd";

const FEEDBACK_SETTLE_MS = 1600;
/** Brief pause after the scoring trial; adaptive stop already halted the trial loop in the store. */
const FEEDBACK_SETTLE_ADAPTIVE_MS = 400;

export default function ContinuousPerformanceTest() {
  usePrepareTaskFreshRun(() => {
    cptStore.getState().prepareForFreshRun();
  });
  const phase = cptStore((s) => s.phase);
  const trialIndex = cptStore((s) => s.trialIndex);
  const trials = cptStore((s) => s.trials);
  const maxTrials = cptStore((s) => s.maxTrials);
  const currentLetter = cptStore((s) => s.currentLetter);
  const startPractice = cptStore((s) => s.startPractice);
  const resumePractice = cptStore((s) => s.resumePractice);
  const restartMain = cptStore((s) => s.restartMain);
  const startExtension = cptStore((s) => s.startExtension);
  const advanceTrial = cptStore((s) => s.advanceTrial);
  const finishMain = cptStore((s) => s.finishMain);
  const finishExtension = cptStore((s) => s.finishExtension);
  const cleanup = cptStore((s) => s.cleanup);
  const resumeAfterPause = cptStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const sessionId = cptStore((s) => s.sessionId);
  const practiceState = cptStore((s) => s.practiceState);
  const lastPracticeFeedback = cptStore((s) => s.lastPracticeFeedback);
  const lastPracticeCorrectKey = cptStore((s) => {
    const last = s._refs.practiceEvents[s._refs.practiceEvents.length - 1] as Record<string, unknown> | undefined;
    return (last?.correct_key as string | null | undefined) ?? null;
  });
  const practiceFeedbackKey = cptStore((s) => s._refs.practiceEvents.length);
  const mainFeedbackKey = cptStore((s) => s._refs.events.length);
  const lastMainEvent = cptStore((s) => s._refs.events[s._refs.events.length - 1] as Record<string, unknown> | undefined);
  const practiceReinstruction = cptStore((s) => s.practiceReinstruction);
  const practiceReinstructionLevel = cptStore((s) => s.practiceReinstructionLevel);
  const practiceReinstructionHint = cptStore((s) => s.practiceReinstructionHint);
  const mainReinstruction = cptStore((s) => s.mainReinstruction);
  const mainEventsCompleted = cptStore((s) => s.events.length);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "main" || phase === "extension";
  const mainCountdownStarted = useRef(false);
  const mainCountdownCompleted = useRef(false);
  const blockEndFinishInFlight = useRef(false);
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
        cptStore.getState().advanceTrial();
      });
    }
  }, [phase, startCountdown]);


  const navigate = useNavigate();
  const isRouting = catStore((s) => s.isRouting);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
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
      const decision = await requestRoutingDecision(sessionId!, "cpt", reason, {});
      if (!decision) {
        cptStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        cptStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        cptStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );
  handleRoutingRef.current = handleRoutingDecision;

  useEffect(() => {
    registerCptBlockEndHandler(async () => {
      if (blockEndFinishInFlight.current) return false;
      const { sessionId: sid, phase: p } = cptStore.getState();
      if (!sid || (p !== "main" && p !== "extension")) return false;
      blockEndFinishInFlight.current = true;
      const reason = catStore.getState().blockEndTriggerReason ?? "main_adaptive_stop";
      const routingReason = reason === "session_max_trials" ? "block_end" : reason;
      const settleMs =
        reason === "main_adaptive_stop" ? FEEDBACK_SETTLE_ADAPTIVE_MS : FEEDBACK_SETTLE_MS;
      try {
        await new Promise((r) => setTimeout(r, settleMs));
        const shouldRoute = await finishMainRef.current();
        if (shouldRoute) {
          clearTriggerRef.current();
          void handleRoutingRef.current(routingReason);
        }
        return shouldRoute;
      } finally {
        blockEndFinishInFlight.current = false;
      }
    });
    return () => registerCptBlockEndHandler(null);
  }, []);

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main" && phase !== "extension") return;
    /** Halt timers immediately; finishMain runs via store → registerCptBlockEndHandler (not this effect). */
    cleanupRef.current();
  }, [shouldTrigger, sessionId, phase]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase !== "practice" && phase !== "main" && phase !== "extension") return;
    if (shouldTrigger) return;
    if (phase === "main" && !mainCountdownCompleted.current) return;
    const { _refs } = cptStore.getState();
    const practiceCap = _refs.practiceConfig.maxTrials;
    if (phase === "practice" && trialIndex >= practiceCap) return;
    if ((phase === "main" || phase === "extension") && (trialIndex >= maxTrials || trials.length === 0)) {
      return;
    }
    const refs = cptStore.getState()._refs;
    const hasActiveTimers = !!(
      refs.stimulusTimeoutId ||
      refs.responseTimeoutId ||
      refs.nextTrialTimeoutId ||
      refs.keydownHandler
    );
    if (!hasActiveTimers) {
      advanceTrial();
    }
  }, [phase, trialIndex, maxTrials, trials.length, advanceTrial, countdown, shouldTrigger, isPaused]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if ((phase !== "main" && phase !== "extension") || !sessionId) return;
    const TARGET_FRAME_MS = 1000 / 60;
    const tick = () => {
      const { _refs } = cptStore.getState();
      _refs.frameCount += 1;
      const elapsed = performance.now() - _refs.blockStart;
      const expectedFrames = Math.floor(elapsed / TARGET_FRAME_MS);
      const dropped = Math.max(0, expectedFrames - _refs.frameCount);
      cptStore.setState({ droppedFrames: dropped });
      _refs.rafId = requestAnimationFrame(tick);
    };
    const { _refs } = cptStore.getState();
    _refs.rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(_refs.rafId);
  }, [phase, sessionId]);

  // Practice completion is handled by addPracticeEvent in the store
  // (evaluates at block boundaries and transitions phases automatically)

  useEffect(() => {
    if (shouldTrigger) return;
    if (phase === "main" && sessionId && mainEventsCompleted >= maxTrials) {
      catStore.getState().setBlockEndTrigger("session_max_trials");
    }
  }, [phase, sessionId, mainEventsCompleted, maxTrials, shouldTrigger]);

  useEffect(() => {
    if (phase === "extension" && sessionId && trialIndex >= maxTrials) {
      const id = setTimeout(() => {
        finishExtension().then(() => handleRoutingDecision("extension_complete"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, sessionId, trialIndex, maxTrials, finishExtension, handleRoutingDecision]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        <CPTInstructions
          onStart={handleStartPractice}
          isReinstruction={practiceReinstruction}
          reinstructionLevel={practiceReinstructionLevel ?? undefined}
          reinstructionHint={practiceReinstructionHint ?? undefined}
        />
      </TaskLayout>
    );
  }

  if ((phase === "practice" || phase === "main" || phase === "extension") && trials.length > 0) {
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
    const practiceCap = cptStore.getState()._refs.practiceConfig.maxTrials;

    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        {phase === "extension" && (
          <p className="mb-4 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            phase === "practice" && practiceState ? (
              <PracticeProgressBar
                currentTrial={Math.min(practiceState.totalTrialsCompleted, practiceCap)}
                maxTrials={practiceCap}
                subPhase={practiceState.subPhase}
              />
            ) : (
              <PracticeProgressBar
                currentTrial={Math.min(mainEventsCompleted, maxTrials)}
                maxTrials={maxTrials}
                label={phase === "extension" ? "Extension" : "Main"}
              />
            )
          }
          footer={
            phase === "practice" ? (
              <p className="text-center text-sm text-muted-foreground">
                Practice completed {Math.min(practiceState?.totalTrialsCompleted ?? 0, practiceCap)} / {practiceCap}
                {practiceState?.subPhase === "final" ? " — Final" : ""}
              </p>
            ) : undefined
          }
        >
          <CPTStimulus letter={currentLetter} />
          {phase === "practice" ? (
            <PracticeFeedback
              feedbackType={feedbackType}
              correctAnswer={feedbackAnswer}
              feedbackKey={feedbackKey}
            />
          ) : null}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "practice" && trials.length === 0) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Practice complete. Starting main task...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="cpt" showMainAdaptivePanel={showMainAdaptivePanel} title="CPT">
        <TaskTransition completedTask="cpt" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
