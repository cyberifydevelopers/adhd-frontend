import { describe, expect, it } from "vitest";
import type { QcDisplayData } from "@/components/admin/qcValidityUi";
import {
  buildValidityStatusTiles,
  collectExplainedFlags,
} from "@/lib/validityDashboardModel";
import {
  explainValidityFlag,
  validityFlagTitle,
  VALIDITY_IRB_DISCLAIMER,
} from "@/lib/validityFlagExplanations";

function sampleQc(overrides: Partial<QcDisplayData> = {}): QcDisplayData {
  return {
    validity_score: 85,
    overall_confidence_score: 85,
    validity_classification: "valid",
    confidence_tier: "good_confidence",
    practice_passed: true,
    low_confidence_flag: false,
    technical_issue_flag: false,
    assessment_interpretable: true,
    cross_test_flags: [],
    task_confidence_score: { simple_rt: 90, choice_rt: 80 },
    task_validity_flags: {
      simple_rt: ["srt_anticipatory_rate_gt_5pct"],
      choice_rt: ["crt_accuracy_below_70pct"],
    },
    flags: {
      validity_point_breakdown: {
        anticipatory: 1,
        omissions: 0,
        total_points: 1,
      },
    },
    ...overrides,
  };
}

describe("validityFlagExplanations", () => {
  it("returns explicit explanations for engine flag ids", () => {
    expect(explainValidityFlag("sst_go_accuracy_below_80pct")).toContain("Go-trial");
    expect(explainValidityFlag("wm_inconsistent_performance_at_max_sequences")).toContain(
      "Working-memory",
    );
    expect(explainValidityFlag("cross_disengagement_multiple_tasks")).toContain("disengagement");
  });

  it("includes IRB disclaimer text", () => {
    expect(VALIDITY_IRB_DISCLAIMER).toContain("not used to determine");
  });

  it("shortens task-prefixed flag titles", () => {
    expect(validityFlagTitle("cpt_anticipatory_rate_gt_5pct", "cpt")).not.toContain("cpt_");
  });
});

describe("validityDashboardModel", () => {
  it("builds all seven status tiles", () => {
    const tiles = buildValidityStatusTiles(sampleQc());
    const ids = tiles.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "task_understanding",
        "response_consistency",
        "attention_check",
        "random_responding",
        "technical_quality",
      ]),
    );
    expect(tiles.length).toBeGreaterThanOrEqual(5);
  });

  it("marks task understanding concern when practice fails", () => {
    const tiles = buildValidityStatusTiles(sampleQc({ practice_passed: false }));
    const understanding = tiles.find((t) => t.id === "task_understanding");
    expect(understanding?.level).toBe("concern");
  });

  it("collects task and cross-test flags with explanations", () => {
    const flags = collectExplainedFlags(
      sampleQc({
        cross_test_flags: ["cross_disengagement_multiple_tasks"],
      }),
    );
    expect(flags.some((f) => f.source === "task" && f.taskName === "simple_rt")).toBe(true);
    expect(flags.some((f) => f.source === "cross_test")).toBe(true);
    expect(flags.every((f) => f.explanation.length > 0)).toBe(true);
  });

  it("deduplicates redundant cross-test flags already present per task", () => {
    const flags = collectExplainedFlags(
      sampleQc({
        task_validity_flags: { cpt: ["cpt_omission_rate_gt_40pct_suggesting_disengagement"] },
        cross_test_flags: ["cross_disengagement_multiple_tasks"],
      }),
    );
    const cross = flags.filter((f) => f.source === "cross_test");
    expect(cross.length).toBe(1);
  });
});
