import { describe, expect, it } from "vitest";
import {
  buildSstMainTrialSchedule,
  sstMinStopTrialsForSession,
} from "@/lib/mainAdaptiveBridge";

describe("buildSstMainTrialSchedule", () => {
  it("guarantees at least 50 stop trials in a 200-trial session", () => {
    const trials = buildSstMainTrialSchedule(200, 50, () => 1500);
    expect(trials).toHaveLength(200);
    const stops = trials.filter((t) => t.type === "stop").length;
    expect(stops).toBeGreaterThanOrEqual(50);
    expect(trials.filter((t) => t.type === "go").length).toBe(200 - stops);
  });

  it("maps session length to minimum stop quota", () => {
    expect(sstMinStopTrialsForSession(200)).toBe(50);
    expect(sstMinStopTrialsForSession(120)).toBe(30);
  });
});
