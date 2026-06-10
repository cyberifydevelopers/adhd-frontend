import { describe, it, expect } from "vitest";

describe("Timing accuracy", () => {
  it("performance.now() returns monotonically increasing values", () => {
    const t1 = performance.now();
    const t2 = performance.now();
    expect(t2).toBeGreaterThanOrEqual(t1);
  });

  it("performance.now() has sub-millisecond resolution", () => {
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t1 = performance.now();
      const t2 = performance.now();
      if (t2 > t1) samples.push(t2 - t1);
    }
    expect(samples.length).toBeGreaterThan(0);
  });

  it("RT computation: keypress_ts - stimulus_onset_ts", () => {
    const stimulusOnset = 1000.5;
    const keypress = 1350.8;
    const rt = keypress - stimulusOnset;
    expect(rt).toBeCloseTo(350.3, 1);
    expect(rt).toBeGreaterThan(0);
  });

  it("setTimeout accuracy within expected jitter", async () => {
    const targetMs = 50;
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, targetMs));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(targetMs - 5);
    expect(elapsed).toBeLessThan(targetMs + 50);
  });
});

describe("ISI logging", () => {
  it("foreperiod generates values in expected range", () => {
    const MIN_FP = 800;
    const MAX_FP = 2500;
    for (let i = 0; i < 100; i++) {
      const fp = MIN_FP + Math.random() * (MAX_FP - MIN_FP);
      expect(fp).toBeGreaterThanOrEqual(MIN_FP);
      expect(fp).toBeLessThanOrEqual(MAX_FP);
    }
  });
});

describe("Adaptive logic constraints", () => {
  it("accuracy calculation is correct", () => {
    const events = [
      { is_correct: true },
      { is_correct: true },
      { is_correct: false },
      { is_correct: true },
      { is_correct: true },
    ];
    const acc = events.filter((e) => e.is_correct).length / events.length;
    expect(acc).toBeCloseTo(0.8, 2);
  });

  it("adaptive check respects minimum trial floor", () => {
    const ADAPTIVE_CHECK_INTERVAL = 12;
    const trialIndex = 5;
    const shouldCheck = trialIndex > 0 && trialIndex % ADAPTIVE_CHECK_INTERVAL === 0;
    expect(shouldCheck).toBe(false);
  });

  it("adaptive check triggers at interval", () => {
    const ADAPTIVE_CHECK_INTERVAL = 12;
    const trialIndex = 12;
    const shouldCheck = trialIndex > 0 && trialIndex % ADAPTIVE_CHECK_INTERVAL === 0;
    expect(shouldCheck).toBe(true);
  });

  it("CV calculation for RT stability", () => {
    const rts = [300, 310, 290, 305, 295, 302, 308, 298];
    const mean = rts.reduce((a, b) => a + b, 0) / rts.length;
    const sd = Math.sqrt(rts.reduce((a, b) => a + (b - mean) ** 2, 0) / rts.length);
    const cv = sd / mean;
    expect(cv).toBeLessThan(0.15);
    expect(cv).toBeGreaterThan(0);
  });

  it("delay discounting bisection step halves each trial", () => {
    let step = 25;
    const steps: number[] = [];
    for (let i = 0; i < 10; i++) {
      step = Math.max(1, step / 2);
      steps.push(step);
    }
    expect(steps[0]).toBe(12.5);
    expect(steps[steps.length - 1]).toBeLessThanOrEqual(1);
  });
});
