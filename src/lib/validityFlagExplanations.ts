/** Plain-language explanations for validity flag identifiers (spec dashboard). */

const FLAG_EXPLANATIONS: Record<string, string> = {
  cross_simple_choice_rt_median_inconsistent:
    "Simple and choice reaction times differ more than expected — check engagement or device timing.",
  cross_multiple_tasks_low_confidence:
    "Several tasks ended with low-confidence stopping rules — overall effort or understanding may be reduced.",
  cross_anticipatory_pattern_multiple_tasks:
    "Very fast responses appeared on multiple tasks — may reflect anticipatory responding rather than stimulus-driven reactions.",
  cross_disengagement_multiple_tasks:
    "High omission or missed-response patterns appeared on multiple tasks — may reflect disengagement.",
  cross_practice_failure_with_low_accuracy:
    "Practice was not passed and scored accuracy is low — task instructions may not have been understood.",
  cross_session_random_responding_pattern:
    "Reaction times look unusually uniform — random or non-stimulus-driven responding is suspected.",
  cross_sst_inhibition_validity_concern:
    "Stop-signal inhibition metrics look unreliable — stop success rate or SSRT may not be interpretable.",
  cross_practice_pass_with_performance_collapse:
    "Practice blocks were passed but scored performance collapsed on multiple tasks — may reflect disengagement after instructions.",
  cross_flanker_implausible_congruent_slower_than_incongruent:
    "Flanker congruent trials were much slower than incongruent trials — an implausible easy-vs-hard pattern.",
  cross_flanker_implausible_negative_interference:
    "Flanker interference cost was strongly negative — incongruent performance was implausibly faster than congruent.",
  cross_task_switching_implausible_negative_switch_cost:
    "Task-switching switch trials were much faster than repeat trials — an implausible easy-vs-hard pattern.",
  cross_wm_implausible_distractor_better_than_clean:
    "Working-memory performance was implausibly better with distraction than without — check engagement or understanding.",
  practice_not_passed:
    "The practice block was not passed — the participant may not have understood the task before main testing.",
  low_confidence_stop:
    "The adaptive engine stopped with low confidence — performance was unstable or criteria were not met.",
  srt_anticipatory_rate_gt_5pct:
    "More than 5% of simple reaction times were faster than 100 ms — anticipatory responding.",
  srt_omission_rate_gt_15pct:
    "Many simple RT trials had no response — possible inattention or disengagement.",
  srt_rt_median_or_variability_unstable_at_session_max:
    "Reaction time was still unstable when the session reached maximum length.",
  srt_device_timing_jitter_flag:
    "Device timing jitter was detected on simple RT — technical quality concern.",
  crt_anticipatory_rate_gt_5pct:
    "More than 5% of choice RT responses were anticipatory (<100 ms).",
  crt_side_bias_gt_80pct:
    "Responses favored one side more than 80% of the time — possible response bias.",
  crt_accuracy_below_70pct:
    "Choice RT accuracy was below 70% — may reflect misunderstanding or low effort.",
  crt_rt_variability_unstable_at_max:
    "Choice RT median or variability remained unstable when the session reached maximum length.",
  flanker_accuracy_below_70pct:
    "Flanker accuracy was below 70% — may reflect misunderstanding or low effort.",
  flanker_response_bias_gt_80pct:
    "Flanker responses favored one key more than 80% of the time — possible response bias.",
  flanker_interference_unstable_at_session_max:
    "Flanker interference cost was still unstable when the session reached maximum length.",
  max_trials_reached_without_stability:
    "The task reached its maximum trial limit before stable stopping criteria were met.",
  min_trials_not_met:
    "Minimum trial requirements were not met before evaluation — data may be incomplete.",
  min_trials_met:
    "Minimum trial requirements were met for this task.",
  cpt_anticipatory_rate_gt_5pct:
    "Many CPT responses were faster than expected — anticipatory responding.",
  cpt_omission_rate_gt_40pct_suggesting_disengagement:
    "High omission rate on CPT targets — possible disengagement or inattention.",
  cpt_rt_variability_unstable_at_session_max:
    "CPT reaction-time variability remained unstable at session maximum.",
  cpt_device_timing_problem:
    "Device timing issues were detected during CPT.",
  sst_stop_success_rate_outside_03_07:
    "Overall stop success rate was outside the reliable 30–70% range.",
  sst_recent_stop_success_outside_03_07:
    "Recent stop trials had success rate outside the reliable range.",
  sst_waiting_strategy_go_rt_increase_gt_25pct:
    "Go reaction times increased substantially — possible waiting strategy on stop trials.",
  sst_ssrt_cannot_compute_reliably:
    "SSRT could not be estimated reliably from the available stop trials.",
  sst_ssd_stuck_trigger_failures:
    "Stop-signal delay adaptation appeared stuck at floor or ceiling.",
  delay_discounting_choice_consistency_below_70pct:
    "Delay discounting choices were inconsistent across similar trials.",
  delay_discounting_same_side_selection_gt_90pct:
    "Nearly all choices were on the same side — possible side bias or misunderstanding.",
  delay_discounting_extremely_fast_responses_majority:
    "Most delay-discounting choices were extremely fast — may not reflect deliberate decisions.",
  delay_discounting_now_vs_later_misunderstanding_suspected:
    "Response pattern suggests possible misunderstanding of now vs later choices.",
  set_shifting_max_trials_reached_without_criterion:
    "Set-shifting reached maximum trials without meeting learning criteria — low-confidence path.",
  set_shifting_random_responding_suspected:
    "Set-shifting accuracy and/or speed suggest random responding.",
  set_shifting_failure_to_learn_initial_rule:
    "Initial sorting rule was not learned by session end.",
  set_shifting_perseverative_errors_after_rule_change:
    "Errors persisted immediately after a rule change — perseveration concern.",
  wm_distractor_prevents_understanding:
    "Working-memory performance suggests distractor instructions may not have been understood.",
  wm_early_input_before_stimulus_ends:
    "Responses were entered before the encoding window ended.",
  time_estimation_possible_misunderstanding:
    "Time estimation pattern suggests possible task misunderstanding.",
  sst_stop_trials_below_50_at_session_max:
    "Stop trials were still below the minimum for stable estimation when the session reached maximum length.",
  sst_recent_stop_window_must_be_last_25:
    "The recent stop-trial window was not the final 25 stop trials — SSRT estimates may be unstable.",
  sst_go_accuracy_below_80pct:
    "Go-trial accuracy was below 80% or go omissions were high — stop-signal metrics may be unreliable.",
  task_switching_accuracy_below_70pct:
    "Task-switching accuracy was below 70% — may reflect misunderstanding or low effort.",
  task_switching_too_few_switch_trials:
    "Too few switch trials were completed for a reliable switch-cost estimate.",
  task_switching_too_few_repeat_trials:
    "Too few repeat trials were completed for a reliable switch-cost estimate.",
  task_switching_rule_confusion_pattern:
    "Response pattern suggests confusion about which rule applied on each trial.",
  task_switching_switch_cost_unstable_at_session_max:
    "Switch cost remained unstable when the session reached maximum length.",
  psychomotor_anticipatory_rate_gt_5pct:
    "More than 5% of psychomotor responses were anticipatory (<100 ms).",
  psychomotor_motor_impairment_noted:
    "Motor performance pattern suggests possible motor impairment or misunderstanding of the tapping task.",
  psychomotor_rt_variability_unstable_at_session_max:
    "Psychomotor reaction time remained unstable when the session reached maximum length.",
  digit_span_sequence_entry_before_digits_cleared:
    "Responses were entered before the digit sequence finished presenting.",
  digit_span_repeated_invalid_input:
    "Repeated invalid digit-span entries were detected — possible misunderstanding of input rules.",
  digit_span_floor_performance_after_practice:
    "Digit-span performance stayed at floor levels after practice — low-confidence data.",
  digit_span_high_distraction_failed_starting_span:
    "Performance failed at the starting span under distraction — possible attention or understanding concern.",
  wm_floor_performance_after_practice:
    "Working-memory performance stayed at floor after practice — low-confidence data.",
  wm_inconsistent_performance_at_max_sequences:
    "Working-memory performance remained inconsistent when maximum sequences were reached.",
  substance_dd_distress_reported:
    "Distress was reported during substance delay-discounting — interpret choices in that context.",
  substance_dd_min_cell_trials_below_3:
    "Substance delay-discounting had too few trials in one or more choice cells.",
  substance_dd_choice_consistency_below_70pct:
    "Substance delay-discounting choices were inconsistent across similar trials.",
  substance_dd_extremely_fast_responses_majority:
    "Most substance delay-discounting choices were extremely fast — may not reflect deliberate decisions.",
  substance_dd_same_side_selection_gt_90pct:
    "Nearly all substance delay-discounting choices were on the same side — possible bias or misunderstanding.",
  time_estimation_distractor_min_trials_per_duration_condition_not_met:
    "Time estimation did not reach minimum trials per duration condition when distraction was used.",
  time_estimation_immediate_reproduction_after_start:
    "Reproduction began immediately after interval start — possible anticipatory responding.",
  time_estimation_adjacent_same_duration_schedule_repair:
    "Adjacent trials with the same duration were scheduled back-to-back — timing estimates may be biased.",
  time_estimation_extreme_variability_at_max_trials:
    "Timing variability was extreme when maximum trials were reached.",
  set_shifting_perseverative_pattern_established:
    "A perseverative error pattern was established on set-shifting — rule change was not adopted.",
  cpt_too_few_target_trials:
    "CPT reached session maximum with too few target trials for stable attention metrics.",
  delay_discounting_min_cell_trials_below_3:
    "Delay discounting had too few trials in one or more choice cells for stable inference.",
};

const CROSS_TEST_EXPLANATIONS: Record<string, string> = {
  cross_simple_choice_rt_median_inconsistent: FLAG_EXPLANATIONS.cross_simple_choice_rt_median_inconsistent,
  cross_multiple_tasks_low_confidence: FLAG_EXPLANATIONS.cross_multiple_tasks_low_confidence,
  cross_anticipatory_pattern_multiple_tasks: FLAG_EXPLANATIONS.cross_anticipatory_pattern_multiple_tasks,
  cross_disengagement_multiple_tasks: FLAG_EXPLANATIONS.cross_disengagement_multiple_tasks,
  cross_practice_failure_with_low_accuracy: FLAG_EXPLANATIONS.cross_practice_failure_with_low_accuracy,
  cross_session_random_responding_pattern: FLAG_EXPLANATIONS.cross_session_random_responding_pattern,
  cross_sst_inhibition_validity_concern: FLAG_EXPLANATIONS.cross_sst_inhibition_validity_concern,
  cross_practice_pass_with_performance_collapse:
    FLAG_EXPLANATIONS.cross_practice_pass_with_performance_collapse,
  cross_flanker_implausible_congruent_slower_than_incongruent:
    FLAG_EXPLANATIONS.cross_flanker_implausible_congruent_slower_than_incongruent,
  cross_flanker_implausible_negative_interference:
    FLAG_EXPLANATIONS.cross_flanker_implausible_negative_interference,
  cross_task_switching_implausible_negative_switch_cost:
    FLAG_EXPLANATIONS.cross_task_switching_implausible_negative_switch_cost,
  cross_wm_implausible_distractor_better_than_clean:
    FLAG_EXPLANATIONS.cross_wm_implausible_distractor_better_than_clean,
};

/** Task-specific flag id prefixes stripped when the task name is shown separately. */
const TASK_FLAG_PREFIX: Record<string, string> = {
  cpt: "cpt_",
  sst: "sst_",
  simple_rt: "srt_",
  choice_rt: "crt_",
  flanker: "flanker_",
  task_switching: "task_switching_",
  psychomotor_speed: "psychomotor_",
  set_shifting_mini: "set_shifting_",
  wm_distraction: "wm_",
  digit_span: "digit_span_",
  delay_discounting: "delay_discounting_",
  substance_dd: "substance_dd_",
  time_estimation: "time_estimation_",
};

const FLAG_SHORT_TITLES: Record<string, string> = {
  low_confidence_stop: "Low-confidence stopping",
  technical_issue: "Technical quality issue",
  practice_not_passed: "Practice not passed",
  cross_sst_inhibition_validity_concern: "Stop-signal inhibition concern (across tasks)",
  cross_multiple_tasks_low_confidence: "Low confidence on multiple tasks",
  cross_session_random_responding_pattern: "Random responding pattern (session-wide)",
  cross_disengagement_multiple_tasks: "Disengagement across multiple tasks",
  cross_anticipatory_pattern_multiple_tasks: "Anticipatory responding across tasks",
  cross_simple_choice_rt_median_inconsistent: "Simple vs choice RT mismatch",
  cpt_rt_variability_unstable_at_session_max: "Unstable reaction time at session maximum",
  sst_stop_success_rate_outside_03_07: "Stop success rate outside 30–70%",
  sst_recent_stop_success_outside_03_07: "Recent stop success outside 30–70%",
  sst_ssd_stuck_trigger_failures: "Stop-signal delay stuck at floor or ceiling",
  srt_anticipatory_rate_gt_5pct: "Anticipatory responses >5%",
  psychomotor_omission_rate_gt_20pct: "High omission rate (>20%)",
  task_switching_accuracy_below_70pct: "Accuracy below 70%",
  digit_span_floor_performance_after_practice: "Floor performance after practice",
  wm_inconsistent_performance_at_max_sequences: "Inconsistent at max sequences",
  set_shifting_perseverative_pattern_established: "Perseverative pattern established",
  cpt_too_few_target_trials: "Too few target trials",
  delay_discounting_min_cell_trials_below_3: "Too few trials per choice cell",
};

function humanizeFlagId(flag: string): string {
  return flag
    .replace(/_gt_/g, " > ")
    .replace(/_lt_/g, " < ")
    .replace(/03_07/g, "30–70%")
    .replace(/05pct/g, "5%")
    .replace(/20pct/g, "20%")
    .replace(/40pct/g, "40%")
    .replace(/70pct/g, "70%")
    .replace(/80pct/g, "80%")
    .replace(/90pct/g, "90%")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Short label for UI/PDF — avoids repeating task name in the flag id (e.g. "CPT: cpt …"). */
export function validityFlagTitle(flag: string, taskName?: string): string {
  if (FLAG_SHORT_TITLES[flag]) return FLAG_SHORT_TITLES[flag];

  let id = flag;
  if (taskName) {
    const prefix = TASK_FLAG_PREFIX[taskName];
    if (prefix && id.startsWith(prefix)) {
      id = id.slice(prefix.length);
    } else if (id.startsWith(`${taskName}_`)) {
      id = id.slice(taskName.length + 1);
    }
  }

  return humanizeFlagId(id);
}

export function explainValidityFlag(flag: string): string {
  if (FLAG_EXPLANATIONS[flag]) return FLAG_EXPLANATIONS[flag];
  if (CROSS_TEST_EXPLANATIONS[flag]) return CROSS_TEST_EXPLANATIONS[flag];

  const lower = flag.toLowerCase();
  if (lower.includes("anticipatory")) {
    return "A high rate of very fast responses was detected — may reflect responding before fully processing the stimulus.";
  }
  if (lower.includes("omission")) {
    return "Many trials had no response — may reflect inattention or disengagement.";
  }
  if (lower.includes("random_responding")) {
    return "Response pattern is consistent with random or non-deliberate responding.";
  }
  if (lower.includes("side_bias") || lower.includes("same_side")) {
    return "Responses were heavily biased toward one option or side.";
  }
  if (lower.includes("device_timing") || lower.includes("timing")) {
    return "A device or timing quality issue may have affected measurement precision.";
  }
  if (lower.includes("unstable") || lower.includes("without_criterion")) {
    return "Performance remained unstable when the task reached its maximum length.";
  }
  if (lower.includes("misunderstanding")) {
    return "The response pattern suggests the task may not have been fully understood.";
  }
  if (lower.includes("practice")) {
    return "Practice performance did not meet the pass criteria before main testing.";
  }

  return flag.replace(/_/g, " ");
}

export const VALIDITY_IRB_DISCLAIMER =
  "The assessment includes embedded performance-validity and data-quality indicators. These indicators are used to identify potentially unreliable data resulting from misunderstanding, disengagement, response bias, random responding, or technical issues. Results are classified according to confidence and validity criteria and are not used to determine whether a participant is intentionally misrepresenting performance.";

/** Plain-language intro for patient-facing PDFs and reports. */
export const VALIDITY_PDF_INTRO =
  "Your assessment automatically checks whether responses look attentive, consistent, and technically sound. This helps you and your clinician decide how much confidence to place in the results below.";

export function friendlyValidityInterpretation(
  classification: string | null | undefined,
  score: number | null | undefined,
): string {
  switch (classification) {
    case "valid":
      return "Your response patterns look generally reliable. These results can be interpreted with good confidence.";
    case "borderline_valid":
      return "Most of your data looks acceptable, but a few patterns were flagged for review. Discuss these results with your clinician.";
    case "low_confidence":
      return "Several data-quality indicators raised concerns. Please interpret these results cautiously and review them with a clinician.";
    case "invalid":
      return "Significant data-quality concerns were detected. These results may not be reliable enough for clinical interpretation on their own.";
    default:
      if (score != null && score >= 75) {
        return "Your data-quality score is in a good range. Results appear suitable for interpretation.";
      }
      if (score != null && score >= 60) {
        return "Your data-quality score suggests some caution is warranted when interpreting results.";
      }
      return "Review the details below to understand how much confidence to place in these results.";
  }
}

export const VALIDITY_STATUS_PDF_LABEL: Record<string, string> = {
  good: "Looks good",
  review: "Worth reviewing",
  concern: "Needs attention",
  unknown: "Not available",
};
