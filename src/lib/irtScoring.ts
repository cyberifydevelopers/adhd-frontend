/**
 * Per-task IRT response dichotomization — converts raw trial events
 * into binary 0/1 scores for IRT ability estimation.
 */

export function scoreFlanker(ev: Record<string, unknown>): number {
  if (ev.is_correct !== true) return 0;
  const rt = ev.reaction_time_ms as number | null | undefined;
  if (rt != null && rt < 100) return 0;
  return 1;
}

export function scoreCPT(ev: Record<string, unknown>): number {
  return ev.is_correct === true ? 1 : 0;
}

export function scoreTaskSwitching(ev: Record<string, unknown>): number {
  if (ev.is_correct !== true) return 0;
  const rt = ev.reaction_time_ms as number | null | undefined;
  if (rt != null && rt < 100) return 0;
  return 1;
}
