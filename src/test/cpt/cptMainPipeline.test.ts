import { describe, expect, it } from "vitest";
import { ADAPTIVE_DEFAULTS, MAIN_TASK_ADAPTIVE_TRIAL_LIMITS } from "@/config/catConfig";
import {
  buildCptCheckpoint,
  computeCptLapseRate,
  computeCptTimeOnTaskSlopeMsPerQuarter,
} from "@/lib/mainAdaptiveBridge";
import {
  CI_WIDTH_CPT_RATE,
  collectAdaptiveValidityFlags,
  confidenceCpt,
  createAdaptiveHistory,
  evaluateMainAdaptiveCheckpoint,
  getCptStoppingGates,
  isMainAdaptiveEvaluationPoint,
  mergeCptCheckpointTrail,
  stableCptLapseRateAcrossTwo,
  stableCptTimeOnTaskSlopeAcrossTwo,
  stableRtVariabilityAcrossTwo,
  wilson95Width,
} from "@/lib/mainAdaptiveEngine";
import { buildCPTTrials } from "@/stores/cptStore";
import {
  CPT_CHECKPOINT_TRIALS,
  CPT_EARLIEST_PERFECT_STOP_TRIAL,
  CPT_FIRST_STOP_EVAL_TRIAL,
  CPT_SPEC,
  buildDeterministicCptEvents,
  cptCheckpoint,
  evaluateCptAtTrial,
} from "./fixtures";

describe("CPT main test — spec limits & MVP config", () => {
  it("uses min 150 / max 360 scored trials", () => {
    expect(MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.cpt.minTrials).toBe(CPT_SPEC.minTrials);
    expect(MAIN_TASK_ADAPTIVE_TRIAL_LIMITS.cpt.maxTrials).toBe(CPT_SPEC.maxTrials);
  });

  it("uses fixed MVP target probability 20–25% (midpoint 22.5%)", () => {
    expect(ADAPTIVE_DEFAULTS.cpt.targetRatio).toBeGreaterThanOrEqual(0.2);
    expect(ADAPTIVE_DEFAULTS.cpt.targetRatio).toBeLessThanOrEqual(0.25);
    expect(ADAPTIVE_DEFAULTS.cpt.targetRatio).toBe(0.225);
  });

  it("uses jittered ISI 1000–2000 ms and response window for scored block", () => {
    expect(ADAPTIVE_DEFAULTS.cpt.isiMin).toBe(1000);
    expect(ADAPTIVE_DEFAULTS.cpt.isiMax).toBe(2000);
    expect(ADAPTIVE_DEFAULTS.cpt.responseWindow).toBeGreaterThan(0);
  });

  it("buildCPTTrials assigns ISI within configured bounds", () => {
    const trials = buildCPTTrials(40);
    expect(trials).toHaveLength(40);
    for (const t of trials) {
      expect(t.isi_ms).toBeGreaterThanOrEqual(ADAPTIVE_DEFAULTS.cpt.isiMin);
      expect(t.isi_ms).toBeLessThanOrEqual(ADAPTIVE_DEFAULTS.cpt.isiMax);
      expect(["target", "nontarget"]).toContain(t.type);
    }
  });
});

describe("CPT main test — checkpoint cadence", () => {
  const bounds = { sessionMinTrials: CPT_SPEC.minTrials, sessionMaxTrials: CPT_SPEC.maxTrials };

  it("records rolling snapshots every 60 trials (60, 120, …)", () => {
    for (const t of CPT_CHECKPOINT_TRIALS) {
      expect(isMainAdaptiveEvaluationPoint("cpt", cptCheckpoint(t), bounds)).toBe(true);
    }
  });

  it("does not evaluate on non-checkpoint trials", () => {
    for (const t of [59, 61, 149, 151, 179, 181, 209, 211, 359]) {
      expect(isMainAdaptiveEvaluationPoint("cpt", cptCheckpoint(t), bounds)).toBe(false);
    }
  });

  it("first stopping evaluation is trial 180", () => {
    expect(CPT_FIRST_STOP_EVAL_TRIAL).toBe(180);
    expect(isMainAdaptiveEvaluationPoint("cpt", cptCheckpoint(180), bounds)).toBe(true);
  });
});

describe("CPT bridge — metrics from scored events", () => {
  it("counts omissions and commissions like the spec", () => {
    const events = buildDeterministicCptEvents(100, {
      targetTrials: 25,
      omissions: 3,
      commissions: 2,
    });
    const cp = buildCptCheckpoint(events, CPT_SPEC.maxTrials);
    expect(cp.trialsCompleted).toBe(100);
    expect(cp.omissions).toBe(3);
    expect(cp.commissions).toBe(2);
    expect(cp.targetTrialsTotal).toBe(25);
    expect(cp.nonTargetTrialsTotal).toBe(75);
  });

  it("lapse rate includes omissions and slow target RTs (>2× median)", () => {
    const events = buildDeterministicCptEvents(40, {
      targetTrials: 20,
      omissions: 2,
      slowLapseCount: 2,
      targetRtMs: 400,
    });
    const lapse = computeCptLapseRate(events);
    expect(lapse).not.toBeNull();
    expect(lapse!).toBeGreaterThan(0.1);
  });

  it("computes time-on-task slope from quarter mean RTs", () => {
    const events = buildDeterministicCptEvents(80, {
      targetTrials: 40,
      omissions: 0,
      rtSlopePerTrial: 4,
    });
    const slope = computeCptTimeOnTaskSlopeMsPerQuarter(events);
    expect(slope).not.toBeNull();
    expect(slope!).toBeGreaterThan(0);
  });

  it("flags device timing when dropped frames ≥ 8", () => {
    const events = buildDeterministicCptEvents(50, { targetTrials: 12 });
    const cp = buildCptCheckpoint(events, CPT_SPEC.maxTrials, 5, { droppedFrames: 8 });
    expect(cp.deviceTimingJitterFlag).toBe(true);
  });
});

describe("CPT adaptive stopping — Wilson CI gates", () => {
  it("requires omission and commission Wilson width ≤ 0.08", () => {
    expect(CI_WIDTH_CPT_RATE).toBe(CPT_SPEC.ciWidth);
    const tight = cptCheckpoint(240, {
      omissions: 0,
      targetTrialsTotal: 54,
      commissions: 0,
      nonTargetTrialsTotal: 186,
    });
    const loose = cptCheckpoint(240, {
      omissions: 12,
      targetTrialsTotal: 54,
      commissions: 1,
      nonTargetTrialsTotal: 186,
    });
    expect(wilson95Width(tight.omissions!, tight.targetTrialsTotal!)).toBeLessThanOrEqual(
      CI_WIDTH_CPT_RATE,
    );
    expect(wilson95Width(loose.omissions!, loose.targetTrialsTotal!)).toBeGreaterThan(
      CI_WIDTH_CPT_RATE,
    );
  });
});

describe("CPT adaptive stopping — stability gates", () => {
  it("uses RT variability (MAD) only, not median RT shift", () => {
    const prev = cptCheckpoint(120, { medianRtMs: 500, rtVariability: 60 });
    const curr = cptCheckpoint(180, { medianRtMs: 700, rtVariability: 61 });
    expect(stableRtVariabilityAcrossTwo([prev, curr])).toBe(true);
  });

  it("requires lapse rate stable across two consecutive checkpoints", () => {
    const stable = [
      cptCheckpoint(120, { cptLapseRate: 0.04 }),
      cptCheckpoint(180, { cptLapseRate: 0.045 }),
    ];
    const unstable = [
      cptCheckpoint(120, { cptLapseRate: 0.04 }),
      cptCheckpoint(180, { cptLapseRate: 0.14 }),
    ];
    expect(stableCptLapseRateAcrossTwo(stable)).toBe(true);
    expect(stableCptLapseRateAcrossTwo(unstable)).toBe(false);
  });

  it("requires time-on-task slope stable across two consecutive checkpoints", () => {
    const stable = [
      cptCheckpoint(120, { cptTimeOnTaskSlopeMsPerQuarter: -8 }),
      cptCheckpoint(180, { cptTimeOnTaskSlopeMsPerQuarter: -10 }),
    ];
    const unstable = [
      cptCheckpoint(120, { cptTimeOnTaskSlopeMsPerQuarter: -40 }),
      cptCheckpoint(180, { cptTimeOnTaskSlopeMsPerQuarter: 5 }),
    ];
    expect(stableCptTimeOnTaskSlopeAcrossTwo(stable)).toBe(true);
    expect(stableCptTimeOnTaskSlopeAcrossTwo(unstable)).toBe(false);
  });

  it("holds difficulty adjustment during scored block (MVP)", () => {
    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "cpt",
      mode: "diagnostic",
      history: createAdaptiveHistory(),
      checkpoint: cptCheckpoint(200),
      sessionMinTrials: CPT_SPEC.minTrials,
      sessionMaxTrials: CPT_SPEC.maxTrials,
    });
    expect(out.recommendedDifficulty).toBe("hold");
  });
});

describe("CPT adaptive stopping — decisions", () => {
  it("does not stop at 120 — below minimum scored trials", () => {
    const events = buildDeterministicCptEvents(120, {
      targetTrials: 27,
      omissions: 0,
      commissions: 0,
    });
    const out = evaluateCptAtTrial(events, 120, createAdaptiveHistory());
    expect(out.decision).toBe("continue");
    expect(out.confidenceMet).toBe(false);
  });

  it("stop_stable at 240 when omission/commission CI, RT MAD, lapse, and slope are stable", () => {
    const history = createAdaptiveHistory();
    history.checkpoints = [
      cptCheckpoint(120, {
        targetTrialsTotal: 27,
        nonTargetTrialsTotal: 93,
        rtVariability: 60,
        cptLapseRate: 0,
        cptTimeOnTaskSlopeMsPerQuarter: -5,
      }),
      cptCheckpoint(180, {
        targetTrialsTotal: 41,
        nonTargetTrialsTotal: 139,
        rtVariability: 61,
        cptLapseRate: 0,
        cptTimeOnTaskSlopeMsPerQuarter: -5,
      }),
    ];
    const curr = cptCheckpoint(240, {
      targetTrialsTotal: 54,
      nonTargetTrialsTotal: 186,
      omissions: 0,
      commissions: 0,
      rtVariability: 62,
      cptLapseRate: 0,
      cptTimeOnTaskSlopeMsPerQuarter: -4,
    });
    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "cpt",
      mode: "diagnostic",
      history,
      checkpoint: curr,
      sessionMinTrials: CPT_SPEC.minTrials,
      sessionMaxTrials: CPT_SPEC.maxTrials,
    });
    expect(getCptStoppingGates("diagnostic", history, curr).confidenceMet).toBe(true);
    expect(out.decision).toBe("stop_stable");
    expect(out.confidenceMet).toBe(true);
    expect(out.adaptiveStoppingReason).toBe("spec_stopping_criteria_met");
  });

  it("excellent deterministic profile stops by trial 240 (not at max)", () => {
    const events = buildDeterministicCptEvents(CPT_EARLIEST_PERFECT_STOP_TRIAL, {
      targetTrials: 54,
      omissions: 0,
      commissions: 0,
      targetRtMs: 400,
      interleaved: true,
    });
    let history = createAdaptiveHistory();
    let stoppedAt: number | null = null;
    for (const t of [60, 120, 180, CPT_EARLIEST_PERFECT_STOP_TRIAL] as const) {
      const step = evaluateCptAtTrial(events, t, history);
      history = step.history;
      if (step.decision === "stop_stable" && stoppedAt == null) {
        stoppedAt = t;
      }
    }
    expect(stoppedAt).not.toBeNull();
    expect(stoppedAt!).toBeGreaterThanOrEqual(CPT_FIRST_STOP_EVAL_TRIAL);
    expect(stoppedAt!).toBeLessThanOrEqual(CPT_EARLIEST_PERFECT_STOP_TRIAL);
  });

  it("bridge checkpoint yields narrow Wilson CIs when there are no misses", () => {
    const events = buildDeterministicCptEvents(240, {
      targetTrials: 54,
      omissions: 0,
      commissions: 0,
      targetRtMs: 500,
    });
    const cp = buildCptCheckpoint(events, CPT_SPEC.maxTrials);
    expect(wilson95Width(cp.omissions!, cp.targetTrialsTotal!)).toBeLessThanOrEqual(
      CI_WIDTH_CPT_RATE,
    );
    expect(wilson95Width(cp.commissions!, cp.nonTargetTrialsTotal!)).toBeLessThanOrEqual(
      CI_WIDTH_CPT_RATE,
    );
    expect(cp.cptLapseRate).toBe(0);
  });

  it("continues at 180 when omission CI is too wide (high miss rate)", () => {
    const events = buildDeterministicCptEvents(180, {
      targetTrials: 41,
      omissions: 12,
      commissions: 1,
    });
    const history = createAdaptiveHistory();
    history.checkpoints = [
      buildCptCheckpoint(buildDeterministicCptEvents(120, { targetTrials: 27, omissions: 8 }), 360),
    ];
    const out = evaluateCptAtTrial(events, 180, history);
    expect(out.decision).toBe("continue");
    expect(out.confidenceMet).toBe(false);
    expect(getCptStoppingGates("diagnostic", history, out.history.checkpoints.at(-1)!).omissionOk).toBe(
      false,
    );
  });

  it("continues at 180 when lapse rate is unstable even if accuracy looks high on non-targets", () => {
    const prev = buildCptCheckpoint(
      buildDeterministicCptEvents(120, { targetTrials: 27, omissions: 1, slowLapseCount: 0 }),
      360,
    );
    const currEvents = buildDeterministicCptEvents(180, {
      targetTrials: 41,
      omissions: 1,
      commissions: 1,
      slowLapseCount: 8,
    });
    const history = createAdaptiveHistory();
    history.checkpoints = [prev];
    const out = evaluateCptAtTrial(currEvents, 180, history);
    expect(out.decision).toBe("continue");
    expect(confidenceCpt("diagnostic", history, buildCptCheckpoint(currEvents, 360))).toBe(false);
  });

  it("continues at 180 when time-on-task slope is unstable", () => {
    const history = createAdaptiveHistory();
    history.checkpoints = [cptCheckpoint(120, { cptTimeOnTaskSlopeMsPerQuarter: -40 })];
    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "cpt",
      mode: "diagnostic",
      history,
      checkpoint: cptCheckpoint(180, { cptTimeOnTaskSlopeMsPerQuarter: 8 }),
      sessionMinTrials: CPT_SPEC.minTrials,
      sessionMaxTrials: CPT_SPEC.maxTrials,
    });
    expect(out.decision).toBe("continue");
    expect(out.confidenceMet).toBe(false);
  });

  it("does not stop_stable before 360 with ~5 target omissions (high withhold %, narrow commission CI only)", () => {
    const events = buildDeterministicCptEvents(360, {
      targetTrials: 81,
      omissions: 5,
      commissions: 0,
      targetRtMs: 577,
      interleaved: true,
    });
    let history = createAdaptiveHistory();
    let stoppedEarly: number | null = null;
    for (const t of [180, 240, 300] as const) {
      const step = evaluateCptAtTrial(events.slice(0, t), t, history);
      history = step.history;
      if (step.decision === "stop_stable" && stoppedEarly == null) {
        stoppedEarly = t;
      }
      expect(step.decision).toBe("continue");
    }
    expect(stoppedEarly).toBeNull();
    const at360 = evaluateCptAtTrial(events, 360, history);
    expect(at360.decision).toBe("stop_max_low_confidence");
    expect(at360.confidenceMet).toBe(false);
  });

  it("stop_max_low_confidence at 360 when stability never met (user-like profile)", () => {
    const events = buildDeterministicCptEvents(360, {
      targetTrials: 81,
      omissions: 12,
      commissions: 4,
      slowLapseCount: 6,
    });
    let history = createAdaptiveHistory();
    for (const t of [60, 120, 180, 240, 300] as const) {
      const step = evaluateCptAtTrial(events, t, history);
      history = step.history;
      expect(step.decision).toBe("continue");
    }
    const at360 = evaluateCptAtTrial(events, 360, history);
    expect(at360.decision).toBe("stop_max_low_confidence");
    expect(at360.confidenceMet).toBe(false);
    expect(at360.lowConfidenceFlag).toBe(true);
    expect(at360.adaptiveStoppingReason).toBe("max_trials_reached_without_stability");
  });

  it("dedupes checkpoint trail for UI when max trial is appended twice", () => {
    const cp300 = cptCheckpoint(300, { omissions: 1, targetTrialsTotal: 68, commissions: 2 });
    const cp360 = cptCheckpoint(360, { omissions: 1, targetTrialsTotal: 81, commissions: 2 });
    const trail = mergeCptCheckpointTrail([cp300, cp300], cp360);
    expect(trail.filter((x) => x.trialsCompleted === 360)).toHaveLength(1);
  });
});

describe("CPT adaptive stopping — fatigue slope gate (extended mode)", () => {
  it("blocks stop_stable when fatigue analysis is active and scored duration < 4 min", () => {
    const history = createAdaptiveHistory();
    history.checkpoints = [
      cptCheckpoint(180, {
        targetTrialsTotal: 41,
        nonTargetTrialsTotal: 139,
        omissions: 0,
        commissions: 0,
        cptLapseRate: 0,
        cptTimeOnTaskSlopeMsPerQuarter: -5,
        rtVariability: 55,
      }),
    ];
    const checkpoint = cptCheckpoint(240, {
      omissions: 0,
      targetTrialsTotal: 54,
      commissions: 0,
      nonTargetTrialsTotal: 186,
      rtVariability: 56,
      cptLapseRate: 0,
      cptTimeOnTaskSlopeMsPerQuarter: -6,
      fatigueSlopeAnalysisActive: true,
      scoredDurationMinutes: 2,
    });
    expect(confidenceCpt("diagnostic", history, checkpoint)).toBe(true);
    const out = evaluateMainAdaptiveCheckpoint({
      taskKey: "cpt",
      mode: "diagnostic",
      history,
      checkpoint,
      sessionMinTrials: CPT_SPEC.minTrials,
      sessionMaxTrials: CPT_SPEC.maxTrials,
    });
    expect(out.decision).toBe("continue");
    expect(out.confidenceMet).toBe(false);
  });
});

describe("CPT validity flags (low-confidence)", () => {
  const history = createAdaptiveHistory();

  it("flags anticipatory_rate > 5%", () => {
    const flags = collectAdaptiveValidityFlags(
      "cpt",
      cptCheckpoint(200, { cptAnticipatoryRate: 0.06 }),
      { reachedMax: false },
    );
    expect(flags).toContain("cpt_anticipatory_rate_gt_5pct");
  });

  it("flags omission_rate > 40% (disengagement)", () => {
    const flags = collectAdaptiveValidityFlags(
      "cpt",
      cptCheckpoint(200, { omissions: 20, targetTrialsTotal: 40 }),
      { reachedMax: false },
    );
    expect(flags).toContain("cpt_omission_rate_gt_40pct_suggesting_disengagement");
  });

  it("flags too_few_target_trials at max when below 30 targets", () => {
    const flags = collectAdaptiveValidityFlags(
      "cpt",
      cptCheckpoint(360, { omissions: 0, targetTrialsTotal: 20 }),
      { reachedMax: true, history },
    );
    expect(flags).toContain("cpt_too_few_target_trials");
  });

  it("flags device timing problem from dropped frames", () => {
    const cp = buildCptCheckpoint(buildDeterministicCptEvents(160, { targetTrials: 36 }), 360, 5, {
      droppedFrames: 10,
    });
    const flags = collectAdaptiveValidityFlags("cpt", cp, { reachedMax: false });
    expect(flags).toContain("cpt_device_timing_problem");
  });

  it("flags RT variability unstable at session max", () => {
    const prev = cptCheckpoint(300, { rtVariability: 40 });
    const curr = cptCheckpoint(360, { rtVariability: 90 });
    const flags = collectAdaptiveValidityFlags("cpt", curr, {
      reachedMax: true,
      history: { checkpoints: [prev], lowConfidenceFlag: false },
    });
    expect(flags).toContain("cpt_rt_variability_unstable_at_session_max");
  });
});
