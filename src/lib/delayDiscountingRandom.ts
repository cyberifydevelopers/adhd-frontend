/** Random session draws for delay-discounting tasks (staircase flow unchanged). */

export type DelayDiscountingConfigLike = {
  delayed_amount?: unknown;
  delay_days?: unknown;
  staircase_step?: unknown;
  initial_immediate?: unknown;
};

export type DelayDiscountingSessionParams = {
  delayedAmount: number;
  delayDays: number;
  initialImmediate: number;
  staircaseStep: number;
  minImmediate: number;
  maxImmediate: number;
};

export const DEFAULT_DELAYED_AMOUNT = 100;
export const DEFAULT_DELAY_DAYS = 30;
export const DEFAULT_INITIAL_IMMEDIATE = 50;
export const DEFAULT_MIN_IMMEDIATE = 5;

const DELAYED_AMOUNT_RANGE = { min: 80, max: 120 } as const;
const DELAY_DAYS_OPTIONS = [14, 21, 28, 30, 45, 60] as const;

function randomInt(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function finitePositiveInt(value: unknown): number | null {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function clampImmediateAmount(
  amount: number,
  minImmediate: number,
  maxImmediate: number,
): number {
  return Math.max(minImmediate, Math.min(maxImmediate, Math.round(amount)));
}

export function immediateBoundsForDelayed(delayedAmount: number): {
  minImmediate: number;
  maxImmediate: number;
} {
  const minImmediate = DEFAULT_MIN_IMMEDIATE;
  const maxImmediate = Math.max(minImmediate + 5, delayedAmount - 5);
  return { minImmediate, maxImmediate };
}

/** Random starting offer between ~35% and ~65% of the delayed amount. */
export function randomInitialImmediate(
  delayedAmount: number,
  minImmediate: number,
  maxImmediate: number,
): number {
  const low = Math.max(minImmediate, Math.round(delayedAmount * 0.35));
  const high = Math.min(maxImmediate, Math.round(delayedAmount * 0.65));
  return randomInt(low, high);
}

/** Random step size scaled to the delayed amount (avoids only $25 multiples). */
export function randomStaircaseStep(delayedAmount: number): number {
  const minStep = Math.max(5, Math.round(delayedAmount / 10));
  const maxStep = Math.max(minStep, Math.round(delayedAmount / 3));
  return randomInt(minStep, maxStep);
}

export function defaultDelayDiscountingSessionParams(): DelayDiscountingSessionParams {
  const delayedAmount = DEFAULT_DELAYED_AMOUNT;
  const { minImmediate, maxImmediate } = immediateBoundsForDelayed(delayedAmount);
  return {
    delayedAmount,
    delayDays: DEFAULT_DELAY_DAYS,
    initialImmediate: DEFAULT_INITIAL_IMMEDIATE,
    staircaseStep: Math.max(1, Math.round(delayedAmount / 4)),
    minImmediate,
    maxImmediate,
  };
}

/**
 * Resolve staircase session parameters. Explicit config values win; missing fields are drawn at random.
 */
export function resolveDelayDiscountingSessionParams(
  config?: DelayDiscountingConfigLike | null,
): DelayDiscountingSessionParams {
  const delayedAmount =
    finitePositiveInt(config?.delayed_amount) ?? randomInt(DELAYED_AMOUNT_RANGE.min, DELAYED_AMOUNT_RANGE.max);
  const delayDays = finitePositiveInt(config?.delay_days) ?? pickRandom(DELAY_DAYS_OPTIONS);
  const { minImmediate, maxImmediate } = immediateBoundsForDelayed(delayedAmount);

  const configuredInitial = finitePositiveInt(config?.initial_immediate);
  const initialImmediate =
    configuredInitial != null
      ? clampImmediateAmount(configuredInitial, minImmediate, maxImmediate)
      : randomInitialImmediate(delayedAmount, minImmediate, maxImmediate);

  const configuredStep = finitePositiveInt(config?.staircase_step);
  const staircaseStep =
    configuredStep != null ? Math.max(1, configuredStep) : randomStaircaseStep(delayedAmount);

  return {
    delayedAmount,
    delayDays,
    initialImmediate,
    staircaseStep,
    minImmediate,
    maxImmediate,
  };
}
