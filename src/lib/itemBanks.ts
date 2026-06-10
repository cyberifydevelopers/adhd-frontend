/**
 * Static IRT item banks — pre-calibrated difficulty/discrimination values.
 *
 * Each task has a bank of items spanning its difficulty range.
 * Item `params` map to concrete trial parameters for that task.
 */

import type { IRTItem } from "./irtEngine";

export const FLANKER_ITEM_BANK: IRTItem[] = [
  { id: "flk_01", difficulty: -2.0, discrimination: 1.0, params: { congruence: "congruent", foreperiodCenter: 2000 }, administered: false },
  { id: "flk_02", difficulty: -1.5, discrimination: 1.1, params: { congruence: "congruent", foreperiodCenter: 1600 }, administered: false },
  { id: "flk_03", difficulty: -0.5, discrimination: 1.2, params: { congruence: "congruent", foreperiodCenter: 1200 }, administered: false },
  { id: "flk_04", difficulty: 0.5,  discrimination: 1.3, params: { congruence: "congruent", foreperiodCenter: 900 }, administered: false },
  { id: "flk_05", difficulty: 1.0,  discrimination: 1.4, params: { congruence: "congruent", foreperiodCenter: 700 }, administered: false },
  { id: "flk_06", difficulty: 1.5,  discrimination: 1.4, params: { congruence: "congruent", foreperiodCenter: 500 }, administered: false },
  { id: "flk_07", difficulty: -1.0, discrimination: 1.1, params: { congruence: "incongruent", foreperiodCenter: 2000 }, administered: false },
  { id: "flk_08", difficulty: -0.2, discrimination: 1.2, params: { congruence: "incongruent", foreperiodCenter: 1600 }, administered: false },
  { id: "flk_09", difficulty: 0.5,  discrimination: 1.3, params: { congruence: "incongruent", foreperiodCenter: 1200 }, administered: false },
  { id: "flk_10", difficulty: 1.2,  discrimination: 1.4, params: { congruence: "incongruent", foreperiodCenter: 900 }, administered: false },
  { id: "flk_11", difficulty: 2.0,  discrimination: 1.5, params: { congruence: "incongruent", foreperiodCenter: 700 }, administered: false },
  { id: "flk_12", difficulty: 2.5,  discrimination: 1.5, params: { congruence: "incongruent", foreperiodCenter: 500 }, administered: false },
];

export const CPT_ITEM_BANK: IRTItem[] = [
  { id: "cpt_01", difficulty: -2.0, discrimination: 1.0, params: { targetRatio: 0.15, isiCenter: 2000 }, administered: false },
  { id: "cpt_02", difficulty: -1.5, discrimination: 1.0, params: { targetRatio: 0.15, isiCenter: 1800 }, administered: false },
  { id: "cpt_03", difficulty: -1.0, discrimination: 1.1, params: { targetRatio: 0.20, isiCenter: 1600 }, administered: false },
  { id: "cpt_04", difficulty: -0.5, discrimination: 1.1, params: { targetRatio: 0.20, isiCenter: 1400 }, administered: false },
  { id: "cpt_05", difficulty: 0.0,  discrimination: 1.2, params: { targetRatio: 0.25, isiCenter: 1300 }, administered: false },
  { id: "cpt_06", difficulty: 0.5,  discrimination: 1.2, params: { targetRatio: 0.25, isiCenter: 1200 }, administered: false },
  { id: "cpt_07", difficulty: 1.0,  discrimination: 1.3, params: { targetRatio: 0.30, isiCenter: 1100 }, administered: false },
  { id: "cpt_08", difficulty: 1.3,  discrimination: 1.3, params: { targetRatio: 0.30, isiCenter: 1000 }, administered: false },
  { id: "cpt_09", difficulty: 1.6,  discrimination: 1.4, params: { targetRatio: 0.35, isiCenter: 900 }, administered: false },
  { id: "cpt_10", difficulty: 2.0,  discrimination: 1.4, params: { targetRatio: 0.35, isiCenter: 800 }, administered: false },
  { id: "cpt_11", difficulty: 2.3,  discrimination: 1.5, params: { targetRatio: 0.40, isiCenter: 700 }, administered: false },
  { id: "cpt_12", difficulty: 2.5,  discrimination: 1.5, params: { targetRatio: 0.40, isiCenter: 600 }, administered: false },
];

export const TASK_SWITCHING_ITEM_BANK: IRTItem[] = [
  { id: "ts_01", difficulty: -2.0, discrimination: 1.0, params: { isSwitch: false, preferredTask: "letter", foreperiodCenter: 2000 }, administered: false },
  { id: "ts_02", difficulty: -1.5, discrimination: 1.1, params: { isSwitch: false, preferredTask: "number", foreperiodCenter: 1800 }, administered: false },
  { id: "ts_03", difficulty: -0.5, discrimination: 1.2, params: { isSwitch: false, preferredTask: "letter", foreperiodCenter: 1400 }, administered: false },
  { id: "ts_04", difficulty: 0.0,  discrimination: 1.2, params: { isSwitch: false, preferredTask: "number", foreperiodCenter: 1200 }, administered: false },
  { id: "ts_05", difficulty: 0.5,  discrimination: 1.3, params: { isSwitch: false, preferredTask: "letter", foreperiodCenter: 1000 }, administered: false },
  { id: "ts_06", difficulty: 1.0,  discrimination: 1.3, params: { isSwitch: false, preferredTask: "number", foreperiodCenter: 800 }, administered: false },
  { id: "ts_07", difficulty: -1.0, discrimination: 1.1, params: { isSwitch: true, preferredTask: "letter", foreperiodCenter: 2000 }, administered: false },
  { id: "ts_08", difficulty: -0.2, discrimination: 1.2, params: { isSwitch: true, preferredTask: "number", foreperiodCenter: 1800 }, administered: false },
  { id: "ts_09", difficulty: 0.5,  discrimination: 1.3, params: { isSwitch: true, preferredTask: "letter", foreperiodCenter: 1400 }, administered: false },
  { id: "ts_10", difficulty: 1.0,  discrimination: 1.3, params: { isSwitch: true, preferredTask: "number", foreperiodCenter: 1200 }, administered: false },
  { id: "ts_11", difficulty: 1.5,  discrimination: 1.4, params: { isSwitch: true, preferredTask: "letter", foreperiodCenter: 1000 }, administered: false },
  { id: "ts_12", difficulty: 2.0,  discrimination: 1.5, params: { isSwitch: true, preferredTask: "number", foreperiodCenter: 800 }, administered: false },
];
