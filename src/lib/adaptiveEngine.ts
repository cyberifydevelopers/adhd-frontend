/**
 * Per-trial adaptive engine — pure functions, zero latency.
 *
 * Each task store calls `updatePerformanceModel` after every response event,
 * then uses the derived metrics to compute the next trial's parameters.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PerformanceModel = {
  recentEvents: Record<string, unknown>[];
  windowSize: number;
  // Derived (recomputed on each update)
  recentRTs: number[];
  meanRT: number;
  rtSD: number;
  rtCoV: number;
  accuracy: number;
  omissionRate: number;
  commissionRate: number;
  anticipatoryRate: number;
  conditionAccuracy: Record<string, number>;
  conditionMeanRT: Record<string, number>;
  totalTrials: number;
};

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createPerformanceModel(windowSize = 15): PerformanceModel {
  return {
    recentEvents: [],
    windowSize,
    recentRTs: [],
    meanRT: 0,
    rtSD: 0,
    rtCoV: 0,
    accuracy: 0,
    omissionRate: 0,
    commissionRate: 0,
    anticipatoryRate: 0,
    conditionAccuracy: {},
    conditionMeanRT: {},
    totalTrials: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Update (pure, O(windowSize))                                       */
/* ------------------------------------------------------------------ */

export function updatePerformanceModel(
  model: PerformanceModel,
  event: Record<string, unknown>,
): PerformanceModel {
  const next: PerformanceModel = { ...model };

  // Sliding window
  const updated = [...model.recentEvents, event];
  if (updated.length > model.windowSize) updated.splice(0, updated.length - model.windowSize);
  next.recentEvents = updated;
  next.totalTrials = model.totalTrials + 1;

  // RTs (exclude nulls)
  next.recentRTs = updated
    .map((e) => e.reaction_time_ms as number | null | undefined)
    .filter((rt): rt is number => rt != null && rt > 0);

  const rts = next.recentRTs;
  next.meanRT = rts.length > 0 ? rts.reduce((a, b) => a + b, 0) / rts.length : 0;
  next.rtSD =
    rts.length > 1
      ? Math.sqrt(rts.reduce((a, b) => a + (b - next.meanRT) ** 2, 0) / (rts.length - 1))
      : 0;
  next.rtCoV = next.meanRT > 0 ? next.rtSD / next.meanRT : 0;

  // Accuracy
  const total = updated.length;
  const correct = updated.filter((e) => e.is_correct === true).length;
  next.accuracy = total > 0 ? correct / total : 0;

  // Omission: expected_response but no keypress
  const expectedResponse = updated.filter(
    (e) => e.expected_response === true || e.correct_key != null,
  );
  const omissions = expectedResponse.filter((e) => e.reaction_time_ms == null);
  next.omissionRate = expectedResponse.length > 0 ? omissions.length / expectedResponse.length : 0;

  // Commission: no expected_response but pressed anyway
  const noExpected = updated.filter(
    (e) => e.expected_response === false || (e.correct_key == null && e.event_type !== "go"),
  );
  const commissions = noExpected.filter((e) => e.reaction_time_ms != null);
  next.commissionRate = noExpected.length > 0 ? commissions.length / noExpected.length : 0;

  // Anticipatory (RT < 100ms)
  const anticipatory = rts.filter((rt) => rt < 100);
  next.anticipatoryRate = rts.length > 0 ? anticipatory.length / rts.length : 0;

  // Per-condition accuracy & meanRT (keyed by event_type)
  const condAcc: Record<string, number> = {};
  const condRT: Record<string, number> = {};
  const byType: Record<string, Record<string, unknown>[]> = {};
  for (const e of updated) {
    const t = e.event_type as string | undefined;
    if (!t) continue;
    if (!byType[t]) byType[t] = [];
    byType[t].push(e);
  }
  for (const [type, evts] of Object.entries(byType)) {
    const c = evts.filter((e) => e.is_correct === true).length;
    condAcc[type] = evts.length > 0 ? c / evts.length : 0;
    const typeRTs = evts
      .map((e) => e.reaction_time_ms as number | null | undefined)
      .filter((rt): rt is number => rt != null && rt > 0);
    condRT[type] = typeRTs.length > 0 ? typeRTs.reduce((a, b) => a + b, 0) / typeRTs.length : 0;
  }
  next.conditionAccuracy = condAcc;
  next.conditionMeanRT = condRT;

  return next;
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Weighted random pick from items array. Weights need not sum to 1. */
export function weightedRandomPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
