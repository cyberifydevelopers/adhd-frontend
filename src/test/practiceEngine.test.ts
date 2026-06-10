import { describe, expect, it } from "vitest";

import {
  evaluatePracticeBlock,
  type PracticeConfig,
  type PracticeEvent,
  type PracticeState,
} from "@/lib/practiceEngine";

const baseConfig: PracticeConfig = {
  minTrials: 5,
  maxTrials: 20,
  evaluationInterval: 5,
  passThreshold: 0.8,
  continueThreshold: 0.5,
  finalTrialCount: 0,
};

function makeState(partial: Partial<PracticeState>): PracticeState {
  return {
    subPhase: "early",
    totalTrialsCompleted: 0,
    currentBlockCorrect: 0,
    currentBlockTrials: 0,
    overallCorrect: 0,
    blocksCompleted: 0,
    instructionRedisplays: 0,
    passed: false,
    lowConfidence: false,
    practiceErrorPattern: null,
    consecutiveCorrectSequences: 0,
    sstGoTrials: 0,
    sstGoCorrect: 0,
    sstStopTrials: 0,
    sstStopSuccess: 0,
    sstNeverStopped: false,
    sstAlwaysWaiting: false,
    events: [],
    ...partial,
  };
}

describe("practiceEngine evaluatePracticeBlock", () => {
  it("proceeds immediately when last-5 accuracy meets pass threshold", () => {
    const events: PracticeEvent[] = Array.from({ length: 5 }, (_, i) => ({
      trialNumber: i + 1,
      isCorrect: true,
      errorType: "correct",
      reactionTimeMs: 450,
      accuracyAtPoint: 1,
      windowAccuracyAtPoint: 1,
      subPhase: "early",
    }));
    const state = makeState({
      totalTrialsCompleted: 5,
      overallCorrect: 5,
      currentBlockTrials: 5,
      currentBlockCorrect: 5,
      events,
    });

    const decision = evaluatePracticeBlock(state, baseConfig);
    expect(decision).toEqual({
      action: "proceed_to_main",
      passed: true,
      lowConfidence: false,
    });
  });

  it("does not reinstruct before minTrials even at an evaluation checkpoint", () => {
    const config: PracticeConfig = {
      ...baseConfig,
      minTrials: 6,
      evaluationInterval: 5,
      finalTrialCount: 0,
    };
    const state = makeState({
      totalTrialsCompleted: 5,
      events: Array.from({ length: 5 }, (_, i) => ({
        trialNumber: i + 1,
        isCorrect: true,
        errorType: "correct",
        reactionTimeMs: 500,
        accuracyAtPoint: 1,
        windowAccuracyAtPoint: 1,
        subPhase: "early",
      })),
    });

    const decision = evaluatePracticeBlock(state, config);
    expect(decision).toEqual({ action: "continue" });
  });

  it("hard-stops at max trials and proceeds with low confidence", () => {
    const state = makeState({
      totalTrialsCompleted: 20,
      overallCorrect: 10, // 50%
      currentBlockTrials: 5,
    });

    const decision = evaluatePracticeBlock(state, baseConfig);
    expect(decision).toEqual({
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
    });
  });

  it("hard-stops at max trials and does not mark passed even if accuracy is high (forced proceed)", () => {
    const state = makeState({
      totalTrialsCompleted: 20,
      overallCorrect: 18, // 90%
      currentBlockTrials: 5,
    });

    const decision = evaluatePracticeBlock(state, baseConfig);
    expect(decision).toEqual({
      action: "proceed_to_main",
      passed: false,
      lowConfidence: true,
    });
  });
});
