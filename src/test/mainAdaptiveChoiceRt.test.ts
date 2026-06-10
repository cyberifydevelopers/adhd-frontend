import { describe, expect, it } from "vitest";
import {
  createAdaptiveHistory,
  evaluateMainAdaptiveCheckpoint,
  isMainAdaptiveEvaluationPoint,
  type MainAdaptiveCheckpointData,
} from "@/lib/mainAdaptiveEngine";

function crtCp(
  valid: number,
  overrides: Partial<MainAdaptiveCheckpointData> = {},
): MainAdaptiveCheckpointData {
  return {
    trialsCompleted: valid,
    validTrialsCompleted: valid,
    correctTrials: valid,
    responseTrials: valid,
    medianRtMs: 400,
    rtVariability: 50,
    ...overrides,
  };
}

describe("Choice RT adaptive stopping (spec)", () => {
  const bounds = { sessionMinTrials: 30, sessionMaxTrials: 80 };

  it("evaluates at min (30) and every 10 valid trials after min", () => {
    expect(isMainAdaptiveEvaluationPoint("choice_rt", crtCp(29), bounds)).toBe(false);
    expect(isMainAdaptiveEvaluationPoint("choice_rt", crtCp(30), bounds)).toBe(true);
    expect(isMainAdaptiveEvaluationPoint("choice_rt", crtCp(39), bounds)).toBe(false);
    expect(isMainAdaptiveEvaluationPoint("choice_rt", crtCp(40), bounds)).toBe(true);
    expect(isMainAdaptiveEvaluationPoint("choice_rt", crtCp(50), bounds)).toBe(true);
  });

  it("does not stable-stop at first checkpoint without a prior snapshot for RT stability", () => {
    const cp30 = crtCp(30);
    const history = createAdaptiveHistory();
    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "choice_rt",
      mode: "diagnostic",
      history,
      checkpoint: cp30,
      ...bounds,
    });
    expect(out.decision).toBe("continue");
    expect(out.confidenceMet).toBe(false);
  });

  it("stable stop at second checkpoint (40 valid) when accuracy CI and RT stability are met", () => {
    const cp30 = crtCp(30, { medianRtMs: 400, rtVariability: 50 });
    const cp40 = crtCp(40, { medianRtMs: 410, rtVariability: 52 });
    const history = createAdaptiveHistory();
    history.checkpoints = [cp30];

    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "choice_rt",
      mode: "diagnostic",
      history,
      checkpoint: cp40,
      ...bounds,
    });
    expect(out.decision).toBe("stop_stable");
    expect(out.confidenceMet).toBe(true);
  });
});
