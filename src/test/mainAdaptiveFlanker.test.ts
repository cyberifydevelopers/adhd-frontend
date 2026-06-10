import { describe, expect, it } from "vitest";
import {
  collectAdaptiveValidityFlags,
  createAdaptiveHistory,
  evaluateMainAdaptiveCheckpoint,
  getFlankerStoppingGates,
  isMainAdaptiveEvaluationPoint,
  type MainAdaptiveCheckpointData,
} from "@/lib/mainAdaptiveEngine";

function flankerCp(
  trials: number,
  overrides: Partial<MainAdaptiveCheckpointData> = {},
): MainAdaptiveCheckpointData {
  const cong = Math.floor(trials * 0.5);
  const incong = trials - cong;
  return {
    trialsCompleted: trials,
    congruentTrials: cong,
    incongruentTrials: incong,
    incongruentErrors: 1,
    interferenceRtCostMs: 40,
    correctTrials: trials - 1,
    responseTrials: trials,
    trialsAtCurrentDifficulty: trials,
    ...overrides,
  };
}

describe("Flanker adaptive stopping (spec)", () => {
  it("evaluates at min (40) and every 20 trials after min", () => {
    const bounds = { sessionMinTrials: 40, sessionMaxTrials: 100 };
    expect(isMainAdaptiveEvaluationPoint("flanker", flankerCp(39), bounds)).toBe(false);
    expect(isMainAdaptiveEvaluationPoint("flanker", flankerCp(40), bounds)).toBe(true);
    expect(isMainAdaptiveEvaluationPoint("flanker", flankerCp(59), bounds)).toBe(false);
    expect(isMainAdaptiveEvaluationPoint("flanker", flankerCp(60), bounds)).toBe(true);
    expect(isMainAdaptiveEvaluationPoint("flanker", flankerCp(80), bounds)).toBe(true);
  });

  it("stable stop at trial 60 when prior checkpoint exists and gates are met", () => {
    const cp40 = flankerCp(40, {
      congruentTrials: 15,
      incongruentTrials: 25,
      incongruentErrors: 0,
      interferenceRtCostMs: 38,
    });
    const cp60 = flankerCp(60, {
      congruentTrials: 15,
      incongruentTrials: 45,
      incongruentErrors: 0,
      interferenceRtCostMs: 42,
      trialsAtCurrentDifficulty: 20,
    });
    const history = createAdaptiveHistory();
    history.checkpoints = [cp40];

    const gates = getFlankerStoppingGates("diagnostic", history, cp60);
    expect(gates.confidenceMet).toBe(true);

    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "flanker",
      mode: "diagnostic",
      history,
      checkpoint: cp60,
      sessionMinTrials: 40,
      sessionMaxTrials: 100,
    });
    expect(out.decision).toBe("stop_stable");
    expect(out.confidenceMet).toBe(true);
  });

  it("does not stable-stop at first checkpoint (40) without a prior snapshot for cost stability", () => {
    const cp40 = flankerCp(40);
    const history = createAdaptiveHistory();
    const gates = getFlankerStoppingGates("diagnostic", history, cp40);
    expect(gates.costStable).toBe(false);
    expect(gates.confidenceMet).toBe(false);

    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "flanker",
      mode: "diagnostic",
      history,
      checkpoint: cp40,
      sessionMinTrials: 40,
      sessionMaxTrials: 100,
    });
    expect(out.decision).toBe("continue");
  });

  it("passes error CI with zero incongruent errors (Wilson width treated as 0)", () => {
    const history = createAdaptiveHistory();
    history.checkpoints = [
      flankerCp(40, {
        congruentTrials: 15,
        incongruentTrials: 25,
        incongruentErrors: 0,
        interferenceRtCostMs: 38,
      }),
    ];
    const cp60 = flankerCp(60, {
      congruentTrials: 15,
      incongruentTrials: 45,
      incongruentErrors: 0,
      interferenceRtCostMs: 42,
      trialsAtCurrentDifficulty: 5,
    });
    const gates = getFlankerStoppingGates("diagnostic", history, cp60);
    expect(gates.errorCiOk).toBe(true);
    expect(gates.trialsAtLevelOk).toBe(true);
    expect(gates.confidenceMet).toBe(true);
  });

  it("does not stable-stop at second checkpoint when trials-at-difficulty is below 20", () => {
    const cp40 = flankerCp(40, {
      congruentTrials: 15,
      incongruentTrials: 25,
      incongruentErrors: 0,
      interferenceRtCostMs: 38,
      trialsAtCurrentDifficulty: 20,
    });
    const cp60 = flankerCp(60, {
      congruentTrials: 15,
      incongruentTrials: 45,
      incongruentErrors: 0,
      interferenceRtCostMs: 42,
      trialsAtCurrentDifficulty: 8,
    });
    const history = createAdaptiveHistory();
    history.checkpoints = [
      flankerCp(55, {
        congruentTrials: 15,
        incongruentTrials: 40,
        incongruentErrors: 0,
        interferenceRtCostMs: 40,
        trialsCompleted: 55,
      }),
    ];
    const gates = getFlankerStoppingGates("diagnostic", history, cp60);
    expect(gates.trialsAtLevelOk).toBe(false);
    expect(gates.confidenceMet).toBe(false);
  });
});

describe("Flanker validity flags (spec §2)", () => {
  it("flags low accuracy, response bias, and unstable interference at max", () => {
    const history = createAdaptiveHistory();
    history.checkpoints = [
      flankerCp(80, { interferenceRtCostMs: 80, trialsCompleted: 80 }),
    ];
    const cp = flankerCp(100, {
      correctTrials: 50,
      responseTrials: 100,
      flankerDominantResponseShare: 0.85,
      interferenceRtCostMs: 10,
      trialsCompleted: 100,
    });
    const flags = collectAdaptiveValidityFlags("flanker", cp, { reachedMax: true, history });
    expect(flags).toContain("flanker_accuracy_below_70pct");
    expect(flags).toContain("flanker_response_bias_gt_80pct");
    expect(flags).toContain("flanker_interference_unstable_at_session_max");
    expect(flags).toContain("max_trials_reached_without_stability");
  });
});
