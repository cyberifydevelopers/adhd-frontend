/**
 * Core IRT (Item Response Theory) engine — pure functions, zero dependencies.
 *
 * Implements 2PL model with EAP (Expected A Posteriori) estimation
 * via 41-point quadrature grid. All functions are synchronous and sub-millisecond.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Item bank entry — one difficulty level in a task's item bank. */
export type IRTItem = {
  id: string;
  /** IRT difficulty parameter (logit scale, typically -3 to +3) */
  difficulty: number;
  /** IRT discrimination parameter (slope, typically 0.5 to 2.5) */
  discrimination: number;
  /** Task-specific trial parameters this item maps to */
  params: Record<string, unknown>;
  /** Whether this item has been administered in the current block */
  administered: boolean;
};

/** Running IRT state for one block of a task. */
export type IRTState = {
  /** Current ability estimate (logit scale) */
  theta: number;
  /** Standard error of theta */
  seTh: number;
  /** Prior distribution: { mean, sd } */
  prior: { mean: number; sd: number };
  /** All responses in this block */
  responses: IRTResponse[];
  /** Set of administered item IDs (for item selection) */
  administeredItemIds: Set<string>;
};

/** A single binary response to an IRT item. */
export type IRTResponse = {
  itemId: string;
  difficulty: number;
  discrimination: number;
  /** Binary score: 1 = correct/fast, 0 = incorrect/slow */
  score: number;
};

/* ------------------------------------------------------------------ */
/*  2PL Model Functions                                                */
/* ------------------------------------------------------------------ */

/** 2PL item response probability: P(X=1 | theta, a, b) */
export function prob2PL(theta: number, a: number, b: number): number {
  return 1 / (1 + Math.exp(-a * (theta - b)));
}

/** Fisher information at theta for a 2PL item: a² * P * (1-P) */
export function fisherInfo(theta: number, a: number, b: number): number {
  const p = prob2PL(theta, a, b);
  return a * a * p * (1 - p);
}

/* ------------------------------------------------------------------ */
/*  EAP Estimation (41-point quadrature)                               */
/* ------------------------------------------------------------------ */

const QUAD_POINTS = 41;
const QUAD_MIN = -4;
const QUAD_MAX = 4;
const QUAD_STEP = (QUAD_MAX - QUAD_MIN) / (QUAD_POINTS - 1);

/** Precomputed quadrature grid points */
const QUAD_GRID: number[] = Array.from(
  { length: QUAD_POINTS },
  (_, i) => QUAD_MIN + i * QUAD_STEP,
);

/**
 * Compute Expected A Posteriori (EAP) theta estimate and its SE.
 * Uses 41-point Gaussian quadrature over [-4, +4].
 *
 * O(41 × responses.length) — ~2500 multiplications for 60 trials.
 */
export function computeEAP(
  responses: IRTResponse[],
  prior: { mean: number; sd: number },
): { theta: number; se: number } {
  const priorVar = prior.sd * prior.sd;

  let sumWeightedTheta = 0;
  let sumWeightedThetaSq = 0;
  let sumWeights = 0;

  for (let i = 0; i < QUAD_POINTS; i++) {
    const q = QUAD_GRID[i];

    // Log-prior (normal distribution)
    const logPrior = -0.5 * ((q - prior.mean) ** 2) / priorVar;

    // Log-likelihood across all responses
    let logLik = 0;
    for (let r = 0; r < responses.length; r++) {
      const resp = responses[r];
      const p = prob2PL(q, resp.discrimination, resp.difficulty);
      // Clamp to avoid log(0)
      const pClamped = Math.max(1e-10, Math.min(1 - 1e-10, p));
      logLik += resp.score === 1
        ? Math.log(pClamped)
        : Math.log(1 - pClamped);
    }

    // Unnormalized posterior weight (in log space, then exponentiate)
    const logWeight = logPrior + logLik;
    const weight = Math.exp(logWeight);

    sumWeightedTheta += weight * q;
    sumWeightedThetaSq += weight * q * q;
    sumWeights += weight;
  }

  if (sumWeights === 0) {
    return { theta: prior.mean, se: prior.sd };
  }

  const theta = sumWeightedTheta / sumWeights;
  const variance = sumWeightedThetaSq / sumWeights - theta * theta;
  const se = Math.sqrt(Math.max(0, variance));

  return { theta, se };
}

/* ------------------------------------------------------------------ */
/*  Item Selection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Select the next item with maximum Fisher information at current theta.
 * If all items have been administered, resets the administered set.
 */
export function selectNextItem(
  bank: IRTItem[],
  theta: number,
  administeredIds: Set<string>,
): IRTItem {
  // Filter to unadministered items
  let candidates = bank.filter((item) => !administeredIds.has(item.id));

  // If exhausted, reset — allow re-administration
  if (candidates.length === 0) {
    administeredIds.clear();
    candidates = bank;
  }

  // Pick item with max Fisher information at current theta
  let bestItem = candidates[0];
  let bestInfo = -Infinity;

  for (const item of candidates) {
    const info = fisherInfo(theta, item.discrimination, item.difficulty);
    if (info > bestInfo) {
      bestInfo = info;
      bestItem = item;
    }
  }

  return bestItem;
}

/* ------------------------------------------------------------------ */
/*  State Management                                                   */
/* ------------------------------------------------------------------ */

/** Create a fresh IRT state for a new block. */
export function createIRTState(priorMean = 0, priorSD = 1): IRTState {
  return {
    theta: priorMean,
    seTh: priorSD,
    prior: { mean: priorMean, sd: priorSD },
    responses: [],
    administeredItemIds: new Set(),
  };
}

/**
 * Record a response, recompute EAP, return updated state.
 * Immutable — returns a new IRTState object.
 */
export function updateIRTState(
  state: IRTState,
  itemId: string,
  difficulty: number,
  discrimination: number,
  score: number,
): IRTState {
  const response: IRTResponse = { itemId, difficulty, discrimination, score };
  const responses = [...state.responses, response];
  const administeredItemIds = new Set(state.administeredItemIds);
  administeredItemIds.add(itemId);

  const { theta, se } = computeEAP(responses, state.prior);

  return {
    theta,
    seTh: se,
    prior: state.prior,
    responses,
    administeredItemIds,
  };
}
