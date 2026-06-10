export interface CATRoutingDecision {
  extend_current_task: boolean;
  trials_to_add: number;
  next_task: string | null;
  stop_battery: boolean;
  domain_confidence_map: Record<string, number>;
  reasoning: string;
  used_fallback: boolean;
}

export interface RoutingDecisionRequest {
  task_completed: string;
  trigger_reason: string;
  block_metrics: Record<string, unknown>;
}

export interface PracticeConfigDTO {
  min_trials: number;
  max_trials: number;
  evaluation_interval: number;
  pass_threshold: number;
  continue_threshold: number;
  final_trial_count: number;
}

export interface DigitSpanRoundPlanItem {
  direction: "forward" | "backward";
  span: number;
}

export interface TaskTrialConfig {
  task_name: string;
  min_trials: number;
  max_trials: number;
  checkpoint_interval: number;
  practice_config: PracticeConfigDTO;
  digit_span_round_plan?: DigitSpanRoundPlanItem[] | null;
}

export interface CheckpointRequest {
  task_name: string;
  trials_completed: number;
  running_metrics: Record<string, unknown>;
  practice_mode?: boolean;
  practice_state?: Record<string, unknown>;
}

export interface CheckpointResponse {
  action:
    | "continue"
    | "stop_task"
    | "continue_practice"
    | "restart_practice"
    | "start_final_practice"
    | "continue_final_practice"
    | "complete_practice";
  reasoning: string;
  domain_confidence_map: Record<string, number>;
  used_fallback: boolean;
  next_phase?: "practice" | "final_practice" | "complete" | null;
  show_instructions?: boolean;
  feedback_enabled?: boolean;
  final_practice_trials?: number | null;
  restart_practice?: boolean;
}
