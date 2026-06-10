import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { TaskLayout } from "../TaskLayout";
import { PracticeProgressBar } from "../PracticeProgressBar";
import { TaskTrialCard } from "../TaskTrialCard";
import { TaskTransition } from "../TaskTransition";
import { TaskStartCountdown } from "../TaskStartCountdown";
import { useTaskStartCountdown } from "../useTaskStartCountdown";
import { Button } from "@/components/ui/Button";
import { psychomotorSpeedStore } from "@/stores/psychomotorSpeedStore";
import { catStore } from "@/stores/catStore";
import { usePrepareTaskFreshRun } from "@/hooks/usePrepareTaskFreshRun";

const FEEDBACK_SETTLE_MS = 1600;

export default function PsychomotorSpeedTask() {
  usePrepareTaskFreshRun(() => {
    psychomotorSpeedStore.getState().prepareForFreshRun();
  });
  const phase = psychomotorSpeedStore((s) => s.phase);
  const stage = psychomotorSpeedStore((s) => s.stage);
  const trialIndex = psychomotorSpeedStore((s) => s.trialIndex);
  const totalTrials = psychomotorSpeedStore((s) => s.totalTrials);
  const latestMessage = psychomotorSpeedStore((s) => s.latestMessage);
  const lastResult = psychomotorSpeedStore((s) => s.lastResult);
  const startSession = psychomotorSpeedStore((s) => s.startSession);
  const handleTap = psychomotorSpeedStore((s) => s.handleTap);
  const markMotorImpairment = psychomotorSpeedStore((s) => s.markMotorImpairment);
  const startMainPhase = psychomotorSpeedStore((s) => s.startMainPhase);
  const finishAndSave = psychomotorSpeedStore((s) => s.finishAndSave);
  const cleanup = psychomotorSpeedStore((s) => s.cleanup);
  const resumeAfterPause = psychomotorSpeedStore((s) => s.resumeAfterPause);
  const sessionId = psychomotorSpeedStore((s) => s.sessionId);
  const pendingNextTask = catStore((s) => s.pendingNextTask);
  const navigate = useNavigate();
  const requestRoutingDecision = catStore((s) => s.requestRoutingDecision);
  const shouldTrigger = catStore((s) => s.shouldTriggerBlockEnd);
  const triggerReason = catStore((s) => s.blockEndTriggerReason);
  const { countdown, startCountdown } = useTaskStartCountdown();
  const showMainAdaptivePanel = phase === "main";
  const mainCountdownStarted = useRef(false);

  const handleStartSession = useCallback(() => {
    startCountdown("practice", () => {
      return startSession();
    });
  }, [startSession, startCountdown]);

  const handleRoutingDecision = useCallback(
    async (reason: string) => {
      if (!sessionId) return;
      const decision = await requestRoutingDecision(sessionId, "psychomotor_speed", reason, {});
      if (!decision) {
        psychomotorSpeedStore.setState({ phase: "complete" });
        return;
      }
      if (decision.next_task) {
        catStore.setState({ pendingNextTask: decision.next_task });
        psychomotorSpeedStore.setState({ phase: "complete" });
      } else if (decision.stop_battery) {
        navigate("/user");
      } else {
        psychomotorSpeedStore.setState({ phase: "complete" });
      }
    },
    [sessionId, requestRoutingDecision, navigate],
  );

  useEffect(() => {
    if (!shouldTrigger || !sessionId) return;
    if (phase !== "main") return;
    const reason = triggerReason || "trial_threshold";
    /** Keep `shouldTriggerBlockEnd` until finishMain; then clear so advanceTrial does not resume mid-save. */
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
    if (phase === "main" && !mainCountdownStarted.current) {
      mainCountdownStarted.current = true;
      startCountdown("main", () => {
        startMainPhase();
      });
    }
  }, [phase, startCountdown, startMainPhase]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        handleTap();
      }
    };
    document.addEventListener("keydown", handler, true);
    window.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler, true);
      window.removeEventListener("keydown", handler);
    };
  }, [handleTap]);

  useEffect(() => {
    const pointerHandler = (e: PointerEvent) => {
      if (typeof e.button === "number" && e.button !== 0) return;
      handleTap();
    };
    const mouseHandler = (e: MouseEvent) => {
      if (e.button !== 0) return;
      handleTap();
    };
    document.addEventListener("pointerdown", pointerHandler, true);
    window.addEventListener("pointerdown", pointerHandler);
    document.addEventListener("mousedown", mouseHandler, true);
    window.addEventListener("mousedown", mouseHandler);
    return () => {
      document.removeEventListener("pointerdown", pointerHandler, true);
      window.removeEventListener("pointerdown", pointerHandler);
      document.removeEventListener("mousedown", mouseHandler, true);
      window.removeEventListener("mousedown", mouseHandler);
    };
  }, [handleTap]);

  useEffect(() => () => cleanup(), [cleanup]);

  useEffect(() => {
    if (phase !== "complete") return;
    const id = setTimeout(() => {
      finishAndSave().then(() => handleRoutingDecision("block_end"));
    }, FEEDBACK_SETTLE_MS);
    return () => clearTimeout(id);
  }, [phase, finishAndSave, handleRoutingDecision]);

  if (countdown) {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="psychomotor_speed" showMainAdaptivePanel={showMainAdaptivePanel} title="Psychomotor Speed">
        <TaskStartCountdown secondsLeft={countdown.secondsLeft} phaseLabel={countdown.phase} />
      </TaskLayout>
    );
  }

  if (phase === "instructions") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="psychomotor_speed" showMainAdaptivePanel={showMainAdaptivePanel} title="Psychomotor Speed">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">Psychomotor speed</h2>
          <p className="text-muted-foreground">
            Tap the button or press <kbd className="rounded border px-1">Space</kbd> as soon as the dot appears. Do not
            respond during the wait period. Timing before each dot is randomized.
          </p>
          <p className="text-sm text-muted-foreground">
            Main block: 30–80 trials (from your session settings). Checkpoints every 10 valid responses after the
            minimum. The task may end early when median RT and variability are stable for two checkpoints and omission
            rate is also stable; it continues while lapses bounce around.
          </p>
          <ul className="list-disc space-y-1 pl-6 text-sm text-muted-foreground">
            <li>Foreperiod: 1–3 s (random)</li>
            <li>Miss if no response within 1.5 s of the dot</li>
            <li>Responses faster than 120 ms count as anticipatory (not used for median RT)</li>
          </ul>
          <Button onClick={handleStartSession} className="inline-flex items-center gap-1.5">
            <Play className="h-4 w-4" />
            Begin
          </Button>
        </div>
      </TaskLayout>
    );
  }

  if (phase === "practice" || phase === "main") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="psychomotor_speed" showMainAdaptivePanel={showMainAdaptivePanel} title="Psychomotor Speed">
        <TaskTrialCard
          progress={
            <>
              <PracticeProgressBar
                label={phase === "practice" ? "Practice" : "Main"}
                currentTrial={Math.min(trialIndex, totalTrials)}
                maxTrials={Math.max(totalTrials, 1)}
              />
              {phase === "main" && (
                <div className="mt-2 flex justify-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={markMotorImpairment}
                  >
                    Motor difficulty — note for review
                  </Button>
                </div>
              )}
            </>
          }
          contentClassName="flex flex-col items-center justify-center gap-6"
        >
          <div className="flex h-40 w-40 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted/20">
            {stage === "stimulus" ? <span className="h-10 w-10 rounded-full bg-primary" /> : <span className="text-2xl text-muted-foreground">+</span>}
          </div>
          <p className="text-xl font-semibold text-foreground">{latestMessage ?? "Get Ready..."}</p>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleTap();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              handleTap();
            }}
            onClick={(e) => {
              e.preventDefault();
              handleTap();
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                handleTap();
              }
            }}
            className="rounded-lg border border-border px-6 py-3 text-sm font-medium transition hover:bg-muted"
          >
            Click / Space
          </button>
          {lastResult && (
            <p className="text-sm text-muted-foreground">
              {lastResult.false_start
                ? "False start"
                : lastResult.missed
                  ? "Missed response"
                  : `Reaction time: ${lastResult.reaction_time_ms} ms`}
            </p>
          )}
        </TaskTrialCard>
      </TaskLayout>
    );
  }

  if (phase === "complete") {
    return (
      <TaskLayout phase={phase} cleanup={cleanup} resume={resumeAfterPause} mainAdaptiveTaskKey="psychomotor_speed" showMainAdaptivePanel={showMainAdaptivePanel} title="Psychomotor Speed">
        <TaskTransition completedTask="psychomotor_speed" nextTask={pendingNextTask} />
      </TaskLayout>
    );
  }

  return null;
}
