import { describe, expect, it } from "vitest";
import { digitSpanOutcomeAfterTwoTrials, digitSpanRecallMs } from "./digitSpanSpec";

describe("digitSpanOutcomeAfterTwoTrials", () => {
  it("fails the ladder on 0/2", () => {
    expect(digitSpanOutcomeAfterTwoTrials(0)).toBe("fail");
  });

  it("advances on 1/2 (spec: at least one correct)", () => {
    expect(digitSpanOutcomeAfterTwoTrials(1)).toBe("advance");
  });

  it("advances on 2/2", () => {
    expect(digitSpanOutcomeAfterTwoTrials(2)).toBe("advance");
  });
});

describe("digitSpanRecallMs", () => {
  it("uses span + 3 seconds in milliseconds", () => {
    expect(digitSpanRecallMs(3)).toBe(6000);
    expect(digitSpanRecallMs(9)).toBe(12000);
  });
});
