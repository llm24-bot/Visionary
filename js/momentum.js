// @ts-check
// ============================================================================
// Visionary — momentum engineering (pure functions)
//
//   * graceVerdict()     — Momentum Grace: does today still count for the streak?
//   * computeNudges()    — quiet, data-backed behavioural nudges
//   * localMicroSteps()  — offline micro-step decomposition (AI fallback)
// ============================================================================
(function () {
  'use strict';

  /**
   * @typedef {Object} SessionLog
   * @property {string} date      YYYY-MM-DD
   * @property {number} at        epoch ms
   * @property {number} minutes
   * @property {number} [seconds]
   * @property {string} label
   * @property {string} [category]
   * @property {boolean} [completed]  false when the user stopped early
   * @property {string} [mode]
   */

  /**
   * A day keeps the streak alive when it is fully done (full day), or when the
   * person showed up anyway: at least one task finished plus a reflection, or at
   * least half the plan done. Consistency over perfection.
   * @param {{total:number, done:number, reflected:boolean}} day
   * @returns {{counts:boolean, grace:boolean, reason:string}}
   */
  function graceVerdict(day) {
    if (day.total > 0 && day.done >= day.total) return { counts: true, grace: false, reason: 'Every task done.' };
    if (day.reflected && day.done >= 1) return { counts: true, grace: true, reason: 'Momentum Grace: you reflected and finished something. The streak holds.' };
    if (day.total > 0 && day.done / day.total >= 0.5) return { counts: true, grace: true, reason: 'Momentum Grace: more than half the plan done. The streak holds.' };
    if (day.reflected && day.total === 0) return { counts: true, grace: true, reason: 'Momentum Grace: a rest day you closed on purpose still counts.' };
    return { counts: false, grace: false, reason: day.reflected ? 'Finish one task to keep the streak.' : 'Finish one task and save a reflection to keep the streak.' };
  }

  /**
   * @param {Object} input
   * @param {SessionLog[]} input.sessions
   * @param {Array<{date:string, energy:number, focus:number, rate:number, total:number}>} input.history
   * @param {Array<{scheduledHour:number|null, completed:boolean, category:string, text:string, kind?:string}>} input.tasks  today's tasks
   * @param {Date} [input.now]
   * @returns {Array<{id:string, text:string, action?:string, actionLabel?:string, weight:number}>}
   */
  function computeNudges(input) {
    const now = input.now || new Date();
    const hour = now.getHours();
    const nudges = [];
    const CAT = { focus: 'focus', health: 'health', learn: 'study', build: 'build', rest: 'rest' };

    // 1. Early-stop pattern per category: "You lose focus after ~45 minutes on study tasks."
    const byCat = /** @type {Record<string, SessionLog[]>} */ ({});
    for (const s of input.sessions) { if (s.category && s.completed === false && s.minutes >= 5) (byCat[s.category] ||= []).push(s); }
    for (const [cat, list] of Object.entries(byCat)) {
      if (list.length < 3) continue;
      const avg = Math.round(list.reduce((a, s) => a + s.minutes, 0) / list.length / 5) * 5;
      const openInCat = input.tasks.some((t) => !t.completed && t.category === cat && t.kind !== 'buffer');
      if (openInCat && avg >= 15) {
        nudges.push({ id: `early-stop-${cat}`, weight: 3, text: `You tend to stop after about ${avg} minutes on ${CAT[cat] || cat} tasks. Want a ${avg}-minute timer with a 5-minute breather built in?`, action: `timer:${avg}`, actionLabel: `Set ${avg} min` });
      }
    }

    // 2. Energy dip hour: reflections with low energy on days when the plan was heavy at this hour.
    const low = input.history.filter((h) => h.energy > 0 && h.energy <= 4);
    if (low.length >= 3 && input.history.length >= 6) {
      const heavyOpen = input.tasks.filter((t) => !t.completed && t.kind !== 'buffer').length;
      if (heavyOpen >= 4 && hour >= 14 && hour <= 17) {
        nudges.push({ id: 'afternoon-dip', weight: 2, text: `Afternoons have been your lowest-energy stretch lately and ${heavyOpen} tasks are still open. Pick one small win now; the rest can move to tomorrow.`, action: 'suggest', actionLabel: 'Pick one for me' });
      }
    }

    // 3. Overdue pile-up: scheduled earlier today, still open.
    const overdue = input.tasks.filter((t) => !t.completed && t.kind !== 'buffer' && t.scheduledHour !== null && t.scheduledHour < hour);
    if (overdue.length >= 2) {
      nudges.push({ id: 'overdue', weight: 2, text: `${overdue.length} planned blocks slipped past their time. No judgement: drag them to a slot later today, or break one into a five-minute first step.`, action: 'breakdown', actionLabel: 'Break one down' });
    }

    // 4. Momentum: last three logged days improving.
    const sorted = [...input.history].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-3);
    if (sorted.length === 3 && sorted[0].rate < sorted[1].rate && sorted[1].rate < sorted[2].rate) {
      nudges.push({ id: 'uptrend', weight: 1, text: `Three days in a row of better completion. Keep today's plan the same size; momentum likes repetition.` });
    }

    // 5. Evening close: reflection not saved, it's late, and something was done.
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reflected = input.history.some((h) => h.date === todayIso);
    const done = input.tasks.filter((t) => t.completed && t.kind !== 'buffer').length;
    if (!reflected && hour >= 20 && done > 0) {
      nudges.push({ id: 'close-day', weight: 2, text: `You finished ${done} task${done > 1 ? 's' : ''} today. A 30-second reflection locks in the streak, even on an unfinished day.`, action: 'reflect', actionLabel: 'Reflect now' });
    }

    return nudges.sort((a, b) => b.weight - a.weight);
  }

  /**
   * Offline micro-steps: generic but concrete first moves, tuned by category.
   * @param {string} text
   * @param {string} category
   * @returns {Array<{text:string, minutes:number}>}
   */
  function localMicroSteps(text, category) {
    const t = text.replace(/\s+/g, ' ').trim();
    const short = t.length > 40 ? t.slice(0, 37).replace(/\s+\S*$/, '') + '…' : t;
    const templates = {
      build: [`Open the project for “${short}”`, 'Write down the one thing “done” means today', 'Create the file or branch you need', 'Write the first function stub or TODO list', 'Run it once, even if it fails'],
      learn: [`Open the material for “${short}”`, 'Skim the headings and write 3 questions', 'Read or solve for 5 minutes, no notes yet', 'Write one sentence summarising what you got', 'Mark the next place to pick up'],
      health: [`Put on the clothes or shoes for “${short}”`, 'Fill a water bottle', 'Do a 2-minute warm-up', 'Start with the easiest set or the first 5 minutes'],
      rest: [`Set a 5-minute timer for “${short}”`, 'Put the phone in another room', 'Sit down and do nothing for one minute', 'Decide the one thing you will not do tonight'],
      focus: [`Write the goal of “${short}” in one line`, 'List the 3 pieces it breaks into', 'Clear the desk and close other tabs', 'Start the smallest piece for 5 minutes', 'Leave a note about where to resume']
    };
    const steps = templates[/** @type {keyof typeof templates} */ (category)] || templates.focus;
    return steps.slice(0, 5).map((s) => ({ text: s, minutes: 5 }));
  }

  window.VisionaryMomentum = Object.freeze({ graceVerdict, computeNudges, localMicroSteps });
})();
