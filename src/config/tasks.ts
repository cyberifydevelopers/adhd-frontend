/** Master list of available cognitive tests - used for routing and admin assignment */
export const TASK_ROUTES: Record<string, string> = {
  cpt: "/user/tasks/cpt",
  sst: "/user/tasks/sst",
  digit_span: "/user/tasks/digit-span",
  time_estimation: "/user/tasks/time-estimation",
  simple_rt: "/user/tasks/simple-rt",
  choice_rt: "/user/tasks/choice-rt",
  flanker: "/user/tasks/flanker",
  task_switching: "/user/tasks/task-switching",
  delay_discounting: "/user/tasks/delay-discounting",
  psychomotor_speed: "/user/tasks/psychomotor-speed",
  set_shifting_mini: "/user/tasks/set-shifting-mini",
  wm_distraction: "/user/tasks/wm-distraction",
  substance_dd: "/user/tasks/substance-dd",
};

export const TASK_NAMES: Record<string, string> = {
  cpt: "CPT (Continuous Performance)",
  sst: "SST (Stop-Signal Task)",
  digit_span: "Digit Span",
  time_estimation: "Time Estimation",
  simple_rt: "Simple Reaction Time",
  choice_rt: "Choice Reaction Time",
  flanker: "Flanker Task",
  task_switching: "Task Switching",
  delay_discounting: "Delay Discounting",
  psychomotor_speed: "Psychomotor Speed",
  set_shifting_mini: "Set Shifting Mini",
  wm_distraction: "Working Memory Under Distraction",
  substance_dd: "Substance Delay Discounting",
};

const TASK_ALIASES: Record<string, string> = {
  cpt_continuous_performance: "cpt",
  continuous_performance_test: "cpt",
  sst_stop_signal_task: "sst",
  stop_signal_task: "sst",
  simple_reaction_time: "simple_rt",
  choice_reaction_time: "choice_rt",
  flanker_task: "flanker",
  set_shifting_mini_task: "set_shifting_mini",
  working_memory_under_distraction: "wm_distraction",
  substance_delay_discounting: "substance_dd",
};

function canonicalizeTaskName(normalized: string): string {
  if (TASK_ROUTES[normalized]) return normalized;
  if (TASK_ALIASES[normalized]) return TASK_ALIASES[normalized];

  const withoutSuffix = normalized
    .replace(/_(task|test|assessment)$/g, "")
    .replace(/_short$/g, "");
  if (TASK_ROUTES[withoutSuffix]) return withoutSuffix;
  if (TASK_ALIASES[withoutSuffix]) return TASK_ALIASES[withoutSuffix];

  // Handle common prefixed labels like "cpt_continuous_performance_test".
  if (withoutSuffix.startsWith("cpt_")) return "cpt";
  if (withoutSuffix.startsWith("sst_")) return "sst";

  return withoutSuffix;
}

function normalizeTaskName(testName: string): string {
  const normalized = testName
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return canonicalizeTaskName(normalized);
}

export function getTaskPath(testName: string): string | null {
  const normalized = normalizeTaskName(testName);
  return TASK_ROUTES[normalized] ?? null;
}

export function getTaskDisplayName(testName: string): string {
  const normalized = normalizeTaskName(testName);
  return TASK_NAMES[normalized] ?? normalized.replace(/_/g, " ");
}
