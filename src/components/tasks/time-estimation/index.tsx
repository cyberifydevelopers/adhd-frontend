import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskTransition } from "../TaskTransition";
import { TimeEstInstructions } from "./TimeEstInstructions";
import { TimeEstTrial } from "./TimeEstTrial";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { timeEstimationStore } from "@/stores/timeEstimationStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;
/** Count a reproduction as correct if within ±1s of target (e.g. 6s target → 5–7s). */
const TIME_EST_ABS_TOL_MS = 1000;

export default function TimeEstimationTask() {
  usePrepareTaskFreshRun(() => {
    timeEstimationStore.getState().prepareForFreshRun();
  });
  const phase = timeEstimationStore((s) => s.phase);
  const status = timeEstimationStore((s) => s.status);
  const trialIndex = timeEstimationStore((s) => s.trialIndex);
  const trials = timeEstimationStore((s) => s.trials);
  const maxTrials = timeEstimationStore((s) => s.maxTrials);
  const handlePress = timeEstimationStore((s) => s.handlePress);
  const startSession = timeEstimationStore((s) => s.startSession);
  const startExtension = timeEstimationStore((s) => s.startExtension);
  const finishAndSave = timeEstimationStore((s) => s.finishAndSave);
  const finishExtension = timeEstimationStore((s) => s.finishExtension);
  const sessionId = timeEstimationStore((s) => s.sessionId);
  const events = timeEstimationStore((s) => s.events);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const watchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = useCallback(() => {
    if (watchTimerRef.current) {
      clearTimeout(watchTimerRef.current);
      watchTimerRef.current = null;
    }
  }, []);
  const resumeAfterPause = useCallback(() => {
    const s = timeEstimationStore.getState();
    if (s.status !== "watching" || !s.trials[s.trialIndex]) return;
    if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    const duration = s.trials[s.trialIndex]!.duration;
    watchTimerRef.current = setTimeout(() => {
      watchTimerRef.current = null;
      timeEstimationStore.getState().completeWatchInterval();
    }, duration);
  }, []);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "running" || phase === "extension";
  const handleStartSession = useCallback(() => {
    startCountdown("practice", () => {
      return startSession();
    });
  }, [startSession, startCountdown]);

  const navigate = useNavigate();
  const isRouting = catStore((s) => s.isRouting);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const clearTrigger = catStore((s) => s.clearTrigger);

  /** Most recent completed reproduction; show outcome until the next reproduction is logged. */
  const lastRepForFeedback =
    phase === "practice" && events.length > 0
      ? [...events].reverse().find((e) => e.event_type === "reproduction")
      : undefined;
  const feedbackApplies = Boolean(
    phase === "practice" &&
      lastRepForFeedback &&
      Number(lastRepForFeedback.trial_index) === trialIndex - 1,
  );
  const lastRtMs =
    feedbackApplies && typeof lastRepForFeedback?.reaction_time_ms === "number"
      ? (lastRepForFeedback.reaction_time_ms as number)
      : null;
  const lastTargetMs =
    feedbackApplies && typeof lastRepForFeedback?.isi_ms === "number"
      ? (lastRepForFeedback.isi_ms as number)
      : null;
  const feedbackText = (() => {
    if (lastRtMs == null || lastTargetMs == null) return null;
    const absErr = Math.abs(lastRtMs - lastTargetMs);
    const typedSec = (lastRtMs / 1000).toFixed(2);
    const targetSec = (lastTargetMs / 1000).toFixed(1);
    if (absErr <= TIME_EST_ABS_TOL_MS) {
      return `Round (${targetSec}s target): correct — your guess was ${typedSec}s.`;
    }
    if (absErr <= TIME_EST_ABS_TOL_MS * 1.5) {
      return `Round (${targetSec}s target): close — your guess was ${typedSec}s (about ±1.5s).`;
    }
    return `Round (${targetSec}s target): your guess was ${typedSec}s.`;
  })();

  const reproCompleted = events.filter((e) => e.event_type === "reproduction").length;

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      const decision = await requestRoutingDecision(sessionId!, "time_estimation", reason, {});
      if (!decision) {
        timeEstimationStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        timeEstimationStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        timeEstimationStore.setState({ phase: "complete" });
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
    if (phase === "complete") {
      const id = setTimeout(() => {
        finishAndSave().then(() => handleRoutingDecision("block_end"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, finishAndSave, handleRoutingDecision]);

  useEffect(() => {
    if (phase === "extension" && trialIndex >= trials.length && trials.length > 0) {
      const id = setTimeout(() => {
        finishExtension().then(() => handleRoutingDecision("extension_complete"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, trialIndex, trials.length, finishExtension, handleRoutingDecision]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (shouldTrigger && (phase === "running" || phase === "extension")) return;
    if (status !== "watching" || !trials[trialIndex]) return;
    const duration = trials[trialIndex].duration;
    if (watchTimerRef.current) clearTimeout(watchTimerRef.current);
    watchTimerRef.current = setTimeout(() => {
      watchTimerRef.current = null;
      timeEstimationStore.getState().completeWatchInterval();
    }, duration);
    return () => {
      if (watchTimerRef.current) {
        clearTimeout(watchTimerRef.current);
        watchTimerRef.current = null;
      }
    };
  }, [status, trialIndex, trials, countdown, shouldTrigger, phase, isPaused]);

  useEffect(() => {
    if (phase !== "practice_wrapup") return;
    const id = window.setTimeout(() => {
      startCountdown("main", () => {
        timeEstimationStore.getState().beginMainAfterPracticeWrapup();
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [phase, startCountdown]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        <TimeEstInstructions onStart={handleStartSession} />
      </TaskLayout>
    );
  }

  if (phase === "practice_wrapup" && trials[trialIndex]) {
    const wrapRepro = events.filter((e) => e.event_type === "reproduction").length;
    const wrapLastRep = [...events].reverse().find((e) => e.event_type === "reproduction");
    const wrapLastRt =
      typeof wrapLastRep?.reaction_time_ms === "number"
        ? (wrapLastRep.reaction_time_ms as number)
        : null;
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label="Practice"
              currentTrial={wrapRepro}
              maxTrials={Math.max(maxTrials, 1)}
            />
          }
        >
          <TimeEstTrial
            status="ready"
            mode={trials[trialIndex].mode}
            targetMs={trials[trialIndex].duration}
            condition={trials[trialIndex].condition}
            onPress={() => {}}
            feedbackText={null}
            showIntervalHints
            lastGuessMs={wrapLastRt}
            wrapupReview
          />
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if ((phase === "practice" || phase === "running" || phase === "extension") && trials[trialIndex]) {
    const progCurrent = reproCompleted;
    const progCap = maxTrials;
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        {phase === "extension" && (
          <p className="mb-2 text-sm text-amber-600">Extension block — additional trials</p>
        )}
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={
                phase === "practice" ? "Practice" : phase === "extension" ? "Extension" : "Main"
              }
              currentTrial={progCurrent}
              maxTrials={Math.max(progCap, 1)}
            />
          }
        >
          <TimeEstTrial
            status={status}
            mode={trials[trialIndex].mode}
            targetMs={trials[trialIndex].duration}
            condition={trials[trialIndex].condition}
            onPress={handlePress}
            feedbackText={phase === "practice" ? feedbackText : null}
            showIntervalHints={phase === "practice"}
            singleScoredTrial={phase === "running" || phase === "extension"}
            scoredRound={
              phase === "running" || phase === "extension" ? reproCompleted + 1 : undefined
            }
            lastGuessMs={phase === "practice" && feedbackApplies ? lastRtMs : null}
          />
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="time_estimation" showMainAdaptivePanel={showMainAdaptivePanel} title="Time Estimation">
        <TaskTransition completedTask="time_estimation" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
