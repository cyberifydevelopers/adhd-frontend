/**
 * Age-based defaults for the main cognitive battery (product spec).
 * Bands align with “younger children” vs “older children / teens” vs adults.
 */

/** Inclusive upper bound (years) for the “younger children” column in the spec tables. */
export const MAIN_TEST_YOUNGER_CHILD_AGE_MAX = 11;

/**
 * Time estimation random target bounds (ms): younger 5–10 s; teens/adults 5–15 s.
 */
export function timeEstimationTargetDurationsMsFromAge(
  ageYears: number | null | undefined,
): readonly number[] {
  if (ageYears != null && Number.isFinite(ageYears) && ageYears <= MAIN_TEST_YOUNGER_CHILD_AGE_MAX) {
    return [5000, 10000];
  }
  return [5000, 15000];
}

/** Flanker: larger arrows for younger children (single row is already the layout). */
export function flankerLargeStimulusFromAge(ageYears: number | null | undefined): boolean {
  if (ageYears == null || !Number.isFinite(ageYears)) return false;
  return ageYears <= MAIN_TEST_YOUNGER_CHILD_AGE_MAX;
}
