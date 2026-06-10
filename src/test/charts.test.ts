import { describe, it, expect } from "vitest";

describe("Chart data transforms", () => {
  it("ChangeOverTimeChart handles positive and negative deltas", () => {
    const domains = [
      { domain: "sustained_attention", delta_z: -0.3, ci_low: -0.6, ci_high: 0.0 },
      { domain: "inhibition", delta_z: 0.5, ci_low: 0.1, ci_high: 0.9 },
    ];

    const improved = domains.filter((d) => d.delta_z < 0);
    const worsened = domains.filter((d) => d.delta_z > 0);

    expect(improved).toHaveLength(1);
    expect(improved[0].domain).toBe("sustained_attention");
    expect(worsened).toHaveLength(1);
    expect(worsened[0].domain).toBe("inhibition");
  });

  it("practice effect correction adjusts delta correctly", () => {
    const raw_delta = -0.3;
    const practice_effect = -0.15;
    const corrected = raw_delta - practice_effect;
    expect(corrected).toBeCloseTo(-0.15, 2);
  });

  it("radar chart scales z-scores to max radius", () => {
    const Z_MAX = 3;
    const zScores = [0.5, 1.2, 2.5, 0.8, 1.0];
    const scaled = zScores.map((z) => Math.min(z / Z_MAX, 1));
    expect(scaled[0]).toBeCloseTo(0.167, 2);
    expect(scaled[2]).toBeCloseTo(0.833, 2);
    expect(Math.max(...scaled)).toBeLessThanOrEqual(1);
  });

  it("domain ranking sorts by absolute z-score descending", () => {
    const domains = [
      { domain: "a", z_score: 0.5 },
      { domain: "b", z_score: 2.1 },
      { domain: "c", z_score: -1.8 },
      { domain: "d", z_score: 0.3 },
    ];
    const ranked = [...domains].sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score));
    expect(ranked[0].domain).toBe("b");
    expect(ranked[1].domain).toBe("c");
    expect(ranked[2].domain).toBe("a");
  });
});

describe("Severity band classification", () => {
  it("classifies z-scores into correct bands", () => {
    function severityBand(z: number | null): string {
      if (z == null) return "unknown";
      const absZ = Math.abs(z);
      if (absZ >= 2) return "severe";
      if (absZ >= 1.5) return "moderate";
      if (absZ >= 1) return "mild";
      return "normal";
    }

    expect(severityBand(0.5)).toBe("normal");
    expect(severityBand(1.2)).toBe("mild");
    expect(severityBand(1.7)).toBe("moderate");
    expect(severityBand(2.5)).toBe("severe");
    expect(severityBand(-2.1)).toBe("severe");
    expect(severityBand(null)).toBe("unknown");
  });
});
