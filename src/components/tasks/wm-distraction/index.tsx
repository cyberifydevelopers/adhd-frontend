import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Send } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskTransition } from "../TaskTransition";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { Button } from "@/components/ui/Button";
import { wmDistractionStore } from "@/stores/wmDistractionStore";
import { catStore } from "@/stores/catStore";
import { taskPauseStore } from "@/stores/taskPauseStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const DIGIT_DISPLAY_MS = 800;
const FEEDBACK_SETTLE_MS = 1600;

export default function WMDistractionTask() {
  usePrepareTaskFreshRun(() => {
    wmDistractionStore.getState().prepareForFreshRun();
  });
  const phase = wmDistractionStore((s) => s.phase);
  const trial = wmDistractionStore((s) => s.trial);
  const displayIndex = wmDistractionStore((s) => s.displayIndex);
  const currentDistractor = wmDistractionStore((s) => s.currentDistractor);
  const userInput = wmDistractionStore((s) => s.userInput);
  const isPractice = wmDistractionStore((s) => s.isPractice);
  const showMainAdaptivePanel = !isPractice && phase !== "instructions" && phase !== "complete";
  const practiceTotalTrials = wmDistractionStore((s) => s.practiceTotalTrials);
  const mainTotalTrials = wmDistractionStore((s) => s.mainTotalTrials);
  const practiceDoneTrials = wmDistractionStore((s) => s.practiceDoneTrials);
  const mainDoneTrials = wmDistractionStore((s) => s.mainDoneTrials);
  const lastCorrect = wmDistractionStore((s) => s.lastCorrect);
  const lastExpected = wmDistractionStore((s) => s.lastExpected);
  const lastEntered = wmDistractionStore((s) => s.lastEntered);
  const setUserInput = wmDistractionStore((s) => s.setUserInput);
  const submitRecall = wmDistractionStore((s) => s.submitRecall);
  const startSession = wmDistractionStore((s) => s.startSession);
  const advanceDisplay = wmDistractionStore((s) => s.advanceDisplay);
  const finishAndSave = wmDistractionStore((s) => s.finishAndSave);
  const cleanup = wmDistractionStore((s) => s.cleanup);
  const resumeAfterPause = wmDistractionStore((s) => s.resumeAfterPause);
  const isPaused = taskPauseStore((s) => s.isPaused);
  const markDistractorUnderstanding = wmDistractionStore((s) => s.markDistractorUnderstanding);
  const mainConditionLabel = wmDistractionStore((s) => s.mainConditionLabel);
  const sessionId = wmDistractionStore((s) => s.sessionId);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const navigate = useNavigate();
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const [saveDone, setSaveDone] = useState(false);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const mainCountdownStarted = useRef(false);
  const totalRounds = isPractice ? practiceTotalTrials : mainTotalTrials;
  const roundsDoneBase = Math.min(isPractice ? practiceDoneTrials : mainDoneTrials, totalRounds);
  /** During feedback the store has not incremented yet; count the just-finished round. */
  const roundsCompletedForBar =
    phase === "feedback" ? Math.min(roundsDoneBase + 1, totalRounds) : roundsDoneBase;

  const handleStartSession = useCallback(() => {
    startCountdown("practice", () => {
      return startSession();
    });
  }, [startSession, startCountdown]);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      if (!sessionId) return;
      const decision = await requestRoutingDecision(sessionId, "wm_distraction", reason, {});
      if (!decision) {
        wmDistractionStore.setState({ phase: "complete" });
        return;
      }
      if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        wmDistractionStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        wmDistractionStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (isPractice) return;
    if (phase === "instructions" || phase === "complete") return;
    const reason = triggerReason || "trial_threshold";
    const id = setTimeout(() => {
      cleanup();
      void finishAndSave().then(() => {
        catStore.getState().clearTrigger();
        handleRoutingDecision(reason);
      });
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [
    shouldTrigger,
    sessionId,
    phase,
    isPractice,
    triggerReason,
    cleanup,
    finishAndSave,
    handleRoutingDecision,
  ]);

  useEffect(() => {
    if (phase === "instructions") {
      mainCountdownStarted.current = false;
      return;
    }
    if (phase === "presenting" && !isPractice && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      startCountdown("main", () => {});
    }
  }, [phase, isPractice, startCountdown]);
  useEffect(() => {
    if (isPaused) return;
    if (countdown?.phase === "main") return;
    if (phase !== "presenting" || !trial || displayIndex < 0) return;

    if (displayIndex >= trial.digits.length) {
      advanceDisplay();
      return;
    }

    const t = setTimeout(() => advanceDisplay(), DIGIT_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [phase, trial, displayIndex, advanceDisplay, countdown, isPaused]);

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

  useEffect(() => () => cleanup(), [cleanup]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">Working memory under distraction</h2>
          <p className="text-muted-foreground">
            Main task alternates <span className="font-medium text-foreground">clean</span> rounds (digits only,
            then recall) with <span className="font-medium text-foreground">distracted</span> rounds (digits, mild
            on-screen symbols you ignore, then recall). Symbols do not require a response.
          </p>
          <div className="space-y-2 rounded-lg border border-border/60 bg-background p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How each round works</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <span className="font-medium text-foreground">Memorize:</span> digits appear one at a time in order.
              </li>
              <li>
                <span className="font-medium text-foreground">Distracted trials only:</span> mild symbols appear
                briefly — do not memorize them.
              </li>
              <li>
                <span className="font-medium text-foreground">Recall:</span> type only the digits in order, then submit.
              </li>
            </ol>
            <p>
              Load adjusts during the main block (up after ≥1 of 2 correct at a load; down after 0 of 2). If a pair
              is split 1/1, you get one confirmation trial at that load. Up to 32 sequences; practice uses the
              distracted flow only.
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            [ MEMORIZE ] → [ DISTRACTION ] → [ RECALL ]
          </div>
          <Button onClick={handleStartSession} className="inline-flex items-center gap-1.5">
            <Play className="h-4 w-4" />
            Begin
          </Button>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "presenting" && trial) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={isPractice ? "Practice" : "Main"}
              currentTrial={roundsCompletedForBar}
              maxTrials={Math.max(totalRounds, 1)}
            />
          }
          contentClassName="flex flex-col items-center justify-center gap-8"
        >
          <p className="rounded border border-border/60 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {isPractice ? "Practice - Memorize" : mainConditionLabel === "clean" ? "Main - Clean (no distractor)" : "Main - Distracted"}
          </p>
          <div className="relative flex items-center justify-center">
            <span className="text-7xl font-bold text-foreground">
              {displayIndex < trial.digits.length ? trial.digits[displayIndex] : ""}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">Memorize this sequence</p>
          <p className="text-xs text-muted-foreground">Span: {trial.span}</p>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "distracting" && trial) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={isPractice ? "Practice" : "Main"}
              currentTrial={roundsCompletedForBar}
              maxTrials={Math.max(totalRounds, 1)}
            />
          }
          contentClassName="flex flex-col items-center justify-center gap-8"
        >
          <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {isPractice ? "Practice - Distraction" : "Main - Distracted (ignore symbols)"}
          </p>
          <div className="rounded-xl border border-border/60 bg-muted/20 p-8 text-center">
            <div className="mb-4 text-5xl font-bold tracking-[0.4em] text-muted-foreground">
              {currentDistractor ?? "*"}
            </div>
            <p className="text-sm text-muted-foreground">Ignore symbols — they are not part of your answer.</p>
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={markDistractorUnderstanding}
              >
                Symbols interfere with understanding — note for review
              </Button>
            </div>
          </div>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "recalling" && trial) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={isPractice ? "Practice" : "Main"}
              currentTrial={roundsCompletedForBar}
              maxTrials={Math.max(totalRounds, 1)}
            />
          }
          contentClassName="flex flex-col items-center justify-center gap-6"
        >
          <p className="rounded border border-border/60 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {isPractice ? "Practice - Recall" : mainConditionLabel === "clean" ? "Main - Recall (clean trial)" : "Main - Recall (after distraction)"}
          </p>
          <p className="text-lg text-muted-foreground">Type the digits in order:</p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={userInput}
            onChange={(e) => setUserInput(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRecall();
            }}
            maxLength={trial.span}
            className="box-border max-w-[calc(100vw-2rem)] rounded-lg border-2 border-primary bg-background px-4 py-3 text-center font-mono text-3xl font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/50"
            style={{ width: `min(${Math.max(10, 2 + trial.span * 3.2)}rem, calc(100vw - 2rem))` }}
            placeholder={"_".repeat(trial.span)}
          />
          <Button
            onClick={submitRecall}
            disabled={userInput.length !== trial.span}
            className="inline-flex items-center gap-1.5"
          >
            <Send className="h-4 w-4" />
            Submit
          </Button>
          <p className="text-xs text-muted-foreground">Span: {trial.span}</p>
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "feedback") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskTrialCard
          progress={
            <PracticeProgressBar
              label={isPractice ? "Practice" : "Main"}
              currentTrial={roundsCompletedForBar}
              maxTrials={Math.max(totalRounds, 1)}
            />
          }
          contentClassName="flex flex-col items-center justify-center gap-4"
        >
          <p className="rounded border border-border/60 px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            {isPractice ? "Practice - Feedback" : "Main - Feedback"}
          </p>
          {isPractice ? (
            <>
              <p
                className={`text-2xl font-semibold ${
                  lastCorrect ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {lastCorrect ? "Correct" : "Not quite"}
              </p>
              {!lastCorrect && (
                <p className="text-sm text-muted-foreground">
                  Entered: <span className="font-medium">{lastEntered || "—"}</span> • Correct:{" "}
                  <span className="font-medium">{lastExpected || "—"}</span>
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Preparing next trial...</p>
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    if (!saveDone) {
      return (
        <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
          <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-foreground">
            Saving Working Memory Under Distraction results...
          </div>
        </TaskLayout>
      );
    }
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="wm_distraction" showMainAdaptivePanel={showMainAdaptivePanel} title="Working Memory Under Distraction">
        <TaskTransition completedTask="wm_distraction" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
