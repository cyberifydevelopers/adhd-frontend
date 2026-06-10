import type { QcDisplayData } from "@/components/admin/qcValidityUi";
import { explainValidityFlag } from "@/lib/validityFlagExplanations";

export type ValidityStatusLevel = "good" | "review" | "concern" | "unknown";

export type ValidityStatusTile = {
  id: string;
  label: string;
  level: ValidityStatusLevel;
  summary: string;
};

export type ExplainedValidityFlag = {
  id: string;
  source: "task" | "cross_test" | "session";
  taskName?: string;
  explanation: string;
};

function allTaskFlags(qc: QcDisplayData): string[] {
  const flags: string[] = [];
  const byTask = qc.task_validity_flags ?? {};
  for (const taskFlags of Object.values(byTask)) {
    for (const f of taskFlags) {
      if (!flags.includes(f)) flags.push(f);
    }
  }
  return flags;
}

function hasMisunderstandingFlag(flags: string[]): boolean {
  return flags.some(
    (f) =>
      f.includes("misunderstanding") ||
      f.includes("distractor_prevents") ||
      f.includes("now_vs_later") ||
      f.includes("failure_to_learn"),
  );
}

function hasOmissionOrDisengagement(flags: string[], qc: QcDisplayData): boolean {
  if (flags.some((f) => f.includes("omission") || f.includes("disengagement"))) return true;
  const dis = qc.flags?.disengagement as { omission_run_detected?: boolean } | undefined;
  return Boolean(dis?.omission_run_detected);
}

function hasAnticipatory(flags: string[], qc: QcDisplayData): boolean {
  if (flags.some((f) => f.includes("anticipatory"))) return true;
  return (qc.flags?.anticipatory_rt_count ?? 0) > 0;
}

function hasRandomResponding(flags: string[], qc: QcDisplayData): boolean {
  if (flags.some((f) => f.includes("random_responding"))) return true;
  const rr = qc.flags?.random_responding as { flagged?: boolean } | undefined;
  return Boolean(rr?.flagged);
}

function hasConsistencyConcern(flags: string[], qc: QcDisplayData): boolean {
  if (
    flags.some(
      (f) =>
        f.includes("consistency") ||
        f.includes("side_bias") ||
        f.includes("same_side") ||
        f.includes("dominant"),
    )
  ) {
    return true;
  }
  const cross = qc.cross_test_flags ?? [];
  return cross.some(
    (f) =>
      f.includes("inconsistent") ||
      f.includes("side") ||
      f.includes("consistency"),
  );
}

function tile(
  id: string,
  label: string,
  level: ValidityStatusLevel,
  summary: string,
): ValidityStatusTile {
  return { id, label, level, summary };
}

export function buildValidityStatusTiles(qc: QcDisplayData): ValidityStatusTile[] {
  const taskFlags = allTaskFlags(qc);
  const cross = qc.cross_test_flags ?? [];

  let taskUnderstanding: ValidityStatusTile;
  if (qc.practice_passed == null && !hasMisunderstandingFlag(taskFlags)) {
    taskUnderstanding = tile(
      "task_understanding",
      "Task understanding",
      "unknown",
      "Practice and instruction checks were not available for this assessment.",
    );
  } else if (qc.practice_passed === false || hasMisunderstandingFlag(taskFlags)) {
    taskUnderstanding = tile(
      "task_understanding",
      "Task understanding",
      "concern",
      "Practice and/or response patterns suggest possible misunderstanding of one or more tasks.",
    );
  } else if (qc.practice_passed === true) {
    taskUnderstanding = tile(
      "task_understanding",
      "Task understanding",
      "good",
      "Practice blocks were passed — task instructions appear to have been followed.",
    );
  } else {
    taskUnderstanding = tile(
      "task_understanding",
      "Task understanding",
      "review",
      "Practice passed, but review task-level flags for any instruction concerns.",
    );
  }

  let responseConsistency: ValidityStatusTile;
  if (hasConsistencyConcern(taskFlags, qc) || cross.some((f) => f.includes("inconsistent"))) {
    responseConsistency = tile(
      "response_consistency",
      "Response consistency",
      "concern",
      "Cross-task or within-task patterns suggest inconsistent responding.",
    );
  } else if (cross.length > 0) {
    responseConsistency = tile(
      "response_consistency",
      "Response consistency",
      "review",
      "Some cross-task patterns were flagged — review details below.",
    );
  } else {
    responseConsistency = tile(
      "response_consistency",
      "Response consistency",
      "good",
      "No major cross-task inconsistency patterns were detected.",
    );
  }

  let attentionCheck: ValidityStatusTile;
  if (hasOmissionOrDisengagement(taskFlags, qc) || hasAnticipatory(taskFlags, qc)) {
    attentionCheck = tile(
      "attention_check",
      "Attention check",
      "concern",
      "Omissions, disengagement, or anticipatory responding were detected.",
    );
  } else if (qc.low_confidence_flag) {
    attentionCheck = tile(
      "attention_check",
      "Attention check",
      "review",
      "Low-confidence adaptive stopping — sustained attention may have varied.",
    );
  } else {
    attentionCheck = tile(
      "attention_check",
      "Attention check",
      "good",
      "No strong omission or anticipatory-response concerns were detected.",
    );
  }

  let randomResponding: ValidityStatusTile;
  if (hasRandomResponding(taskFlags, qc)) {
    randomResponding = tile(
      "random_responding",
      "Random responding",
      "concern",
      "Response timing or accuracy patterns are consistent with random responding.",
    );
  } else {
    randomResponding = tile(
      "random_responding",
      "Random responding",
      "good",
      "No random-responding pattern was detected.",
    );
  }

  let technicalQuality: ValidityStatusTile;
  if (qc.technical_issue_flag) {
    technicalQuality = tile(
      "technical_quality",
      "Technical quality",
      "concern",
      "Device timing or dropped-frame issues may have affected measurement quality.",
    );
  } else if (
    taskFlags.some((f) => f.includes("device_timing") || f.includes("timing_problem"))
  ) {
    technicalQuality = tile(
      "technical_quality",
      "Technical quality",
      "review",
      "Minor timing-quality flags were recorded on one or more tasks.",
    );
  } else {
    technicalQuality = tile(
      "technical_quality",
      "Technical quality",
      "good",
      "No significant technical quality issues were detected.",
    );
  }

  return [taskUnderstanding, responseConsistency, attentionCheck, randomResponding, technicalQuality];
}

function isRedundantCrossFlag(flag: string, taskFlags: Record<string, string[]>): boolean {
  const allTaskFlags = Object.values(taskFlags).flat();

  if (flag === "cross_sst_inhibition_validity_concern") {
    const sstFlags = taskFlags.sst ?? [];
    return sstFlags.some((f) =>
      ["stop_success", "ssrt", "ssd_stuck", "waiting_strategy"].some((m) => f.includes(m)),
    );
  }

  if (flag === "cross_multiple_tasks_low_confidence") {
    const lowConfTasks = Object.values(taskFlags).filter((flags) => flags.includes("low_confidence_stop"));
    return lowConfTasks.length >= 2;
  }

  if (flag === "cross_session_random_responding_pattern") {
    return allTaskFlags.some((f) => f.includes("random_responding"));
  }

  if (flag === "cross_disengagement_multiple_tasks") {
    return allTaskFlags.filter((f) => f.includes("omission") || f.includes("disengagement")).length >= 2;
  }

  if (flag === "cross_anticipatory_pattern_multiple_tasks") {
    return allTaskFlags.filter((f) => f.includes("anticipatory")).length >= 2;
  }

  return false;
}

export function collectExplainedFlags(qc: QcDisplayData): ExplainedValidityFlag[] {
  const out: ExplainedValidityFlag[] = [];
  const seen = new Set<string>();
  const taskFlags = qc.task_validity_flags ?? {};
  const allTaskFlagIds = new Set(Object.values(taskFlags).flat());

  const push = (id: string, source: ExplainedValidityFlag["source"], explanation: string, taskName?: string) => {
    const key = `${source}:${taskName ?? ""}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, source, taskName, explanation });
  };

  for (const [task, flags] of Object.entries(taskFlags)) {
    for (const flag of flags) {
      push(flag, "task", explainValidityFlag(flag), task);
    }
  }

  for (const flag of qc.cross_test_flags ?? []) {
    if (isRedundantCrossFlag(flag, taskFlags)) continue;
    push(flag, "cross_test", explainValidityFlag(flag));
  }

  if (qc.practice_passed === false && !allTaskFlagIds.has("practice_not_passed")) {
    push("practice_not_passed", "session", explainValidityFlag("practice_not_passed"));
  }
  if (qc.low_confidence_flag && !allTaskFlagIds.has("low_confidence_stop")) {
    push("low_confidence_stop", "session", explainValidityFlag("low_confidence_stop"));
  }
  if (qc.technical_issue_flag && !allTaskFlagIds.has("technical_issue")) {
    const hasDeviceTaskFlag = [...allTaskFlagIds].some(
      (f) => f.includes("device_timing") || f.includes("timing_problem") || f.includes("timing_jitter"),
    );
    if (!hasDeviceTaskFlag) {
      push(
        "technical_issue",
        "session",
        "Device timing or frame-drop issues may have reduced measurement precision.",
      );
    }
  }

  const rr = qc.flags?.random_responding as { flagged?: boolean } | undefined;
  if (rr?.flagged && !allTaskFlagIds.has("session_random_responding")) {
    const alreadyCross = (qc.cross_test_flags ?? []).includes("cross_session_random_responding_pattern");
    if (!alreadyCross) {
      push("session_random_responding", "session", explainValidityFlag("cross_session_random_responding_pattern"));
    }
  }

  return out;
}

