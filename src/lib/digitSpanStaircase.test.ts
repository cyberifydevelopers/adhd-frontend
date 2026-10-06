import { describe, expect, it } from "vitest";
import { DIGIT_SPAN_RECALL_MS, digitSpanOutcomeAfterTwoTrials } from "./digitSpanSpec";

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

describe("DIGIT_SPAN_RECALL_MS", () => {
  it("allows 15 seconds for entry", () => {
    expect(DIGIT_SPAN_RECALL_MS).toBe(15000);
  });
});
