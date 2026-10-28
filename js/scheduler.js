// @ts-check
// ============================================================================
// Visionary — scheduling engine (pure functions)
//
//   * freeSlots()      — find open windows on a day given existing blocks
//   * rankSlots()      — prefer the user's historically strong hours
//   * bufferBetween()  — smart buffers between deep work and social/physical blocks
//   * busyIntervals()  — turn tasks into [start, end] minute ranges
//
// Times are minutes from midnight (0–1439). Tasks without a duration are
// assumed to take 60 minutes for conflict purposes.
// ============================================================================
(function () {
  'use strict';

  /**
   * @typedef {Object} Block
   * @property {string|number} [id]
   * @property {number} start   minutes from midnight
   * @property {number} end     minutes from midnight (exclusive)
   * @property {string} [category]
   * @property {string} [kind]
   * @property {string} [text]
   */

  /** Deep-focus categories vs. social/physical ones. A switch between the two deserves a buffer. */
  const DEEP = new Set(['focus', 'build', 'learn']);
  const SOCIAL = new Set(['health', 'rest']);
  const DEFAULT_LEN = 60;

  /**
   * @param {Array<{scheduledHour:number|null, scheduledMinute?:number|null, durationMin?:number|null, category?:string, kind?:string, id?:any, text?:string, completed?:boolean}>} tasks
   * @returns {Block[]}
   */
  function busyIntervals(tasks) {
    return tasks
      .filter((t) => t.scheduledHour !== null && t.scheduledHour !== undefined)
      .map((t) => {
        const start = (t.scheduledHour || 0) * 60 + (t.scheduledMinute || 0);
        return { id: t.id, start, end: Math.min(1440, start + (t.durationMin || DEFAULT_LEN)), category: t.category, kind: t.kind, text: t.text };
      })
      .sort((a, b) => a.start - b.start);
  }

  /**
   * Find free windows of at least `duration` minutes.
   * @param {Block[]} busy
   * @param {{duration:number, from?:number, to?:number, buffer?:number, step?:number, notBefore?:number}} opts
   * @returns {Array<{start:number, end:number}>}  candidate start times (end = start + duration)
   */
  function freeSlots(busy, opts) {
    const duration = Math.max(5, opts.duration | 0);
    const from = Math.max(0, opts.from ?? 8 * 60);
    const to = Math.min(1440, opts.to ?? 22 * 60);
    const buffer = Math.max(0, opts.buffer ?? 0);
    const step = Math.max(5, opts.step ?? 15);
    const notBefore = opts.notBefore ?? 0;
    const out = [];
    for (let s = Math.ceil(Math.max(from, notBefore) / step) * step; s + duration <= to; s += step) {
      const e = s + duration;
      const clash = busy.some((b) => s < b.end + buffer && e > b.start - buffer);
      if (!clash) out.push({ start: s, end: e });
    }
    return out;
  }

  /**
   * Score candidate slots using the user's history: hours where tasks tended to
   * get finished score higher; the slot that keeps the day compact wins ties.
   * @param {Array<{start:number,end:number}>} slots
   * @param {Record<number, number>} hourScore   0..1 completion rate by hour (optional)
   * @param {'morning'|'afternoon'|'evening'|null} [part]
   */
  function rankSlots(slots, hourScore = {}, part = null) {
    const inPart = (s) => {
      const h = s.start / 60;
      if (part === 'morning') return h >= 6 && h < 12;
      if (part === 'afternoon') return h >= 12 && h < 17;
      if (part === 'evening') return h >= 17;
      return true;
    };
    return [...slots]
      .map((s) => ({ ...s, score: (inPart(s) ? 1 : 0) * 10 + (hourScore[Math.floor(s.start / 60)] ?? 0.5) * 5 + (s.start % 60 === 0 ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score || a.start - b.start);
  }

  /** Collapse ranked slots into a short, varied shortlist (max n, at least 60 min apart). */
  function shortlist(ranked, n = 3) {
    const out = [];
    for (const s of ranked) {
      if (out.every((o) => Math.abs(o.start - s.start) >= 60)) out.push(s);
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * Completion rate by scheduled hour, from past tasks.
   * @param {Array<{scheduledHour:number|null, completed:boolean}>} pastTasks
   * @returns {Record<number, number>}
   */
  function hourScores(pastTasks) {
    const agg = /** @type {Record<number, {n:number, done:number}>} */ ({});
    for (const t of pastTasks) {
      if (t.scheduledHour === null || t.scheduledHour === undefined) continue;
      const a = (agg[t.scheduledHour] ||= { n: 0, done: 0 });
      a.n++; if (t.completed) a.done++;
    }
    const out = /** @type {Record<number, number>} */ ({});
    for (const h of Object.keys(agg)) { const a = agg[Number(h)]; if (a.n >= 2) out[Number(h)] = a.done / a.n; }
    return out;
  }

  /**
   * Decide whether a buffer belongs between two adjacent blocks.
   * Returns the buffer block or null.
   * @param {Block} a  earlier block
   * @param {Block} b  later block
   * @param {{minutes?:number, maxGap?:number}} [opts]
   */
  function bufferBetween(a, b, opts = {}) {
    const minutes = opts.minutes ?? 10;
    const maxGap = opts.maxGap ?? 5;
    if (a.kind === 'buffer' || b.kind === 'buffer') return null;
    const gap = b.start - a.end;
    if (gap < 0 || gap > maxGap) return null;
    const deepToSocial = DEEP.has(a.category || '') && SOCIAL.has(b.category || '');
    const socialToDeep = SOCIAL.has(a.category || '') && DEEP.has(b.category || '');
    if (!deepToSocial && !socialToDeep) return null;
    if (gap > 0 && gap < minutes) return null;           // there is already a small gap; leave it
    return { start: a.end, end: a.end + minutes, kind: 'buffer', category: deepToSocial ? 'rest' : 'focus', text: deepToSocial ? 'Recovery buffer' : 'Travel / settle-in buffer' };
  }

  /**
   * Buffer length from recent energy: tired weeks get longer breathers.
   * @param {Array<{energy:number}>} recentHistory
   */
  function bufferLength(recentHistory) {
    const e = recentHistory.filter((h) => h.energy > 0);
    if (!e.length) return 10;
    const avg = e.reduce((s, h) => s + h.energy, 0) / e.length;
    return avg < 5 ? 15 : avg > 7.5 ? 5 : 10;
  }

  /** Human label for minutes-from-midnight. */
  function label(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  window.VisionaryScheduler = Object.freeze({ busyIntervals, freeSlots, rankSlots, shortlist, hourScores, bufferBetween, bufferLength, label, DEFAULT_LEN });
})();
