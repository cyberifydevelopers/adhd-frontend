import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catStore } from "@/stores/catStore";
import {
  CPT_FEEDBACK_MS,
  CPT_FIXATION_MS,
  CPT_MIN_RESPONSE_MS,
  CPT_RESPONSE_WINDOW_MS,
  CPT_STIMULUS_MS,
  classifyCptResponse,
  cptStore,
  type CPTTrial,
} from "@/stores/cptStore";
import { createPracticeState } from "@/lib/practiceEngine";
import { resetMainAdaptiveHistory } from "@/lib/mainAdaptiveIntegration";

vi.mock("@/services", () => ({
  sessionsService: {
    create: vi.fn(),
    postEvents: vi.fn(),
    postBlocks: vi.fn(),
    scoreCpt: vi.fn(),
    getCptStoppingCheck: vi.fn(),
  },
}));

describe("classifyCptResponse — scoring windows", () => {
  it("timing constants match the spec", () => {
    expect(CPT_FIXATION_MS).toBe(500);
    expect(CPT_STIMULUS_MS).toBe(250);
    expect(CPT_FEEDBACK_MS).toBe(750);
    expect(CPT_MIN_RESPONSE_MS).toBe(100);
    expect(CPT_RESPONSE_WINDOW_MS).toBe(1000);
  });

  it.each([
    // [trial type, press offset from onset (ms), expected response type, correct?]
    ["target", -300, "anticipatory", false], // pressed during the + screen
    ["target", 0, "anticipatory", false],
    ["target", 99, "anticipatory", false],
    ["target", 100, "correct_go", true], // window opens at 100 ms
    ["target", 600, "correct_go", true],
    ["target", 1000, "correct_go", true], // ...and closes at 1000 ms
    ["target", 1001, "omission", false], // too late
    ["target", null, "omission", false],
    ["nontarget", -50, "anticipatory", false], // anticipatory applies to any letter
    ["nontarget", 99, "anticipatory", false],
    ["nontarget", 100, "commission", false],
    ["nontarget", 1000, "commission", false],
    ["nontarget", 1001, "correct_nogo", true],
    ["nontarget", null, "correct_nogo", true],
  ] as const)("%s press at %s ms → %s", (type, offset, responseType, isCorrect) => {
    const out = classifyCptResponse(type, offset);
    expect(out.responseType).toBe(responseType);
    expect(out.isCorrect).toBe(isCorrect);
  });

  it("records RT for scored presses, clamps anticipatory RT at 0, and leaves no-response RT null", () => {
    expect(classifyCptResponse("target", 420).reactionTimeMs).toBe(420);
    expect(classifyCptResponse("target", -300).reactionTimeMs).toBe(0);
    expect(classifyCptResponse("target", null).reactionTimeMs).toBeNull();
    expect(classifyCptResponse("nontarget", null).reactionTimeMs).toBeNull();
  });
});

const TARGET: CPTTrial = { letter: "X", type: "target" };
const NONTARGET: CPTTrial = { letter: "A", type: "nontarget" };

function pressSpace() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
}

function events() {
  return cptStore.getState()._refs.events;
}

function lastEvent() {
  const e = events();
  return e[e.length - 1] as Record<string, unknown>;
}

describe("CPT trial clock — main block", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    cptStore.getState().prepareForFreshRun();
    catStore.getState().resetForNewTask();
    const refs = cptStore.getState()._refs;
    refs.blockStart = performance.now();
    refs.maxTrials = 360;
    refs.mainAdaptiveHistory = resetMainAdaptiveHistory();
  });

  afterEach(() => {
    cptStore.getState().cleanup();
    vi.useRealTimers();
  });

  function startMain(trials: CPTTrial[]) {
    cptStore.setState({ phase: "main", sessionId: "s", trials, trialIndex: 0, maxTrials: 360, events: [] });
    cptStore.getState().advanceTrial();
  }

  it("runs + 500 ms → stimulus 250 ms → blank 750 ms, then the next trial starts immediately", () => {
    startMain([TARGET, NONTARGET]);
    expect(cptStore.getState().trialScreen).toBe("fixation");

    vi.advanceTimersByTime(499);
    expect(cptStore.getState().trialScreen).toBe("fixation");
    expect(cptStore.getState().currentLetter).toBeNull();

    vi.advanceTimersByTime(1);
    expect(cptStore.getState().trialScreen).toBe("stimulus");
    expect(cptStore.getState().currentLetter).toBe("X");

    vi.advanceTimersByTime(249);
    expect(cptStore.getState().trialScreen).toBe("stimulus");
    vi.advanceTimersByTime(1);
    expect(cptStore.getState().trialScreen).toBe("blank");
    expect(cptStore.getState().currentLetter).toBeNull();

    vi.advanceTimersByTime(749);
    expect(events()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(events()).toHaveLength(1);
    // Main has no feedback screen: the next trial's + is up right away.
    expect(cptStore.getState().trialScreen).toBe("fixation");
    expect(cptStore.getState().trialIndex).toBe(1);
  });

  it("scores a press during the stimulus as a correct go (previously ignored until the stimulus ended)", () => {
    startMain([TARGET, NONTARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + 150);
    pressSpace();
    vi.advanceTimersByTime(CPT_RESPONSE_WINDOW_MS);
    expect(events()).toHaveLength(1);
    expect(lastEvent()).toMatchObject({
      event_type: "target",
      is_correct: true,
      reaction_time_ms: 150,
      extra_data: { response_type: "correct_go" },
    });
  });

  it("does not end the trial early on a press", () => {
    startMain([TARGET, NONTARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + 300);
    pressSpace();
    vi.advanceTimersByTime(600);
    expect(events()).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(events()).toHaveLength(1);
  });

  it("scores a press on the + screen as anticipatory", () => {
    startMain([TARGET, NONTARGET]);
    vi.advanceTimersByTime(200);
    pressSpace();
    vi.advanceTimersByTime(CPT_FIXATION_MS - 200 + CPT_RESPONSE_WINDOW_MS);
    expect(lastEvent()).toMatchObject({
      is_correct: false,
      reaction_time_ms: 0,
      extra_data: { response_type: "anticipatory", press_offset_ms: -300 },
    });
  });

  it("scores a press within 100 ms of onset as anticipatory", () => {
    startMain([NONTARGET, TARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + 60);
    pressSpace();
    vi.advanceTimersByTime(CPT_RESPONSE_WINDOW_MS);
    expect(lastEvent()).toMatchObject({
      event_type: "nontarget",
      is_correct: false,
      extra_data: { response_type: "anticipatory" },
    });
  });

  it("scores a non-target press at 100+ ms as a commission", () => {
    startMain([NONTARGET, TARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + 400);
    pressSpace();
    vi.advanceTimersByTime(CPT_RESPONSE_WINDOW_MS);
    expect(lastEvent()).toMatchObject({
      event_type: "nontarget",
      is_correct: false,
      reaction_time_ms: 400,
      extra_data: { response_type: "commission" },
    });
  });

  it("scores no press as omission on X and correct no-go on other letters", () => {
    startMain([TARGET, NONTARGET, TARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + CPT_RESPONSE_WINDOW_MS);
    expect(lastEvent()).toMatchObject({
      event_type: "target",
      is_correct: false,
      reaction_time_ms: null,
      extra_data: { response_type: "omission" },
    });
    vi.advanceTimersByTime(CPT_FIXATION_MS + CPT_RESPONSE_WINDOW_MS);
    expect(lastEvent()).toMatchObject({
      event_type: "nontarget",
      is_correct: true,
      reaction_time_ms: null,
      extra_data: { response_type: "correct_nogo" },
    });
  });

  it("scores only the first press, and ignores auto-repeat", () => {
    startMain([TARGET, NONTARGET]);
    vi.advanceTimersByTime(CPT_FIXATION_MS + 200);
    pressSpace();
    vi.advanceTimersByTime(300);
    pressSpace();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true }));
    vi.advanceTimersByTime(CPT_RESPONSE_WINDOW_MS);
    expect(events()).toHaveLength(1);
    expect(lastEvent().reaction_time_ms).toBe(200);
  });
});

describe("CPT trial clock — practice", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    cptStore.getState().prepareForFreshRun();
    catStore.getState().resetForNewTask();
  });

  afterEach(() => {
    cptStore.getState().cleanup();
    vi.useRealTimers();
  });

  function startPractice(trials: CPTTrial[]) {
    cptStore.setState({
      phase: "practice",
      trials,
      trialIndex: 0,
      practiceState: createPracticeState(),
      lastPracticeFeedback: null,
    });
    cptStore.getState().advanceTrial();
  }

  const ANSWERED = CPT_FIXATION_MS + CPT_RESPONSE_WINDOW_MS;

  it("shows feedback for 750 ms after the response window, then starts the next trial", () => {
    startPractice([TARGET, NONTARGET]);
    vi.advanceTimersByTime(ANSWERED - 1);
    expect(cptStore.getState().trialScreen).toBe("blank");

    vi.advanceTimersByTime(1);
    expect(cptStore.getState().trialScreen).toBe("feedback");
    expect(cptStore.getState().lastPracticeFeedback).toBe("omission");

    vi.advanceTimersByTime(CPT_FEEDBACK_MS - 1);
    expect(cptStore.getState().trialScreen).toBe("feedback");
    vi.advanceTimersByTime(1);
    expect(cptStore.getState().trialScreen).toBe("fixation");
    expect(cptStore.getState().trialIndex).toBe(1);
  });

  it.each([
    ["correct go", TARGET, CPT_FIXATION_MS + 300, "correct"],
    ["correct no-go", NONTARGET, null, "correct"],
    ["omission", TARGET, null, "omission"],
    ["commission", NONTARGET, CPT_FIXATION_MS + 300, "incorrect"],
    ["anticipatory (before stimulus)", TARGET, 100, "premature"],
    ["anticipatory (within 100 ms of onset)", NONTARGET, CPT_FIXATION_MS + 50, "premature"],
  ] as const)("%s → feedback category %s", (_name, trial, pressAt, expected) => {
    startPractice([trial, NONTARGET]);
    if (pressAt != null) {
      vi.advanceTimersByTime(pressAt);
      pressSpace();
      vi.advanceTimersByTime(ANSWERED - pressAt);
    } else {
      vi.advanceTimersByTime(ANSWERED);
    }
    expect(cptStore.getState().lastPracticeFeedback).toBe(expected);
    expect(cptStore.getState().trialScreen).toBe("feedback");
  });
});
