import { describe, it, expect, beforeEach } from "vitest";
import { catStore } from "../stores/catStore";

describe("catStore", () => {
  beforeEach(() => {
    catStore.getState().resetForNewTask();
  });

  it("does not trigger before min trial count", () => {
    for (let i = 0; i < 15; i++) {
      catStore.getState().addTrial({ reaction_time_ms: 300 + i, expected_response: true });
    }
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(false);
  });

  it("triggers lapse_streak at exactly 5 consecutive omissions", () => {
    const variableRTs = [200, 400, 250, 350, 300, 380, 220, 320, 280, 360, 240, 340, 260, 330, 290, 370, 210, 310, 270, 350];
    for (const rt of variableRTs) {
      catStore.getState().addTrial({ reaction_time_ms: rt, expected_response: true });
    }
    for (let i = 0; i < 5; i++) {
      catStore.getState().addTrial({ reaction_time_ms: null, expected_response: true });
    }
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(true);
    expect(catStore.getState().blockEndTriggerReason).toBe("lapse_streak");
  });

  it("CI width calculation converges correctly", () => {
    const rts = Array.from({ length: 30 }, () => 350);
    for (let i = 0; i < 25; i++) {
      catStore.getState().addTrial({ reaction_time_ms: rts[i], expected_response: true });
    }
    const ciWidth = catStore.getState().currentTaskCIWidth;
    expect(ciWidth).not.toBeNull();
    expect(ciWidth).toBeLessThan(50);
  });

  it("resetForNewTask clears state", () => {
    catStore.getState().addTrial({ reaction_time_ms: 300, expected_response: true });
    catStore.getState().setBlockEndTrigger("main_adaptive_stop");
    catStore.getState().resetForNewTask();
    expect(catStore.getState().trialBuffer).toHaveLength(0);
    expect(catStore.getState().lapseStreak).toBe(0);
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(false);
    expect(catStore.getState().lastBlockEndSignalReason).toBeNull();
  });

  it("clearTrigger resets trigger flag", () => {
    catStore.getState().setBlockEndTrigger("ci_converged");
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(true);
    catStore.getState().clearTrigger();
    expect(catStore.getState().shouldTriggerBlockEnd).toBe(false);
    expect(catStore.getState().blockEndTriggerReason).toBeNull();
    expect(catStore.getState().lastBlockEndSignalReason).toBe("ci_converged");
  });
});
