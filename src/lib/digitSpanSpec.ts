/** Digit Span — clinical staircase spec (forward then backward, 2 trials/level + optional confirmation). */

export const DIGIT_SPAN_MAX_SEQUENCES = 24;
export const DIGIT_SPAN_SPAN_MIN = 2;
export const DIGIT_SPAN_SPAN_MAX = 9;

/** Why the main forward/backward battery ended (adaptive debug / reports). */
export type DigitSpanBatteryStopReason =
  | "backward_discontinue"
  | "backward_span_ceiling"
  | "sequence_budget";

/**
 * After two trials at a span: 0 correct → fail direction; ≥1 correct → advance (spec).
 */
export function digitSpanOutcomeAfterTwoTrials(correctCount: number): "fail" | "advance" {
  return correctCount >= 1 ? "advance" : "fail";
}

/** Recall window: fixed 15 s for every span (client feedback 09/30). */
export const DIGIT_SPAN_RECALL_MS = 15_000;

/**
 * Starting forward span by age (main digit span).
 * Under 8 → 2–3 (use 3 from age 6–7, 2 below 6) · 8–12 → 3 · teens/adults → 4.
 */
export function startingSpanFromAge(ageYears: number | null | undefined): number {
  if (ageYears == null || !Number.isFinite(ageYears)) return 4;
  if (ageYears < 6) return 2;
  if (ageYears < 8) return 3;
  if (ageYears <= 12) return 3;
  return 4;
}

export function ageFromIsoDateOfBirth(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}
