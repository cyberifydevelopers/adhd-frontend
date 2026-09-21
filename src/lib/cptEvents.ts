/** Read the scored response category the CPT store stamps on each trial event (`extra_data.response_type`). */
export function cptResponseType(ev: Record<string, unknown>): string | undefined {
  const extra = ev.extra_data as { response_type?: unknown } | null | undefined;
  return typeof extra?.response_type === "string" ? extra.response_type : undefined;
}

/**
 * Press before stimulus onset or within 100 ms of it. Recorded with an RT so target trials are not
 * mistaken for omissions, so non-target trials must exclude these from commission counts.
 */
export function isCptAnticipatory(ev: Record<string, unknown>): boolean {
  return cptResponseType(ev) === "anticipatory";
}
