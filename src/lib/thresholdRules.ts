export const PASS_THRESHOLD = 0.8;

function computeAccuracy(correct: number, total: number): number {
  if (total <= 0) return 0;
  return correct / total;
}

export function shouldStopEarlyAtPass(correct: number, completed: number, maxTrials: number): boolean {
  const maxRounds = Math.max(1, maxTrials);
  if (completed >= maxRounds) return true;
  return computeAccuracy(correct, completed) >= PASS_THRESHOLD;
}

