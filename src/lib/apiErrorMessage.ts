/** User-facing message for API failures (e.g. stale session → 404). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const ax = err as { response?: { status?: number; data?: { detail?: string } } };
  if (ax.response?.status === 404) {
    return "Session not found. Please return to the dashboard and start the task again.";
  }
  const detail = ax.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return err instanceof Error ? err.message : fallback;
}
