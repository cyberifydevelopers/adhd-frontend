import type { MainAdaptiveTrialTaskKey } from "@/config/catConfig";

/** Short human-readable stopping / cadence notes for the debug panel (matches engine intent). */
export const MAIN_ADAPTIVE_SPEC_SUMMARY: Record<MainAdaptiveTrialTaskKey, string[]> = {
  simple_rt: [
    "Purpose: baseline speed, consistency, lapses, RT variability (median RT, MAD/IQR, lapse rate).",
    "Min 25 / max 60 scored trials; checkpoint every 10 valid trials after min.",
    "Stopping: median RT Δ <5% and RT variability Δ <10% across two consecutive checkpoints, or lapse-rate Wilson CI ≤0.10; else run to max.",
    "Validity: anticipatory >5% (RT<120 ms), omission >15%, instability at max, device timing jitter.",
    "Difficulty: hold — fixation randomized 500–1500 ms only.",
  ],
  choice_rt: [
    "Main starts left/right; optional 3rd direction (up) when extended mode is on, ≥40 valid trials, ≥90% accuracy, and median/MAD stable across two checkpoints — UI applies upgrade (engine adjust_difficulty_up).",
    "Checkpoints at 30 valid trials (min), then every 10 valid trials (40, 50, …); stable stop when Wilson accuracy CI ≤0.10 and median/MAD stable across the last two checkpoints (typically from trial 40 onward).",
    "Signals: post-error slowing (median RT after error minus after correct, ≥120 ms RTs); validity flags include accuracy under 70%, anticipatory over 5%, side bias over 80%.",
  ],
  flanker: [
    "Min 40 / max 100 trials; checkpoint at trial 40, then every 20 trials (60, 80, …).",
    "Stopping: ≥15 congruent & ≥15 incongruent trials, incongruent-error Wilson CI ≤0.10, |Δ interference cost| <15 ms across two consecutive checkpoints, ≥20 trials at current difficulty.",
  ],
  sst: [
    "Checkpoints every 25 stop trials; recent window = 25 stops for success band (40–60%).",
    "SSRT stability uses integration-method SSRT (matches backend); mins + validity flags (go 80%, SSD stuck, etc.).",
  ],
  cpt: [
    "MVP: fixed target probability (~22.5%), 250 ms stimulus, jittered ISI; no difficulty adaptation inside scored blocks.",
    "Min 150 / max 360 trials; checkpoints every 60 trials; stop eval from 180; perfect play usually ~240 (Wilson CI at 22.5% targets).",
    "Stopping: omission & commission Wilson CI width ≤0.08 each + RT variability (MAD) stable across two checkpoints; continue while lapse rate or time-on-task slope is unstable.",
    "Extended mode (off by default): fatigue slope analysis + ≥4 min scored duration gate when active.",
    "Validity flags: anticipatory target RTs &gt;5%, omission rate &gt;40%, too few targets at max, dropped-frame timing, RT variability unstable at max.",
  ],
  digit_span: [
    "Forward staircase then backward: 2 trials per span level; advance after ≥1/2 correct (split → optional 3rd confirmation); stop direction after 0/2 once lower spans were passable.",
    "Age-based start: under 6 → 2; 6–7 → 3; 8–12 → 3; teens/adults → 4. Max 24 sequences total.",
    "Primary metrics: max forward span, max backward span, accuracy by span (server scoring from events).",
  ],
  task_switching: [
    "Primary metrics: median RT switch − median RT repeat (switch cost); switch-error rate Wilson CI.",
    "Min 48 / max 120 scored trials; ≥16 switch and ≥16 repeat trials before stable stop.",
    "Checkpoints at trial 48, then every 24 trials (72, 96, …).",
    "Stopping: |Δ switch cost| <20 ms across two checkpoints, switch-error CI width ≤0.10, ≥24 trials since last difficulty change.",
    "Difficulty: accuracy ≥85% and switch-cost stable → higher switch frequency (ratio +0.05); accuracy <70% → lower frequency + brief rule reminder.",
    "Validity: accuracy <70%, too few switch/repeat trials, rule-confusion pattern, switch cost unstable at max.",
  ],
  time_estimation: [
    "Targets 5 / 10 / 15 s; reproduction timing (mean absolute error, MAD variability, signed bias, CV of absolute error; distractor effect when distractor half is configured).",
    "Min 12 scored reproductions (18+ when distractor); max 30; no same target twice in a row; clean block then optional distractor half.",
    "Checkpoints every 6 scored reproductions after the minimum (18, 24, 30, …).",
    "Stopping: mean absolute error and variability each change <10% across two checkpoints; ≥3 reproductions per duration (clean) or per duration×condition (distractor); no difficulty ramp (hold).",
    "Validity: immediate reproduction, possible misunderstanding, extreme variability at max, distractor cell coverage, adjacent-duration schedule repair flag.",
  ],
  delay_discounting: [
    "Purpose: reward sensitivity (smaller-sooner vs larger-later). Metrics: immediate choice rate, indifference point (running mean of offered “now” amounts), approximate discount rate k, consistency across trials.",
    "Design: 12–30 scored choice trials; adaptive staircase — choose delayed → increase immediate on the next comparable trial; choose immediate → decrease immediate. Amounts/delays can follow CAT config when provided.",
    "Checkpoints every 6 trials after the minimum (12, 18, 24, …).",
    "Stopping: screening — trials 12–18 with consistency ≥0.80 and ≥2 choices per branch (immediate vs delayed); diagnostic — indifference point stable (<10% change across two checkpoints), consistency ≥0.80, and ≥3 trials per branch. Otherwise continue to max if inconsistent.",
    "Validity flags: consistency <70%, very fast responses on most trials, same-side key >90%, suspected misunderstanding of now vs later.",
  ],
  set_shifting_mini: [
    "Purpose: rule learning, cognitive flexibility, perseveration. Metrics: trials to criterion per rule phase, perseverative errors after rule change, rule-switch trial accuracy.",
    "Design: two sorting rules to start; advance to the next rule only after 5 consecutive correct. If the first rule is learned quickly (≤10 trials), a third distinct rule is added for the final phase; otherwise the first rule repeats as the third phase.",
    "Min 20 scored main trials (CAT cap), max 80. Checkpoints after each rule block (criterion met) or at 20, 30, 40, … trials.",
    "Stopping: two completed post-switch learning blocks (5-in-a-row on each new rule after a change), or perseveration pattern (≥3 perseverative errors on switch trials), or max trials with low-confidence path.",
    "Validity: failure to learn initial rule by session end; any perseverative error after a rule change (switch trials); established perseveration pattern (≥3 on switch trials); random responding (low accuracy and/or very fast RTs); max trials without stable criterion. Main block sets low_confidence when the two-shift success path is not completed.",
  ],
  substance_dd: [
    "Purpose (spec 11): substance-aware delay discounting — immediate choice rate, indifference point, approximate k, consistency; neutral wording only (no triggering imagery).",
    "Same adaptive staircase as delay discounting: min 12 / max 30 scored trials; checkpoint every 6 trials after the minimum.",
    "Stopping: indifference point stable (&lt;10% change across two checkpoints) and consistency ≥0.80; continue if inconsistent; screening vs diagnostic branch balance same as DD engine.",
    "Validity: distress reported, choice consistency &lt;70%, majority of trials with extremely fast RT, same-side key &gt;90%.",
    "Do not deploy where substance-framed cognitive tasks are clinically inappropriate.",
  ],
  psychomotor_speed: [
    "Purpose (spec 12): global slowing / motor and processing speed — median RT, MAD variability, omission (lapse) rate.",
    "Design: min 30 / max 80 scored trials; highly visible stimulus; fixed mapping (tap / Space); randomized foreperiod (1–3 s); no difficulty ramp.",
    "Checkpoints every 10 valid trials (non-anticipatory RT ≥120 ms) after the minimum; periodic counter uses valid trials for psychomotor.",
    "Stopping: median RT and MAD variability stable across two checkpoints and omission rate stable across two checkpoints; if lapses stay unstable, the block continues until criteria or max.",
    "Validity: omission rate &gt;20%, anticipatory rate &gt;5% among responded trials, motor impairment noted (user flag), RT median/variability unstable at max trials.",
  ],
  wm_distraction: [
    "Purpose (spec 13): WM capacity under mild distraction — accuracy by load, distractor cost (clean minus distracted accuracy), max span per condition.",
    "Design: min 4 sequences (≥2 trials each in clean and distracted before adaptive stop); max 32 sequences. Age-style start span 4 (CAT may override later).",
    "Clean vs distracted alternate; clean skips distractor phase. Distractor stream is mild (slow tick, geometric symbols), no response required.",
    "Staircase per condition: after each pair at a load, increase load if ≥1 of 2 correct; decrease if 0 of 2; 1/1 split triggers one confirmation trial at that load.",
    "Checkpoints after each load change (spanOrLoadCheckpoint). Stop when both clean and distracted ladders are sealed (reversal/floor/ceiling + min pairs) or at max sequences.",
    "Validity: early recall before encoding window ends, user-flag distractor understanding issue, floor after practice, inconsistent / incomplete battery at max sequences.",
  ],
};
