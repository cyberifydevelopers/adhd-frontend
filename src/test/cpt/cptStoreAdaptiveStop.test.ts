import { beforeEach, describe, expect, it, vi } from "vitest";
import { catStore } from "@/stores/catStore";
import { cptStore } from "@/stores/cptStore";
import { resetMainAdaptiveHistory } from "@/lib/mainAdaptiveIntegration";
import {
  buildDeterministicCptEvents,
  CPT_EARLIEST_PERFECT_STOP_TRIAL,
  CPT_SPEC,
} from "./fixtures";

vi.mock("@/services", () => ({
  sessionsService: {
    create: vi.fn(),
    postEvents: vi.fn(),
    postBlocks: vi.fn(),
    scoreCpt: vi.fn(),
    getCptStoppingCheck: vi.fn(),
  },
}));

function seedMainPhase() {
  const refs = cptStore.getState()._refs;
  refs.blockStart = performance.now();
  refs.events = [];
  refs.maxTrials = CPT_SPEC.maxTrials;
  refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
  catStore.getState().resetForNewTask();
  cptStore.setState({
    phase: "main",
    sessionId: "sess-test",
    trialIndex: 0,
    trials: [],
    maxTrials: CPT_SPEC.maxTrials,
    events: [],
    currentLetter: "A",
  });
}

function replayMainEvents(count: number) {
  const events = buildDeterministicCptEvents(count, {
    targetTrials: Math.round(count * CPT_SPEC.targetRatio),
    omissions: 0,
    commissions: 0,
    targetRtMs: 400,
    interleaved: true,
  });
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]!;
    cptStore.getState().addEvent({
      task_name: "cpt",
      trial_index: i,
      stimulus_onset_ms: performance.now(),
      keypress_ms: ev.reaction_time_ms != null ? performance.now() : null,
      reaction_time_ms: ev.reaction_time_ms,
      response_key: ev.reaction_time_ms != null ? " " : null,
      correct_key: ev.event_type === "target" ? " " : null,
      is_correct: ev.is_correct,
      event_type: ev.event_type,
      isi_ms: 1000,
      expected_response: ev.event_type === "target",
    });
  }
}

describe("CPT store — adaptive stop pipeline", () => {
  beforeEach(() => {
    cptStore.getState().prepareForFreshRun();
    catStore.getState().resetForNewTask();
  });

  it("latches main_adaptive_stop at the checkpoint trial and does not grow events after", () => {
    seedMainPhase();
    replayMainEvents(CPT_EARLIEST_PERFECT_STOP_TRIAL);
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(true);
    expect(catStore.getState().blockEndTriggerReason).toBe("main_adaptive_stop");
    expect(cptStore.getState().events.length).toBe(CPT_EARLIEST_PERFECT_STOP_TRIAL);
    expect(cptStore.getState().currentLetter).toBeNull();

    const lenBefore = cptStore.getState().events.length;
    cptStore.getState().advanceTrial();
    expect(cptStore.getState().events.length).toBe(lenBefore);
  });

  it("cleanup on adaptive stop clears a pending ISI timeout", () => {
    seedMainPhase();
    const refs = cptStore.getState()._refs;
    refs.nextTrialTimeoutId = setTimeout(() => {}, 60_000);
    replayMainEvents(CPT_EARLIEST_PERFECT_STOP_TRIAL);
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(true);
    expect(refs.nextTrialTimeoutId).toBeUndefined();
  });
});
