import { describe, expect, it } from "vitest";
import {
  clampImmediateAmount,
  immediateBoundsForDelayed,
  randomInitialImmediate,
  randomStaircaseStep,
  resolveDelayDiscountingSessionParams,
} from "@/lib/delayDiscountingRandom";

describe("resolveDelayDiscountingSessionParams", () => {
  it("uses explicit config values when provided", () => {
    const p = resolveDelayDiscountingSessionParams({
      delayed_amount: 100,
      delay_days: 30,
      initial_immediate: 55,
      staircase_step: 12,
    });
    expect(p).toEqual({
      delayedAmount: 100,
      delayDays: 30,
      initialImmediate: 55,
      staircaseStep: 12,
      minImmediate: 5,
      maxImmediate: 95,
    });
  });

  it("clamps configured initial immediate to bounds", () => {
    const p = resolveDelayDiscountingSessionParams({
      delayed_amount: 90,
      initial_immediate: 200,
    });
    expect(p.initialImmediate).toBe(85);
    expect(p.maxImmediate).toBe(85);
  });
});

describe("random helpers", () => {
  it("keeps initial immediate within 35–65% band", () => {
    for (let i = 0; i < 50; i++) {
      const delayed = 100;
      const { minImmediate, maxImmediate } = immediateBoundsForDelayed(delayed);
      const initial = randomInitialImmediate(delayed, minImmediate, maxImmediate);
      expect(initial).toBeGreaterThanOrEqual(35);
      expect(initial).toBeLessThanOrEqual(65);
    }
  });

  it("scales staircase step with delayed amount", () => {
    for (let i = 0; i < 30; i++) {
      const step = randomStaircaseStep(100);
      expect(step).toBeGreaterThanOrEqual(10);
      expect(step).toBeLessThanOrEqual(34);
    }
  });

  it("clampImmediateAmount respects bounds", () => {
    expect(clampImmediateAmount(120, 5, 95)).toBe(95);
    expect(clampImmediateAmount(2, 5, 95)).toBe(5);
  });
});
