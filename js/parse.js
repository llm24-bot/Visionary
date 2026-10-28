// @ts-check
// ============================================================================
// Visionary — natural-language parsing (pure functions, no DOM, no network)
//
//   parseCommand("gym with Aryan at 6pm for 45 mins")
//     -> { intent: 'add', text: 'Gym', people: 'Aryan', hour: 18, minute: 0, duration: 45, ... }
//   parseCommand("deep work on C++ compiler from 9am to 11am")
//     -> { intent: 'add', text: 'Deep work on C++ compiler', hour: 9, minute: 0, duration: 120 }
//   parseCommand("find 30 minutes next Tuesday after my discrete math class")
//     -> { intent: 'find', duration: 30, dateOffset: 6, after: 'discrete math class' }
//   parseScheduleText("9:00-10:15 CS 1570 lecture\nGym 6pm")
//     -> [{ text, category, scheduledHour, scheduledMinute, durationMin }]
//
// Everything here is deterministic so Quick Actions feel instant and work
// offline. The AI endpoint is only used for photos, pasted documents and
// micro-step suggestions.
// ============================================================================
(function () {
  'use strict';

  /**
   * @typedef {Object} ParsedCommand
   * @property {'add'|'find'} intent
   * @property {string} text            Cleaned task title (people/time removed)
   * @property {number|null} hour       0–23 start hour, if any
   * @property {number|null} minute     0–59 start minute (null when hour is null)
   * @property {number|null} duration   Minutes, if any
   * @property {string|null} people     "Aryan", "Sam and Lee"
   * @property {number} dateOffset      Days from today (0 = today)
   * @property {string|null} after      Free-text anchor ("discrete math class")
   * @property {string|null} before
   * @property {'morning'|'afternoon'|'evening'|null} part
   * @property {string|null} category   Guessed category or null
   */

  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WEEKDAY_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  const CATEGORY_HINTS = /** @type {Array<[RegExp, string]>} */ ([
    [/\b(gym|workout|run|running|lift|walk|yoga|stretch|swim|bike|cardio|meal prep|doctor|dentist|sleep|nap)\b/i, 'health'],
    [/\b(study|class|lecture|lab|homework|hw|exam|quiz|read|reading|notes|calculus|math|physics|biology|chem|chemistry|discrete|course|tutorial|learn)\b/i, 'learn'],
    [/\b(build|ship|deploy|code|coding|compiler|repo|refactor|fix|bug|feature|implement|api|frontend|backend|design)\b/i, 'build'],
    [/\b(rest|relax|break|breather|call (?:mom|dad|family)|family|dinner|movie|unwind|no-screen|lights out)\b/i, 'rest'],
    [/\b(deep work|focus|plan|planning|inbox|email|write|writing|essay|spec|review|meeting|interview)\b/i, 'focus']
  ]);

  /** @param {string} s */
  const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();

  /** "6pm" | "6:30 pm" | "18:00" | "noon" | "midnight" -> minutes from midnight, or null */
  function toMinutes(h, m, ampm) {
    let hour = Number(h);
    const minute = m === undefined || m === null || m === '' ? 0 : Number(m);
    const ap = (ampm || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (ap && (Number(h) < 1 || Number(h) > 12)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }

  const TIME = '(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?';
  const TIME_RE = new RegExp(TIME, 'i');

  /** Parse a single time token like "6pm", "18:30", "noon". Returns minutes or null. */
  function parseTimeToken(token, inheritAmPm) {
    const t = token.trim().toLowerCase();
    if (t === 'noon' || t === 'midday') return 12 * 60;
    if (t === 'midnight') return 0;
    const m = t.match(new RegExp('^' + TIME + '$', 'i'));
    if (!m) return null;
    const ampm = m[3] || inheritAmPm || '';
    // Bare numbers without am/pm: treat 1–6 as pm (people rarely plan 3 AM) unless minutes/24h given.
    if (!ampm && m[2] === undefined) {
      const h = Number(m[1]);
      if (h >= 1 && h <= 6) return toMinutes(h + 12, 0, '');
    }
    return toMinutes(m[1], m[2], ampm);
  }

  /** Parse "45 mins", "1.5 hours", "2h", "90m", "1h30" -> minutes or null */
  function parseDuration(str) {
    const s = str.trim().toLowerCase();
    let m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\s*(?:(\d{1,2})\s*(m|min|mins|minutes)?)?$/);
    if (m) return Math.round(Number(m[1]) * 60 + Number(m[3] || 0));
    m = s.match(/^(\d+)\s*(m|min|mins|minute|minutes)$/);
    if (m) return Number(m[1]);
    m = s.match(/^(an?|one)\s+hour$/);
    if (m) return 60;
    m = s.match(/^half\s+an?\s+hour$/);
    if (m) return 30;
    return null;
  }

  /** @param {string} text @param {Date} now */
  function parseDate(text, now) {
    let offset = 0;
    let rest = text;
    const take = (re, fn) => { const m = rest.match(re); if (m) { fn(m); rest = (rest.slice(0, m.index) + ' ' + rest.slice((m.index || 0) + m[0].length)); return true; } return false; };
    if (take(/\b(?:the\s+)?day after tomorrow\b/i, () => { offset = 2; })) return { offset, rest };
    if (take(/\btomorrow\b/i, () => { offset = 1; })) return { offset, rest };
    if (take(/\btoday\b|\btonight\b/i, () => { offset = 0; })) return { offset, rest };
    const wd = new RegExp('\\b(next|this)?\\s*(' + WEEKDAYS.join('|') + '|' + WEEKDAY_SHORT.join('|') + ')\\b', 'i');
    take(wd, (m) => {
      const name = m[2].toLowerCase();
      let idx = WEEKDAYS.indexOf(name);
      if (idx < 0) idx = WEEKDAY_SHORT.indexOf(name.slice(0, 3));
      const todayIdx = now.getDay();
      let diff = (idx - todayIdx + 7) % 7;
      if (diff === 0) diff = 7;                       // "Tuesday" said on a Tuesday means next week
      if ((m[1] || '').toLowerCase() === 'next' && diff < 7 && idx <= todayIdx) diff += 0; // already next occurrence
      offset = diff;
    });
    take(/\bin\s+(\d+)\s+days?\b/i, (m) => { offset = Number(m[1]); });
    return { offset, rest };
  }

  /**
   * @param {string} raw
   * @param {Date} [now]
   * @returns {ParsedCommand}
   */
  function parseCommand(raw, now = new Date()) {
    let text = ' ' + String(raw || '').replace(/\s+/g, ' ').trim() + ' ';
    /** @type {ParsedCommand} */
    const out = { intent: 'add', text: '', hour: null, minute: null, duration: null, people: null, dateOffset: 0, after: null, before: null, part: null, category: null };

    // Intent: find / book / schedule a slot
    const findRe = /^\s*(?:find|book|schedule|reserve|block|grab)\s+(?:me\s+)?(?:a\s+)?(?:(?:free\s+)?(?:slot|time|block|window)\s+(?:of\s+|for\s+)?)?/i;
    if (findRe.test(text) && /\b\d+\s*(?:m|min|mins|minutes|h|hr|hrs|hour|hours)\b|\ban?\s+hour\b|\bhalf an hour\b/i.test(text)) {
      out.intent = 'find';
      text = text.replace(findRe, ' ');
    }

    // Time range: "from 9am to 11am", "9-11am", "9:00–10:15"
    const rangeRe = new RegExp('\\b(?:from\\s+)?' + TIME + '\\s*(?:-|–|—|to|until|till)\\s*' + TIME + '\\b', 'i');
    let m = text.match(rangeRe);
    if (m) {
      const endAp = m[6] || '';
      const startAp = m[3] || (endAp && Number(m[1]) <= Number(m[4]) ? endAp : '');
      const start = parseTimeToken(`${m[1]}${m[2] ? ':' + m[2] : ''}${startAp}`, '');
      const end = parseTimeToken(`${m[4]}${m[5] ? ':' + m[5] : ''}${endAp}`, '');
      if (start !== null && end !== null) {
        let dur = end - start;
        if (dur <= 0) dur += 12 * 60;               // "11 to 1" → crosses noon
        if (dur > 0 && dur <= 24 * 60) {
          out.hour = Math.floor(start / 60); out.minute = start % 60; out.duration = dur;
          text = text.replace(m[0], ' ');
        }
      }
    }

    // Duration: "for 45 mins", "for 1.5 hours", "(90 min)", "30 minutes"
    m = text.match(/\b(?:for\s+)?((?:\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours)(?:\s*\d{1,2}\s*(?:m|min|mins|minutes)?)?)|(?:\d+\s*(?:m|min|mins|minute|minutes))|(?:an?\s+hour)|(?:half\s+an?\s+hour))\b/i);
    if (m && out.duration === null) {
      const d = parseDuration(m[1]);
      if (d !== null && d > 0 && d <= 24 * 60) { out.duration = d; text = text.replace(m[0], ' '); }
    }

    // Day: tomorrow, next tuesday, in 3 days.
    // "Plan tomorrow" with no time is a title, not a date — only read a date word
    // when it leads the sentence or the command also carries a time/duration.
    const hasTiming = out.hour !== null || out.duration !== null || /(?:\bat\s+|@\s*)\d|\d\s*(?:a\.?m|p\.?m)\b|\b\d{1,2}:\d{2}\b/i.test(text);
    const leadsWithDate = /^\s*(?:on\s+)?(?:tomorrow|today|tonight|next\b|this\b|mon|tue|wed|thu|fri|sat|sun)/i.test(text);
    if (hasTiming || leadsWithDate || out.intent === 'find') {
      const dated = parseDate(text, now);
      out.dateOffset = dated.offset;
      text = dated.rest;
    }

    // Part of day
    m = text.match(/\b(?:in\s+the\s+)?(morning|afternoon|evening|tonight)\b/i);
    if (m) { const p = m[1].toLowerCase(); out.part = p === 'tonight' ? 'evening' : /** @type {any} */ (p); text = text.replace(m[0], ' '); }

    // Anchors: "after my discrete math class", "before lunch"
    m = text.match(/\b(after|before)\s+(?:my\s+|the\s+)?([a-z0-9+#' -]{2,60}?)(?=\s*(?:$|,|\.|\bat\b|\bfor\b|\bwith\b|\bon\b))/i);
    if (m && out.intent === 'find') {
      const anchor = clean(m[2]);
      if (m[1].toLowerCase() === 'after') out.after = anchor; else out.before = anchor;
      text = text.replace(m[0], ' ');
    }

    // Start time: "at 6pm", "@ 18:30", "6:45pm", "14:00", "at noon"
    m = text.match(/(?:\bat\s+|@\s*)(noon|midday|midnight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)(?=\s|$)/i)
      || text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))(?=\s|$)/i)
      || text.match(/(?:^|\s)(\d{1,2}:\d{2})(?=\s|$)/);
    if (m && out.hour === null) {
      const mins = parseTimeToken(m[1], '');
      if (mins !== null) { out.hour = Math.floor(mins / 60); out.minute = mins % 60; text = text.replace(m[0], ' '); }
    }

    // People: "with Aryan", "w/ Sam and Lee"
    m = text.match(/\b(?:with|w\/)\s+([A-Z][\w'-]*(?:\s+(?:and|&|,)\s*[A-Z][\w'-]*)*)/);
    if (m) { out.people = clean(m[1]); text = text.replace(m[0], ' '); }

    // Leftover connector words and filler
    text = text.replace(/\b(?:when|that|while|where)\s+(?:i'?m|i am|we're|we are)?\s*(?:free|available|open)\b/gi, ' ');
    text = text.replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s*[—–-]\s*$/g, ' ');
    text = text.replace(/\b(?:at|on|for|from|to|please|pls|in)\s*$/i, ' ');
    text = clean(text.replace(/^\s*(?:add|new task|task|todo|remind me to|remember to|on)\s+/i, ''));
    if (text) text = text[0].toUpperCase() + text.slice(1);
    out.text = text;

    for (const [re, cat] of CATEGORY_HINTS) { if (re.test(raw)) { out.category = cat; break; } }
    if (out.intent === 'find' && !out.text) out.text = 'Open block';
    return out;
  }

  /**
   * Local fallback for pasted schedules: one item per line.
   * Handles "9:00-10:15 CS 1570 lecture", "Gym — 6pm (45 min)", "MWF 10am Calculus", "14:00 Standup".
   * @param {string} raw
   * @returns {Array<{text:string, category:string, scheduledHour:number|null, scheduledMinute:number|null, durationMin:number|null}>}
   */
  function parseScheduleText(raw) {
    const lines = String(raw || '').split(/\r?\n|;|•/).map((l) => l.replace(/^\s*(?:[-*•>]|\d{1,2}[.)])\s+/, '').trim()).filter((l) => l.length > 1);
    const out = [];
    const HEADER = /^(?:(?:date|time|day|event|events|location|instructor|room|course|title|where|when|what|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s*[:|\-–]?\s*)+$/i;
    for (const line of lines.slice(0, 60)) {
      if (HEADER.test(line)) continue;
      // Strip day-of-week groups ("Mon/Wed", "Tue, Thu", "MWF", "TTh") — the import lands on today's horizon.
      const DAY = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day)?';
      const cleaned = line
        .replace(new RegExp(`^\\s*(?:${DAY}(?:\\s*[/,&+]\\s*|\\s+and\\s+|\\s+))+(?=\\S)`, 'i'), '')
        .replace(/\b(?:mwf|tth|mw|tr|m\/w\/f|t\/th)\b/gi, '')
        .replace(/^[\s/,&+\-–:]+/, '');
      const p = parseCommand(cleaned);
      if (!p.text || p.text.length < 2) continue;
      out.push({
        text: p.text.slice(0, 120),
        category: p.category || 'focus',
        scheduledHour: p.hour,
        scheduledMinute: p.hour === null ? null : (p.minute ?? 0),
        durationMin: p.duration,
        people: p.people || null
      });
    }
    return out;
  }

  /** "18:05" -> "6:05 PM"; (18, 0) -> "6:00 PM" */
  function formatTime(hour, minute = 0) {
    const h = hour % 12 || 12;
    const mm = String(minute || 0).padStart(2, '0');
    return `${h}:${mm} ${hour < 12 ? 'AM' : 'PM'}`;
  }

  /** 95 -> "1h 35m", 45 -> "45m" */
  function formatDuration(mins) {
    if (!mins) return '';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  window.VisionaryParse = Object.freeze({ parseCommand, parseScheduleText, parseDuration, parseTimeToken, formatTime, formatDuration, TIME_RE });
})();
