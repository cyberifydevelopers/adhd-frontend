import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";
import { MAIN_TASK_ADAPTIVE_TRIAL_LIMITS } from "@/config/catConfig";
import type {
  AdaptiveMode,
  MainAdaptiveCheckpointData,
  MainTaskAdaptivePolicy,
} from "@/lib/mainAdaptiveEngine";
import type { MainAdaptiveEvalSnapshot } from "@/stores/mainAdaptiveDebugStore";
import { catStore } from "@/stores/catStore";
import { mainAdaptiveDebugStore } from "@/stores/mainAdaptiveDebugStore";

/** Payload merged into `TaskResult.metrics.main_adaptive_debug` at score time. */
export type PersistedMainAdaptiveDebug = {
  version: number;
  capturedAt: string;
  taskKey: MainAdaptiveTrialTaskKey;
  mode: AdaptiveMode;
  sessionMaxTrials?: number;
  effectiveMaxTrials: number;
  policy: MainTaskAdaptivePolicy;
  checkpoint: MainAdaptiveCheckpointData | null;
  recentCheckpoints: MainAdaptiveCheckpointData[];
  atEvaluationPoint: boolean;
  evaluation: MainAdaptiveEvalSnapshot | null;
  lastEvaluatedTrialsCompleted: number | null;
  historyCheckpointCount: number;
  rollingLowConfidence: boolean;
  catShouldTrigger: boolean;
  catTriggerReason: string | null;
  catLastBlockEndReason: string | null;
};

/** Last good snapshot per task — survives `resetForTask` on the next task before `score*` runs. */
const lastPersistedByTask = new Map<MainAdaptiveTrialTaskKey, PersistedMainAdaptiveDebug>();

function buildLivePersistedDebug(taskKey: MainAdaptiveTrialTaskKey): PersistedMainAdaptiveDebug | null {
  const s = mainAdaptiveDebugStore.getState();
  if (s.taskKey !== taskKey || !s.checkpoint || !s.policy) return null;
  const cat = catStore.getState();
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    taskKey,
    mode: s.mode,
    sessionMaxTrials: s.sessionMaxTrials,
    effectiveMaxTrials: s.effectiveMaxTrials,
    policy: JSON.parse(JSON.stringify(s.policy)) as MainTaskAdaptivePolicy,
    checkpoint: JSON.parse(JSON.stringify(s.checkpoint)) as MainAdaptiveCheckpointData,
    recentCheckpoints: JSON.parse(JSON.stringify(s.recentCheckpoints)) as MainAdaptiveCheckpointData[],
    atEvaluationPoint: s.atEvaluationPoint,
    evaluation: s.evaluation ? (JSON.parse(JSON.stringify(s.evaluation)) as MainAdaptiveEvalSnapshot) : null,
    lastEvaluatedTrialsCompleted: s.lastEvaluatedTrialsCompleted,
    historyCheckpointCount: s.historyCheckpointCount,
    rollingLowConfidence: s.rollingLowConfidence,
    catShouldTrigger: cat.shouldTriggerBlockEnd,
    catTriggerReason: cat.blockEndTriggerReason ?? null,
    catLastBlockEndReason: cat.lastBlockEndSignalReason ?? null,
  };
}

/** Call after each adaptive `record()` so scoring can recover if the live store was reset. */
export function stashMainAdaptiveDebugAfterRecord(taskKey: MainAdaptiveTrialTaskKey) {
  const p = buildLivePersistedDebug(taskKey);
  if (p) lastPersistedByTask.set(taskKey, p);
}

export function takeMainAdaptiveDebugPayload(
  taskKey: MainAdaptiveTrialTaskKey,
): PersistedMainAdaptiveDebug | null {
  const live = buildLivePersistedDebug(taskKey);
  if (live) {
    lastPersistedByTask.set(taskKey, live);
    return live;
  }
  return lastPersistedByTask.get(taskKey) ?? null;
}

export function parsePersistedMainAdaptiveDebug(raw: unknown): PersistedMainAdaptiveDebug | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tk = o.taskKey as string;
  if (!tk || !(tk in MAIN_TASK_ADAPTIVE_TRIAL_LIMITS)) return null;
  if (typeof o.effectiveMaxTrials !== "number" || !o.policy) return null;
  return o as unknown as PersistedMainAdaptiveDebug;
}
