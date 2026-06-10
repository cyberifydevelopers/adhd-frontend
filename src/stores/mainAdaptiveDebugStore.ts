import { create } from "zustand";
import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { MAIN_TASK_POLICY_PRESETS } from "@/lib/mainAdaptiveEngine";
import type {
  AdaptiveHistory,
  AdaptiveMode,
  MainAdaptiveCheckpointData,
  MainAdaptiveDecision,
  MainTaskAdaptivePolicy,
  DifficultyAdjustment,
} from "@/lib/mainAdaptiveEngine";

export type MainAdaptiveEvalSnapshot = {
  decision: MainAdaptiveDecision;
  confidenceMet: boolean;
  lowConfidenceFlag: boolean;
  validityFlags: string[];
  adaptiveStoppingReason: string;
  recommendedDifficulty: DifficultyAdjustment;
};

type MainAdaptiveDebugState = {
  taskKey: MainAdaptiveTrialTaskKey | null;
  mode: AdaptiveMode;
  sessionMaxTrials?: number;
  effectiveMaxTrials: number;
  policy: MainTaskAdaptivePolicy | null;
  checkpoint: MainAdaptiveCheckpointData | null;
  /** Last segment of adaptive history (for debug gate breakdowns, e.g. flanker cost stability). */
  recentCheckpoints: MainAdaptiveCheckpointData[];
  atEvaluationPoint: boolean;
  evaluation: MainAdaptiveEvalSnapshot | null;
  /** Trial count when `evaluation` was last populated (checkpoint boundary); survives between-trial updates. */
  lastEvaluatedTrialsCompleted: number | null;
  historyCheckpointCount: number;
  rollingLowConfidence: boolean;
  updatedAt: number;
  resetForTask: (taskKey: MainAdaptiveTrialTaskKey) => void;
  record: (input: {
    taskKey: MainAdaptiveTrialTaskKey;
    mode: AdaptiveMode;
    sessionMaxTrials?: number;
    effectiveMaxTrials: number;
    policy: MainTaskAdaptivePolicy;
    checkpoint: MainAdaptiveCheckpointData;
    atEvaluationPoint: boolean;
    evaluation: MainAdaptiveEvalSnapshot | null;
    returnedHistory: AdaptiveHistory;
  }) => void;
};

export const mainAdaptiveDebugStore = create<MainAdaptiveDebugState>((set) => ({
  taskKey: null,
  mode: "diagnostic",
  effectiveMaxTrials: 0,
  policy: null,
  checkpoint: null,
  recentCheckpoints: [],
  atEvaluationPoint: false,
  evaluation: null,
  lastEvaluatedTrialsCompleted: null,
  historyCheckpointCount: 0,
  rollingLowConfidence: false,
  updatedAt: 0,

  resetForTask: (taskKey) => {
    const policy = MAIN_TASK_POLICY_PRESETS[taskKey];
    set({
      taskKey,
      policy,
      effectiveMaxTrials: policy.maxTrials,
      checkpoint: null,
      recentCheckpoints: [],
      atEvaluationPoint: false,
      evaluation: null,
      lastEvaluatedTrialsCompleted: null,
      historyCheckpointCount: 0,
      rollingLowConfidence: false,
      updatedAt: Date.now(),
    });
  },

  record: ({
    taskKey,
    mode,
    sessionMaxTrials,
    effectiveMaxTrials,
    policy,
    checkpoint,
    atEvaluationPoint,
    evaluation,
    returnedHistory,
  }) =>
    set((prev) => {
      const keepEval = evaluation ?? prev.evaluation ?? null;
      const lastAt =
        evaluation != null ? checkpoint.trialsCompleted : prev.lastEvaluatedTrialsCompleted ?? null;
      return {
        taskKey,
        mode,
        sessionMaxTrials,
        effectiveMaxTrials,
        policy,
        checkpoint,
        recentCheckpoints: returnedHistory.checkpoints.slice(-8),
        atEvaluationPoint,
        evaluation: keepEval,
        lastEvaluatedTrialsCompleted: lastAt,
        historyCheckpointCount: returnedHistory.checkpoints.length,
        rollingLowConfidence: returnedHistory.lowConfidenceFlag,
        updatedAt: Date.now(),
      };
    }),
}));
