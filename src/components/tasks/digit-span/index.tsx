import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { TaskTransition } from "../TaskTransition";
import { PracticeFeedback } from "../PracticeFeedback";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { DigitSpanInstructions } from "./DigitSpanInstructions";
import { DigitSpanStimulus } from "./DigitSpanStimulus";
import { DigitSpanInput } from "./DigitSpanInput";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { digitSpanStore } from "@/stores/digitSpanStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { cn } from "@/lib/utils";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";
import { DIGIT_SPAN_MAX_SEQUENCES } from "@/lib/digitSpanSpec";

const FEEDBACK_SETTLE_MS = 1600;
/** Room for absolutely positioned PracticeFeedback (bottom of container) below the progress bar */
const PRACTICE_LAYOUT_BOTTOM_PADDING = "pb-36";

export default function DigitSpanTask() {
  usePrepareTaskFreshRun(() => {
    digitSpanStore.getState().prepareForFreshRun();
  });
  const phase = digitSpanStore((s) => s.phase);
  const sequence = digitSpanStore((s) => s.sequence);
  const currentDigitIndex = digitSpanStore((s) => s.currentDigitIndex);
  const direction = digitSpanStore((s) => s.direction);
  const span = digitSpanStore((s) => s.span);
  const trialInSpan = digitSpanStore((s) => s.trialInSpan);
  const startPractice = digitSpanStore((s) => s.startPractice);
  const startExtension = digitSpanStore((s) => s.startExtension);
  const submitRecall = digitSpanStore((s) => s.submitRecall);
  const startDigitTimer = digitSpanStore((s) => s.startDigitTimer);
  const startRecallTimer = digitSpanStore((s) => s.startRecallTimer);
  const finishAndSave = digitSpanStore((s) => s.finishAndSave);
  const cleanup = digitSpanStore((s) => s.cleanup);
  const resumeAfterPause = digitSpanStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const sessionId = digitSpanStore((s) => s.sessionId);
  const events = digitSpanStore((s) => s.events);
  const maxTrials = digitSpanStore((s) => s.maxTrials);
  const currentRoundIndex = digitSpanStore((s) => s.currentRoundIndex);
  const additionalTrials = digitSpanStore((s) => s.additionalTrials);
  const isPractice = digitSpanStore((s) => s.isPractice);
  const showMainAdaptivePanel =
    !isPractice &&
    (phase === "encoding" || phase === "recall" || phase === "extension" || phase === "complete");
  const sequencesUsedMain = digitSpanStore((s) => s.sequencesUsedMain);
  const mainLadderPhase = digitSpanStore((s) => s.mainLadderPhase);
  const startingSpanLabel = digitSpanStore((s) => s.startingSpan);
  const registerInvalid = digitSpanStore((s) => s.registerInvalidDigitAttempt);
  const registerEarlyEncoding = digitSpanStore((s) => s.registerEarlyEncodingResponse);
  const practiceFeedbackType = digitSpanStore((s) => s.practiceFeedbackType);
  const practiceCorrectAnswer = digitSpanStore((s) => s.practiceCorrectAnswer);
  const practiceFeedbackKey = digitSpanStore((s) => s.practiceFeedbackKey);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const mainCountdownStarted = useRef(false);
  /** Full rounds logged (still 0 while working on first recall) */
  const roundsCompleted = Math.min(events.length, maxTrials);
  const progressTrial = isPractice ? roundsCompleted : sequencesUsedMain;
  const progressMax = isPractice ? maxTrials : DIGIT_SPAN_MAX_SEQUENCES;
  const progressLabel = isPractice
    ? "Practice"
    : additionalTrials > 0
      ? "Extension"
      : "Main";
  const handleStartPractice = useCallback(() => {
    startCountdown("practice", () => {
      return startPractice();
    });
  }, [startPractice, startCountdown]);

  useEffect(() => {
    if (phase !== "encoding" || isPractice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /\d/.test(e.key)) registerEarlyEncoding();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, isPractice, registerEarlyEncoding]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      return;
    }
    if (phase === "encoding" && !isPractice && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      startCountdown("main", () => {});
    }
  }, [phase, isPractice, startCountdown]);


  const navigate = useNavigate();
  const isRouting = catStore((s) => s.isRouting);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const clearTrigger = catStore((s) => s.clearTrigger);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      const decision = await requestRoutingDecision(sessionId!, "digit_span", reason, {});
      if (!decision) {
        digitSpanStore.setState({ phase: "complete" });
        return;
      }
      if (decision.extend_current_task && decision.trials_to_add > 0) {
        startExtension(decision.trials_to_add);
      } else if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        digitSpanStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        digitSpanStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, startExtension, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    const reason = triggerReason || "trial_threshold";
    const id = setTimeout(() => {
      finishAndSave().then(() => {
        clearTrigger();
        handleRoutingDecision(reason);
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [shouldTrigger, sessionId, triggerReason, clearTrigger, finishAndSave, handleRoutingDecision]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase === "encoding" && currentDigitIndex < sequence.length) {
      startDigitTimer();
    }
    return () => cleanup();
  }, [phase, sequence, currentDigitIndex, startDigitTimer, cleanup, countdown, isPaused]);

  useEffect(() => {
    if (phase === "complete") {
      const id = setTimeout(() => {
        finishAndSave().then(() => handleRoutingDecision("block_end"));
      }, FEEDBACK_SETTLE_MS);
      return () => clearTimeout(id);
    }
  }, [phase, finishAndSave, handleRoutingDecision]);

  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase === "extension" && currentDigitIndex < sequence.length) {
      startDigitTimer();
    }
  }, [phase, sequence, currentDigitIndex, startDigitTimer, countdown, isPaused]);

  useEffect(() => {
    if (isPaused) return;
    if (phase === "recall") {
      startRecallTimer();
    }
  }, [phase, startRecallTimer, isPaused]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (isRouting && phase !== "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
          <Loader2 className="h-14 w-14 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">Determining next step...</p>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <DigitSpanInstructions onStart={handleStartPractice} />
      </TaskLayout>
    );
  }

  if (phase === "encoding") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              size="lg"
              label={progressLabel}
              currentTrial={progressTrial}
              maxTrials={isPractice ? maxTrials : progressMax}
            />
          }
          contentClassName={cn(isPractice && PRACTICE_LAYOUT_BOTTOM_PADDING)}
        >
          <div className="relative w-full">
            <DigitSpanStimulus
              digit={sequence[currentDigitIndex] ?? null}
              digitPosition={currentDigitIndex + 1}
              sequenceLength={sequence.length}
              trialInSpan={trialInSpan + 1}
              trialsPerSpan={maxTrials}
              spanLength={span}
              direction={direction}
            />
            {isPractice && (
              <PracticeFeedback
                feedbackType={practiceFeedbackType}
                correctAnswer={practiceCorrectAnswer}
                feedbackKey={practiceFeedbackKey}
              />
            )}
          </div>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "recall") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              size="lg"
              label={progressLabel}
              currentTrial={progressTrial}
              maxTrials={isPractice ? maxTrials : progressMax}
            />
          }
          contentClassName={cn(
            "flex flex-col items-center justify-center gap-4",
            isPractice && PRACTICE_LAYOUT_BOTTOM_PADDING,
          )}
        >
          <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {direction}
          </p>
          {!isPractice && mainLadderPhase && (
            <p className="text-xs font-medium text-primary">
              {mainLadderPhase === "forward" ? "Forward" : "Backward"} ladder · started length{" "}
              {startingSpanLabel}
            </p>
          )}
          <DigitSpanInput
            key={`${currentRoundIndex}-${sequence}`}
            digitCount={sequence.length}
            onSubmit={submitRecall}
            onInvalidDigitAttempt={registerInvalid}
          />
          <p className="text-sm text-muted-foreground">
            {isPractice
              ? `Trial ${trialInSpan + 1} of ${maxTrials} at length ${span}`
              : `Sequence ${sequencesUsedMain} / ${progressMax} · span ${span} (${direction})`}
          </p>
          <p className="text-xs text-muted-foreground">
            {isPractice
              ? `Overall completed ${roundsCompleted} / ${maxTrials}`
              : "Stop rule: backward 0/2 at a span ends the battery (often before 24 if you fail earlier)"}
          </p>
          {isPractice && (
            <PracticeFeedback
              feedbackType={practiceFeedbackType}
              correctAnswer={practiceCorrectAnswer}
              feedbackKey={practiceFeedbackKey}
            />
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="digit_span" showMainAdaptivePanel={showMainAdaptivePanel} title="Digit Span">
        <TaskTransition completedTask="digit_span" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
