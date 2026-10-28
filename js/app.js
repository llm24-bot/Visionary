// @ts-check
// ============================================
// VISIONARY 5.0 — "OS"
// Cloud-synced with Supabase, plus a local demo mode.
//
// Module map (all plain scripts, loaded in order from index.html):
//   js/parse.js      natural-language command + pasted-schedule parsing
//   js/scheduler.js  free-slot search, smart buffers, hour scoring
//   js/momentum.js   Momentum Grace, nudges, offline micro-steps
//   js/shield.js     ambient sound + full-screen focus state
//   js/app.js        (this file) state, data access, rendering, interactions
//   js/stopwatch.js  count-up stopwatch with laps
//   js/booking.js    owner-side booking links; book.html + js/book.js is the public page
// ============================================

const APP_VERSION = '5.0';
const Parse = window.VisionaryParse;
const Sched = window.VisionaryScheduler;
const Momentum = window.VisionaryMomentum;
const Shield = window.VisionaryShield;
const CATEGORIES = ['focus', 'health', 'learn', 'build', 'rest'];
const LIMITS = Object.freeze({ task: 200, note: 1000 });
const CATEGORY_LABELS = { focus: 'Focus', health: 'Health', learn: 'Learn', build: 'Build', rest: 'Rest' };

// --- Helpers ---
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const yesterdayISO = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d); };
const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } }
};

// --- State ---
const state = {
  tasks: [],
  streak: 0,
  longestStreak: 0,
  lastCompleteDate: null,
  history: [],
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  selectedCategory: 'focus',
  currentView: 'today',
  analyticsPeriod: 7,
  currentUser: null,
  demo: false,
  /** Past tasks (last 26 weeks) for correlation charts and hour scoring. */
  pastTasks: [],
  graceDays: 0,
  lastGraceDate: null,
  /** Per-user preferences (mirrored to profiles.settings when signed in). */
  settings: { autoBuffers: true, nudges: true, ambient: 'rain' },
  /** True once the user has clicked a category chip this session; before that the parser may guess the category. */
  categoryTouched: false
};

const els = {
  taskInput: $('task-input'),
  addBtn: $('add-btn'),
  taskList: $('task-list'),
  emptyState: $('empty-state'),
  streakCount: $('streak-count'),
  completedCount: $('completed-count'),
  totalCount: $('total-count'),
  progressPercent: $('progress-percent'),
  progressBar: $('progress-bar'),
  progressRing: $('progress-ring'),
  focusMinutes: $('focus-minutes'),
  timelineContainer: $('timeline-container'),
  dateDisplay: $('date-display'),
  greeting: $('greeting'),
  nowTime: $('now-time'),
  horizon: $('horizon'),
  horizonLeft: $('horizon-left'),
  nextUp: $('next-up'),
  reflectModal: $('reflect-modal'),
  reflectDone: $('reflect-done'),
  reflectTotal: $('reflect-total'),
  reflectRate: $('reflect-rate'),
  energySlider: $('energy-slider'),
  focusSlider: $('focus-slider'),
  energyVal: $('energy-val'),
  focusVal: $('focus-val'),
  reflectNote: $('reflect-note'),
  reflectSave: $('reflect-save'),
  analyticsEmpty: $('analytics-empty'),
  historyList: $('history-list'),
  historyListEmpty: $('history-list-empty'),
  historyDetailDate: $('history-detail-date'),
  historyDetailSummary: $('history-detail-summary'),
  historyDetailBody: $('history-detail-body'),
  copyToTodayBtn: $('copy-to-today-btn'),
  aiSuggestBtn: $('ai-suggest-btn'),
  aiSuggestLabel: $('ai-suggest-label'),
  aiInsightArea: $('ai-insight-area'),
  aiInsightText: $('ai-insight-text'),
  aiSlot: $('ai-slot')
};

let chartCompletion = null;
let chartCategory = null;
let chartEnergy = null;
let chartEnergyCat = null;
let chartHours = null;
let selectedHistoryDate = null;
let currentLoadedDate = todayISO();
let bootstrapping = false;
let initialized = false;
let timelineScrolled = false;

// ============================================
// Demo database — a tiny local stand-in for the Supabase query builder
// ============================================
function createDemoDb() {
  // Demo data lives in memory only, so every demo starts from the same fresh sample.
  let data = seedDemoData();
  const save = () => {};
  try { localStorage.removeItem('visionary-demo-v4'); localStorage.removeItem('visionary-focus-demo'); } catch { /* ignore */ }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  class Query {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.sort = null; this.one = false; this.payload = null; this.opts = {}; }
    select() { return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    upsert(p, o = {}) { this.op = 'upsert'; this.payload = p; this.opts = o; return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    neq(k, v) { this.filters.push([k, v, 'neq']); return this; }
    gte(k, v) { this.filters.push([k, v, 'gte']); return this; }
    lte(k, v) { this.filters.push([k, v, 'lte']); return this; }
    in(k, list) { this.filters.push([k, list, 'in']); return this; }
    is(k, v) { this.filters.push([k, v, 'is']); return this; }
    limit(n) { this.max = n; return this; }
    order(k, o = {}) { this.sort = [k, o.ascending !== false]; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; this.soft = true; return this; }
    then(resolve) {
      try { resolve(this.run()); } catch (error) { resolve({ data: null, error }); }
    }
    run() {
      const rows = (data[this.table] ||= []);
      const match = (r) => this.filters.every(([k, v, op]) => {
        if (op === 'neq') return String(r[k]) !== String(v);
        if (op === 'gte') return String(r[k]) >= String(v);
        if (op === 'lte') return String(r[k]) <= String(v);
        if (op === 'in') return (v || []).map(String).includes(String(r[k]));
        if (op === 'is') return v === null ? (r[k] === null || r[k] === undefined) : r[k] === v;
        return String(r[k]) === String(v);
      });
      const finish = (list) => {
        let out = clone(list);
        if (this.max) out = out.slice(0, this.max);
        if (this.one) return out[0] ? { data: out[0], error: null } : { data: null, error: this.soft ? null : { message: 'Row not found' } };
        return { data: out, error: null };
      };
      if (this.op === 'select') {
        let out = rows.filter(match);
        if (this.sort) {
          const [k, asc] = this.sort;
          out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        }
        return finish(out);
      }
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(p => ({ id: uid(), created_at: new Date().toISOString(), ...p }));
        rows.push(...list); save();
        return finish(list);
      }
      if (this.op === 'update') {
        const hit = rows.filter(match); hit.forEach(r => Object.assign(r, this.payload)); save();
        return finish(hit);
      }
      if (this.op === 'delete') {
        const gone = rows.filter(match).map(r => String(r.id));
        data[this.table] = rows.filter(r => !match(r));
        // Mirror the database cascade: micro-steps go with their parent.
        if (this.table === 'tasks') data.tasks = data.tasks.filter(r => !gone.includes(String(r.parent_id)));
        save();
        return { data: null, error: null };
      }
      if (this.op === 'upsert') {
        const keys = (this.opts.onConflict || 'id').split(',').map(s => s.trim());
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const out = [];
        list.forEach(p => {
          const existing = rows.find(r => keys.every(k => String(r[k]) === String(p[k])));
          if (existing) { if (!this.opts.ignoreDuplicates) Object.assign(existing, p); out.push(existing); }
          else { const row = { id: p.id || uid(), created_at: new Date().toISOString(), ...p }; rows.push(row); out.push(row); }
        });
        save();
        return finish(out);
      }
      return { data: null, error: { message: 'Unsupported demo op' } };
    }
  }
  return { from: (table) => new Query(table), reset() { data = seedDemoData(); save(); } };
}

function seedDemoData() {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pool = {
    focus: ['Deep work: API routes', 'Inbox zero', 'Plan tomorrow', 'Write project spec'],
    health: ['Gym — push day', '20 min walk', 'Meal prep', 'Stretch + mobility'],
    learn: ['Calculus problem set', 'Digital logic notes', 'Read 20 pages', 'RAG tutorial'],
    build: ['Ship Visionary feature', 'Fix auth bug', 'Refactor timeline', 'Deploy to prod'],
    rest: ['No-screen hour', 'Call family', 'Early lights out']
  };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const user = 'demo';
  const tasks = [];
  const reflections = [];
  const today = new Date();
  for (let back = 60; back >= 1; back--) {
    if (rand() < 0.16) continue;
    const d = new Date(today); d.setDate(d.getDate() - back);
    const date = isoOf(d);
    const total = 3 + Math.floor(rand() * 5);
    const energy = 3 + Math.floor(rand() * 7);
    const heavyPenalty = total > 5 ? 0.25 : 0;
    const p = Math.min(0.97, 0.45 + energy * 0.05 - heavyPenalty + rand() * 0.15);
    const cats = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
    let done = 0;
    for (let i = 0; i < total; i++) {
      const c = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
      const completed = rand() < p;
      if (completed) { done++; cats[c]++; }
      tasks.push({ id: `seed-${date}-${i}`, user_id: user, text: pick(pool[c]), category: c, completed, date, scheduled_hour: rand() < 0.6 ? 7 + Math.floor(rand() * 14) : null, created_at: `${date}T0${Math.floor(rand() * 9)}:00:00.000Z` });
    }
    reflections.push({ id: `r-${date}`, user_id: user, date, total, completed: done, rate: done / total, energy, focus: Math.max(1, Math.min(10, energy + Math.round(rand() * 4 - 2))), note: rand() < 0.3 ? pick(['Morning gym made everything easier.', 'Too many tasks — felt scattered.', 'Locked in after lunch.', 'Slept late, slow start.', 'Shipped something real today.']) : '', categories: cats, created_at: `${date}T22:00:00.000Z` });
  }
  const t = todayISO();
  const nowH = new Date().getHours();
  const todays = [
    ['Gym — push day', 'health', Math.max(6, nowH - 3), 0, 60, true, 'Aryan'],
    ['Digital logic notes', 'learn', Math.max(7, nowH - 1), 30, 45, true, null],
    ['Ship Visionary feature', 'build', Math.min(22, nowH + 1), 0, 90, false, null],
    ['Calculus problem set', 'learn', Math.min(23, nowH + 3), 15, 60, false, null],
    ['Plan tomorrow', 'focus', null, null, null, false, null],
    ['No-screen hour', 'rest', null, null, 60, false, null]
  ];
  todays.forEach(([text, category, hour, minute, duration, completed, people], i) => tasks.push({ id: `today-${i}`, user_id: user, text, category, completed, date: t, scheduled_hour: hour, scheduled_minute: hour === null ? null : minute, duration_min: duration, kind: 'task', people, parent_id: null, created_at: new Date(Date.now() - (10 - i) * 60000).toISOString() }));
  const sessions = [];
  for (let back = 12; back >= 1; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const category = CATEGORIES[Math.floor(rand() * 4)];
      const early = category === 'learn' ? rand() < 0.7 : rand() < 0.2;
      const minutes = early ? 35 + Math.floor(rand() * 20) : 25;
      sessions.push({ id: `s-${back}-${i}`, user_id: user, date: isoOf(d), label: pick(pool[category]), category, seconds: minutes * 60, mode: 'timer', completed: !early, note: null, started_at: `${isoOf(d)}T${pad(9 + i * 3)}:00:00.000Z` });
    }
  }
  const bookingPage = { id: 'bp-demo', user_id: user, slug: 'alex-demo', title: 'Office hours with Alex', duration_min: 30, buffer_min: 10, start_hour: 10, end_hour: 17, days: [1, 2, 3, 4, 5], horizon_days: 14, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', active: true, created_at: `${isoOf(new Date(today.getTime() - 20 * 86400000))}T12:00:00.000Z`, updated_at: `${isoOf(new Date(today.getTime() - 20 * 86400000))}T12:00:00.000Z` };
  const nextDay = (n, h, m) => { const d = new Date(today); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d; };
  const bookingRequests = [
    { id: 'br-1', page_id: 'bp-demo', user_id: user, requester_name: 'Priya N.', requester_email: 'priya@example.com', starts_at: nextDay(2, 14, 0).toISOString(), duration_min: 30, note: 'Quick review of the compiler project plan.', status: 'pending', created_at: new Date(Date.now() - 3 * 3600000).toISOString() },
    { id: 'br-2', page_id: 'bp-demo', user_id: user, requester_name: 'Marcus D.', requester_email: 'marcus@example.com', starts_at: nextDay(3, 11, 30).toISOString(), duration_min: 30, note: null, status: 'pending', created_at: new Date(Date.now() - 26 * 3600000).toISOString() },
    { id: 'br-0', page_id: 'bp-demo', user_id: user, requester_name: 'Sam O.', requester_email: 'sam@example.com', starts_at: nextDay(-4, 15, 0).toISOString(), duration_min: 30, note: null, status: 'accepted', created_at: new Date(Date.now() - 6 * 86400000).toISOString() }
  ];
  return {
    tasks,
    reflections,
    focus_sessions: sessions,
    booking_pages: [bookingPage],
    booking_requests: bookingRequests,
    profiles: [{ id: user, streak: 4, longest_streak: 11, last_complete_date: yesterdayISO(), grace_days: 1, last_grace_date: null, settings: {} }]
  };
}

let demoDb = null;
const db = () => (state.demo ? (demoDb ||= createDemoDb()) : supabaseClient);
window.visionaryDb = db;
window.visionaryCurrentUser = () => state.currentUser;

// --- Date helpers ---
function parseAppDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatAppDateLabel(value, options = { month: 'short', day: 'numeric' }) {
  const date = parseAppDate(value);
  return date ? date.toLocaleDateString('en-US', options) : '—';
}

function sortByAppDateAsc(items = []) {
  return [...items].sort((a, b) => (parseAppDate(a.date)?.getTime() ?? 0) - (parseAppDate(b.date)?.getTime() ?? 0));
}

// --- normalizeTask: single source of truth for mapping a DB row to app state ---
/**
 * @typedef {Object} Task
 * @property {string|number} id
 * @property {string} text
 * @property {string} category
 * @property {boolean} completed
 * @property {number|null} scheduledHour
 * @property {number|null} scheduledMinute
 * @property {number|null} durationMin
 * @property {'task'|'microstep'|'buffer'|'booking'} kind
 * @property {string|number|null} parentId
 * @property {string|null} people
 * @property {string|null} note
 * @property {string} date
 * @property {number} createdAt
 * @property {number|null} completedAt
 */

/** @param {any} t @returns {Task} */
function normalizeTask(t) {
  const hour = Number.isInteger(t.scheduled_hour) ? t.scheduled_hour : null;
  return {
    id: t.id,
    text: t.text,
    category: CATEGORIES.includes(t.category) ? t.category : 'focus',
    completed: !!t.completed,
    scheduledHour: hour,
    scheduledMinute: hour === null ? null : (Number.isInteger(t.scheduled_minute) ? t.scheduled_minute : 0),
    durationMin: Number.isInteger(t.duration_min) && t.duration_min > 0 ? t.duration_min : null,
    kind: ['task', 'microstep', 'buffer', 'booking'].includes(t.kind) ? t.kind : 'task',
    parentId: t.parent_id ?? null,
    people: t.people || null,
    note: t.note || null,
    date: t.date || todayISO(),
    createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null
  };
}

/** Start time in minutes from midnight, or null. */
const startMinutes = (t) => (t.scheduledHour === null ? null : t.scheduledHour * 60 + (t.scheduledMinute || 0));
/** Tasks that count toward progress (micro-steps roll up into their parent; buffers never count). */
const countable = (t) => t.kind !== 'buffer' && t.kind !== 'microstep';
const topLevel = (t) => t.kind !== 'microstep';

// "gym with Aryan at 6pm for 45 mins" -> { text, hour, minute, duration, people, dateOffset, ... }
function parseTaskInput(raw) {
  const p = Parse.parseCommand(raw);
  return { text: p.text, hour: p.hour, minute: p.minute, duration: p.duration, people: p.people, dateOffset: p.dateOffset, intent: p.intent, category: p.category, part: p.part, after: p.after, before: p.before };
}

// ============================================
// Init
// ============================================
function init() {
  if (initialized) return;
  initialized = true;
  applyTheme(state.theme, false);
  buildDialTicks();
  renderDate();
  attachEventListeners();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  if ($('cmdk-kbd')) $('cmdk-kbd').textContent = isMac ? '⌘ K' : 'Ctrl K';

  // Keep the clock, horizon and now-line alive
  setInterval(() => {
    renderDate();
    renderHorizon();
    positionNowLine();
    maybeNudge();
  }, 30000);

  // Reload data when the calendar day rolls over
  setInterval(async () => {
    if (todayISO() !== currentLoadedDate) {
      currentLoadedDate = todayISO();
      if (state.currentUser) { await loadAllData(); renderAll(); }
    }
  }, 60000);

  // Background refresh every 60s when tab is visible (skipped while editing)
  setInterval(async () => {
    if (document.visibilityState === 'visible' && state.currentUser && !state.demo && !isEditing()) {
      await loadTasks();
      renderToday();
    }
  }, 60000);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.currentUser && !isEditing()) {
      await loadAllData();
      renderAll();
    }
  });

  renderAll();
}

const isEditing = () => document.activeElement?.matches?.('.task-text[contenteditable="true"], .import-row input');

// --- Auth bridge ---
window.visionaryOnSignedIn = async function (user) {
  if (bootstrapping) return;
  bootstrapping = true;
  try {
    state.currentUser = user;
    currentLoadedDate = todayISO();
    renderUser();
    await ensureProfile(user.id);
    await loadAllData();
    renderAll();
    maybeShowWhatsNew();
    setTimeout(() => maybeNudge(), 4000);
    const studioLink = $('studio-link');
    if (studioLink) studioLink.hidden = true;
    if (!state.demo) window.visionaryRefreshStudioAccess?.();
  } finally {
    bootstrapping = false;
  }
};

window.visionaryOnSignedOut = function () {
  clearInterval(focus.timer);
  focus.running = false;
  focus.remaining = focus.duration;
  window.visionaryResetStopwatch?.();
  state.currentUser = null;
  state.tasks = [];
  state.history = [];
  state.streak = 0;
  state.longestStreak = 0;
  state.lastCompleteDate = null;
  state.pastTasks = [];
  state.graceDays = 0;
  state.lastGraceDate = null;
  selectedHistoryDate = null;
  timelineScrolled = false;
  slotCache = { date: null, tasks: [] };
  Shield.stop();
  if (Shield.isZen()) Shield.exitZen();
  renderAll();
};

window.visionaryIsDemo = () => state.demo;
window.visionaryStartDemo = async function () {
  demoDb = null;          // always start from the original sample data
  demoSessions = [];
  state.demo = true;
  document.body.classList.add('is-demo');
  window.showApp?.();
  await window.visionaryOnSignedIn({ id: 'demo', email: 'demo@visionary.app' });
  toast('Welcome to the demo. Try anything — it resets when you leave.');
};
window.visionaryExitDemo = function () {
  demoDb = null;
  demoSessions = [];
  state.demo = false;
  document.body.classList.remove('is-demo');
  window.visionaryOnSignedOut();
};

function renderUser() {
  const u = state.currentUser;
  const name = state.demo ? 'Demo explorer' : (u?.user_metadata?.full_name || u?.email || 'Signed in');
  $('user-name').textContent = name;
  $('user-avatar').textContent = (name[0] || 'V').toUpperCase();
  $('user-mode').textContent = state.demo ? 'Local demo' : 'Cloud sync on';
  $('demo-badge').classList.toggle('hidden', !state.demo);
}

// ============================================
// Data loading
// ============================================
async function ensureProfile(userId) {
  const payload = { id: userId, streak: 0, longest_streak: 0, last_complete_date: null };
  const { error } = await db().from('profiles').upsert(payload, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.error('Profile bootstrap failed:', error);
}

async function loadAllData() {
  if (!state.currentUser) return;
  await Promise.all([loadTasks(), loadProfile(), loadHistory(), loadPastTasks(), loadCloudSessions()]);
}

/** Last 26 weeks of tasks (minus today) for hour scoring and correlation charts. */
async function loadPastTasks() {
  if (!state.currentUser) return;
  const since = new Date(); since.setDate(since.getDate() - 26 * 7);
  const { data, error } = await db()
    .from('tasks')
    .select('id, text, category, completed, date, scheduled_hour, scheduled_minute, duration_min, kind')
    .eq('user_id', state.currentUser.id)
    .gte('date', isoOf(since))
    .neq('date', todayISO())
    .order('date', { ascending: true })
    .limit(2000);
  if (error) { console.warn('Past tasks unavailable:', error.message); state.pastTasks = []; return; }
  state.pastTasks = (data || []).map(normalizeTask);
}

async function loadTasks() {
  if (!state.currentUser) return;
  const { data, error } = await db()
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', todayISO())
    .order('created_at', { ascending: true });
  if (error) { console.error('Failed to load tasks:', error); return; }
  state.tasks = (data || []).map(normalizeTask);
}

async function loadProfile() {
  if (!state.currentUser) return;
  const { data, error } = await db().from('profiles').select('*').eq('id', state.currentUser.id).single();
  if (error) { console.error('Failed to load profile:', error); return; }
  state.streak = data?.streak || 0;
  state.longestStreak = data?.longest_streak || 0;
  state.lastCompleteDate = data?.last_complete_date || null;
  state.graceDays = data?.grace_days || 0;
  state.lastGraceDate = data?.last_grace_date || null;
  const saved = data?.settings && typeof data.settings === 'object' ? data.settings : {};
  state.settings = { ...state.settings, ...store.get(settingsKey(), {}), ...saved };
  syncSettingsUI();
}

/** Mirror persisted settings into the toggles and ambient buttons. */
function syncSettingsUI() {
  document.querySelectorAll('[data-setting]').forEach(el => {
    const input = /** @type {HTMLInputElement} */ (el);
    input.checked = Boolean(state.settings[input.dataset.setting || '']);
  });
  document.querySelectorAll('[data-ambient]').forEach(b => b.setAttribute('aria-pressed', String((/** @type {HTMLElement} */ (b)).dataset.ambient === (Shield.current() || 'off'))));
}

const settingsKey = () => `visionary-settings-${state.currentUser?.id || 'anon'}`;
async function saveSetting(key, value) {
  state.settings[key] = value;
  store.set(settingsKey(), state.settings);
  if (!state.currentUser) return;
  const { error } = await db().from('profiles').update({ settings: state.settings }).eq('id', state.currentUser.id);
  if (error) console.warn('Settings not synced (older database schema?):', error.message);
}

async function loadHistory() {
  if (!state.currentUser) return;
  const { data, error } = await db()
    .from('reflections')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('date', { ascending: false });
  if (error) { console.error('Failed to load history:', error); return; }
  state.history = (data || []).map(h => ({
    date: h.date,
    timestamp: h.created_at ? new Date(h.created_at).getTime() : Date.now(),
    total: h.total || 0,
    completed: h.completed || 0,
    rate: Number(h.rate || 0),
    energy: Number(h.energy || 0),
    focus: Number(h.focus || 0),
    note: h.note || '',
    categories: h.categories || {},
    grace: !!h.grace
  }));
}

// ============================================
// Events
// ============================================
function attachEventListeners() {
  els.addBtn?.addEventListener('click', handleAdd);
  els.taskInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });

  document.querySelectorAll('#category-chips .chip').forEach(chip => chip.addEventListener('click', () => { state.categoryTouched = true; setCategory(chip.dataset.value); }));

  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('[data-view-link]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); switchView(a.dataset.viewLink); }));

  document.querySelectorAll('.period-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.analyticsPeriod = btn.dataset.period === 'all' ? 9999 : parseInt(btn.dataset.period, 10);
    renderAnalytics();
  }));

  ['theme-toggle', 'theme-toggle-m'].forEach(id => $(id)?.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark')));
  ['logout-btn', 'logout-btn-m'].forEach(id => $(id)?.addEventListener('click', () => { if (confirm(state.demo ? 'Leave the demo?' : 'Log out?')) logout(); }));
  ['reflect-btn', 'reflect-btn-mobile'].forEach(id => $(id)?.addEventListener('click', openReflection));
  ['cmdk-open', 'cmdk-open-m'].forEach(id => $(id)?.addEventListener('click', openPalette));

  $('reflect-close')?.addEventListener('click', closeReflection);
  els.reflectModal?.addEventListener('click', (e) => { if (e.target === els.reflectModal) closeReflection(); });
  els.energySlider?.addEventListener('input', () => { els.energyVal.textContent = els.energySlider.value; });
  els.focusSlider?.addEventListener('input', () => { els.focusVal.textContent = els.focusSlider.value; });
  els.reflectSave?.addEventListener('click', saveReflection);
  els.copyToTodayBtn?.addEventListener('click', () => { if (selectedHistoryDate) copyDayToToday(selectedHistoryDate); });

  els.aiSuggestBtn?.addEventListener('click', handleAISuggest);
  $('schedule-image-input')?.addEventListener('change', handleScheduleImageUpload);
  $('jump-now')?.addEventListener('click', () => scrollTimelineToNow(true));

  // Import modal
  $('import-close')?.addEventListener('click', closeImport);
  $('import-cancel')?.addEventListener('click', closeImport);
  $('import-confirm')?.addEventListener('click', confirmImport);
  $('import-modal')?.addEventListener('click', (e) => { if (e.target.id === 'import-modal') closeImport(); });

  // What's new
  $('whatsnew-btn')?.addEventListener('click', openWhatsNew);
  ['whatsnew-close', 'whatsnew-ok'].forEach(id => $(id)?.addEventListener('click', closeWhatsNew));
  $('whatsnew-modal')?.addEventListener('click', (e) => { if (e.target.id === 'whatsnew-modal') closeWhatsNew(); });

  // Focus timer
  ['hours', 'minutes', 'seconds'].forEach((unit) => {
    const select = $(`timer-${unit}`);
    const count = unit === 'hours' ? 100 : 60;
    for (let n = 0; n < count; n++) select.add(new Option(pad(n), String(n)));
    select.addEventListener('change', () => setTimerSeconds(
      Number($('timer-hours').value) * 3600 + Number($('timer-minutes').value) * 60 + Number($('timer-seconds').value)
    ));
  });
  const savedSeconds = store.get('visionary-timer-seconds');
  const oldMinutes = store.get('visionary-focus-length');
  setTimerSeconds(Number.isInteger(savedSeconds) ? savedSeconds : (Number(oldMinutes) || 25) * 60);
  $('focus-start')?.addEventListener('click', toggleFocus);
  $('focus-reset')?.addEventListener('click', resetFocus);
  $('focus-task')?.addEventListener('change', (e) => { focus.taskId = e.target.value || null; });

  // Distraction shield: ambient audio, full-screen focus, session journal
  document.querySelectorAll('[data-ambient]').forEach(btn => btn.addEventListener('click', () => setAmbient(/** @type {HTMLElement} */ (btn).dataset.ambient || 'off')));
  $('zen-toggle')?.addEventListener('click', () => { Shield.isZen() ? Shield.exitZen() : Shield.enterZen(); });
  $('zen-exit')?.addEventListener('click', () => Shield.exitZen());
  $('journal-save')?.addEventListener('click', () => saveJournal(true));
  $('journal-skip')?.addEventListener('click', () => saveJournal(false));
  $('journal-modal')?.addEventListener('click', (e) => { if (/** @type {HTMLElement} */ (e.target).id === 'journal-modal') saveJournal(false); });
  $('journal-note')?.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveJournal(true); });

  // Settings toggles (Account modal)
  document.querySelectorAll('[data-setting]').forEach(el => {
    const input = /** @type {HTMLInputElement} */ (el);
    const key = input.dataset.setting || '';
    input.checked = Boolean(state.settings[key]);
    input.addEventListener('change', () => saveSetting(key, input.checked));
  });

  // Text import + clipboard / drag-and-drop
  $('import-text-btn')?.addEventListener('click', openTextImport);
  $('import-parse')?.addEventListener('click', parsePastedText);
  bindImportShortcuts();

  // Command palette
  $('cmdk')?.addEventListener('click', (e) => { if (e.target.id === 'cmdk') closePalette(); });
  $('cmdk-input')?.addEventListener('input', renderPalette);
  $('cmdk-input')?.addEventListener('keydown', onPaletteKey);

  document.addEventListener('keydown', (e) => {
    const appVisible = $('app-shell')?.style.display === 'block';
    if (!appVisible) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('cmdk').classList.contains('open') ? closePalette() : openPalette(); return; }
    if (e.key === 'Escape') {
      if ($('cmdk').classList.contains('open')) return closePalette();
      if (els.reflectModal.classList.contains('open')) return closeReflection();
      if ($('import-modal').classList.contains('open')) return closeImport();
      if ($('whatsnew-modal').classList.contains('open')) return closeWhatsNew();
      if ($('journal-modal')?.classList.contains('open')) return saveJournal(false);
      if (Shield.isZen()) return Shield.exitZen();
    }
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.modal-backdrop.open, .cmdk-backdrop.open')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n') { e.preventDefault(); switchView('today'); els.taskInput?.focus(); }
    const views = { 1: 'today', 2: 'focus', 3: 'history', 4: 'analytics' };
    if (views[e.key]) switchView(views[e.key]);
  });
}

function setCategory(value) {
  state.selectedCategory = value;
  document.querySelectorAll('#category-chips .chip').forEach(c => {
    const on = c.dataset.value === value;
    c.classList.toggle('active', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

// ============================================
// Render
// ============================================
function renderAll() {
  renderDate();
  renderToday();
  renderFocusPanel();
  if (state.currentView === 'history') renderHistoryList();
  if (state.currentView === 'analytics') renderAnalytics();
}

function renderToday() {
  renderTasks();
  renderTimeline();
  renderStats();
  renderHorizon();
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'today') requestAnimationFrame(() => { positionNowLine(); if (!timelineScrolled) scrollTimelineToNow(); });
  if (view === 'focus') renderFocusPanel();
  if (view === 'history') renderHistoryList();
  if (view === 'analytics') renderAnalytics();
}

function renderDate() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Winding down';
  const first = state.demo ? '' : (state.currentUser?.user_metadata?.full_name || '').split(' ')[0];
  els.greeting.textContent = first ? `${greeting}, ${first}` : greeting;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const rest = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  els.dateDisplay.innerHTML = `${weekday}, <em>${rest}</em>`;
  els.nowTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function applyTheme(theme, rerender = true) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('visionary-theme', theme); } catch { /* ignore */ }
  const icon = theme === 'dark' ? '#i-sun' : '#i-moon';
  document.querySelectorAll('#theme-icon use, .theme-icon-m use').forEach(u => u.setAttribute('href', icon));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c0d10' : '#f3f0e8');
  if (rerender) { renderHorizon(); if (state.currentView === 'analytics') renderAnalytics(); }
}

// --- Horizon arc ---
const HZ = { w: 640, cx: 320, base: 136, rx: 292, ry: 112 };
// Match the drawing to the card's real shape so the arc spans the full width.
function sizeHorizon(svg) {
  const w = svg.clientWidth, h = svg.clientHeight;
  HZ.w = w && h ? Math.max(420, Math.round((170 * w) / h)) : 640;
  HZ.cx = HZ.w / 2;
  HZ.rx = HZ.w / 2 - 22;
  svg.setAttribute('viewBox', `0 0 ${HZ.w} 170`);
}
let horizonResizeBound = false;
function arcPoint(hourFloat) {
  const t = Math.max(0, Math.min(24, hourFloat)) / 24;
  const a = Math.PI * (1 - t);
  return { x: HZ.cx + HZ.rx * Math.cos(a), y: HZ.base - HZ.ry * Math.sin(a) };
}

function renderHorizon() {
  const svg = els.horizon;
  if (!svg) return;
  sizeHorizon(svg);
  if (!horizonResizeBound && window.ResizeObserver) {
    horizonResizeBound = true;
    let last = svg.clientWidth;
    new ResizeObserver(() => { if (Math.abs(svg.clientWidth - last) > 4) { last = svg.clientWidth; renderHorizon(); } }).observe(svg);
  }
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const start = arcPoint(0);
  const end = arcPoint(24);
  const sun = arcPoint(nowH);
  const catColor = (c) => `var(--cat-${c})`;

  const ticks = [0, 6, 12, 18, 24].map(h => {
    const p = arcPoint(h);
    const lbl = h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
    return `<line x1="${p.x.toFixed(1)}" y1="${HZ.base}" x2="${p.x.toFixed(1)}" y2="${HZ.base + 5}" class="ground"/><text x="${p.x.toFixed(1)}" y="${HZ.base + 20}" text-anchor="middle" class="tick-label">${lbl}</text>`;
  }).join('');

  const scheduled = state.tasks.filter(t => t.scheduledHour !== null && topLevel(t)).sort((a, b) => (startMinutes(a) || 0) - (startMinutes(b) || 0));
  // Duration blocks are drawn as arc segments just above the horizon line.
  const spans = scheduled.filter(t => t.durationMin).map(t => {
    const s = (startMinutes(t) || 0) / 60, e = Math.min(24, s + t.durationMin / 60);
    const a = arcPoint(s), b = arcPoint(e);
    const large = e - s > 12 ? 1 : 0;
    return `<path class="task-span ${t.kind === 'buffer' ? 'buffer' : ''} ${t.completed ? 'done' : ''}" stroke="${catColor(t.category)}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} A${HZ.rx} ${HZ.ry} 0 ${large} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}"><title>${escapeHtml(Parse.formatTime(t.scheduledHour, t.scheduledMinute || 0))} · ${escapeHtml(Parse.formatDuration(t.durationMin))} · ${escapeHtml(t.text)}</title></path>`;
  }).join('');
  let lastX = -99, stack = 0;
  const dots = scheduled.filter(t => t.kind !== 'buffer').map(t => {
    const p = arcPoint((startMinutes(t) || 0) / 60);
    stack = Math.abs(p.x - lastX) < 12 ? stack + 1 : 0;
    lastX = p.x;
    const off = stack * 13;
    // Stack tasks that start close together slightly inward (toward the center)
    const dx = (HZ.cx - p.x), dy = (HZ.base - p.y);
    const len = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / len) * off, y = p.y + (dy / len) * off;
    const fill = t.completed ? catColor(t.category) : 'var(--surface)';
    return `<circle class="task-dot ${t.completed ? 'done' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${fill}" stroke="${catColor(t.category)}"><title>${escapeHtml(Parse.formatTime(t.scheduledHour, t.scheduledMinute || 0))} · ${escapeHtml(t.text)}</title></circle>`;
  }).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="pastGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".15"/><stop offset="1" stop-color="var(--accent)"/></linearGradient>
    </defs>
    <line x1="0" y1="${HZ.base}" x2="${HZ.w}" y2="${HZ.base}" class="ground"/>
    <path class="arc-future" d="M${start.x} ${HZ.base} A${HZ.rx} ${HZ.ry} 0 0 1 ${end.x} ${HZ.base}"/>
    <path class="arc-past" stroke="url(#pastGrad)" d="M${start.x} ${HZ.base} A${HZ.rx} ${HZ.ry} 0 0 1 ${sun.x.toFixed(2)} ${sun.y.toFixed(2)}"/>
    ${ticks}
    ${spans}
    ${dots}
    <circle class="sun-halo" cx="${sun.x.toFixed(1)}" cy="${sun.y.toFixed(1)}" r="16"/>
    <circle class="sun-core" cx="${sun.x.toFixed(1)}" cy="${sun.y.toFixed(1)}" r="7"/>
  `;

  const minsLeft = Math.max(0, (24 - nowH) * 60);
  const hL = Math.floor(minsLeft / 60), mL = Math.round(minsLeft % 60);
  els.horizonLeft.innerHTML = now.getHours() >= 22 || now.getHours() < 4
    ? 'The day is almost done. <em>Rest well.</em>'
    : `<em>${hL}h ${mL}m</em> of today left`;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const real = state.tasks.filter(countable);
  const upcoming = real.filter(t => !t.completed && startMinutes(t) !== null && (startMinutes(t) || 0) + (t.durationMin || 0) >= nowMin).sort((a, b) => (startMinutes(a) || 0) - (startMinutes(b) || 0))[0];
  const anytime = real.find(t => !t.completed && t.scheduledHour === null);
  const overdue = real.filter(t => !t.completed && startMinutes(t) !== null && (startMinutes(t) || 0) + (t.durationMin || 0) < nowMin).length;
  if (upcoming) els.nextUp.textContent = `${Parse.formatTime(upcoming.scheduledHour, upcoming.scheduledMinute || 0)} · ${upcoming.text}${upcoming.people ? ` with ${upcoming.people}` : ''}`;
  else if (anytime) els.nextUp.textContent = `Anytime · ${anytime.text}`;
  else if (real.length && real.every(t => t.completed)) els.nextUp.textContent = 'All clear — nice work';
  else if (overdue) els.nextUp.textContent = `${overdue} earlier task${overdue > 1 ? 's' : ''} still open`;
  else els.nextUp.textContent = 'Nothing scheduled';
}

// --- Tasks ---
async function handleAdd() {
  const raw = els.taskInput.value.trim();
  if (!raw || !state.currentUser) return;
  // Until the user picks a chip themselves, let the parser's guess ("gym" → health, "read" → learn) win over the default.
  const ok = await createTask(raw, state.selectedCategory, { useGuess: !state.categoryTouched });
  if (ok) { els.taskInput.value = ''; els.taskInput.focus(); }
}

/**
 * Create a task from natural language ("gym with Aryan at 6pm for 45 mins").
 * @param {string} raw
 * @param {string} [category]  falls back to the parser's guess, then 'focus'
 * @param {{date?:string, hour?:number|null, minute?:number|null, duration?:number|null, kind?:string, parentId?:any, people?:string|null, silent?:boolean, useGuess?:boolean}} [opts]
 */
async function createTask(raw, category = 'focus', opts = {}) {
  const parsed = parseTaskInput(raw);
  const text = cleanInput(parsed.text, LIMITS.task);
  if (!text) { toast('Give the task a name first.', 'error'); return false; }
  const hour = opts.hour !== undefined ? opts.hour : parsed.hour;
  const minute = opts.minute !== undefined ? opts.minute : parsed.minute;
  const duration = opts.duration !== undefined ? opts.duration : parsed.duration;
  const people = opts.people !== undefined ? opts.people : parsed.people;
  const date = opts.date || offsetISO(parsed.dateOffset || 0);
  const cat = CATEGORIES.includes(category) && !(opts.useGuess && parsed.category) ? category : (parsed.category || 'focus');
  const row = { user_id: state.currentUser.id, text, category: cat, completed: false, date };
  if (hour !== null && hour !== undefined) { row.scheduled_hour = hour; row.scheduled_minute = minute || 0; }
  if (duration) row.duration_min = Math.min(1440, duration);
  if (people) row.people = cleanInput(people, 200);
  if (opts.kind && opts.kind !== 'task') row.kind = opts.kind;
  if (opts.parentId) row.parent_id = opts.parentId;
  const { data, error } = await insertTaskRow(row);
  if (error) { console.error('Add failed:', error); toast("Couldn't save that task. Check your connection.", 'error'); return false; }
  const task = normalizeTask(data);
  if (date === todayISO()) {
    state.tasks.push(task);
    if (state.settings.autoBuffers && task.scheduledHour !== null && task.kind === 'task') await maybeAddBuffer(task);
    renderToday();
    renderFocusPanel();
  }
  if (!opts.silent) {
    // Report the final time (buffer routing may have nudged the task).
    const when = task.scheduledHour !== null && task.scheduledHour !== undefined ? ` for ${Parse.formatTime(task.scheduledHour, task.scheduledMinute || 0)}` : '';
    const len = duration ? ` · ${Parse.formatDuration(duration)}` : '';
    const day = date === todayISO() ? '' : ` on ${formatAppDateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}`;
    // Gentle heads-up when the new block collides with something already on today's timeline.
    let clash = '';
    if (date === todayISO() && task.scheduledHour !== null && task.kind === 'task') {
      const blocks = Sched.busyIntervals(state.tasks.filter(t => !t.completed && t.kind !== 'microstep'));
      const me = blocks.find(b => String(b.id) === String(task.id));
      const hit = me && blocks.find(b => b !== me && b.kind !== 'buffer' && b.start < me.end && b.end > me.start);
      if (hit) clash = ` — overlaps “${hit.text}”`;
    }
    toast(`Added${when}${len}${day}${people ? ` with ${people}` : ''}${clash}`);
  }
  return task;
}

/**
 * Insert a task row. If the database predates the 5.0 migration, retry without
 * the new columns so adding tasks never breaks; the user is told once.
 */
let schemaWarned = false;
/** Show the Setup card in Account once the database is known to be behind. */
function flagSchemaOutdated() {
  schemaWarned = true;
  const sec = $('account-setup');
  if (sec) sec.hidden = false;
}
async function insertTaskRow(row) {
  let res = await db().from('tasks').insert(row).select().single();
  if (res.error && /column|schema cache/i.test(res.error.message || '')) {
    const legacy = { user_id: row.user_id, text: row.text, category: row.category, completed: false, date: row.date };
    if (row.scheduled_hour !== undefined) legacy.scheduled_hour = row.scheduled_hour;
    res = await db().from('tasks').insert(legacy).select().single();
    if (!res.error && !schemaWarned) { flagSchemaOutdated(); toast('Minute-level times need the 5.0 database update. See Account → Setup.', 'error'); }
  }
  return res;
}

const offsetISO = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return isoOf(d); };

/** Smart buffering: slot a short breather between deep work and social/physical blocks. */
async function maybeAddBuffer(task) {
  const blocks = Sched.busyIntervals(state.tasks.filter(t => t.kind !== 'microstep' && !t.completed));
  const me = blocks.find(b => String(b.id) === String(task.id));
  if (!me) return;
  const minutes = Sched.bufferLength(state.history.slice(0, 7));
  const others = blocks.filter(b => String(b.id) !== String(task.id));
  const prev = others.filter(b => b.end <= me.start + 1).sort((a, b) => b.end - a.end)[0];
  const next = others.filter(b => b.start >= me.end - 1).sort((a, b) => a.start - b.start)[0];
  const date = task.date || todayISO();
  const overlaps = (iv, list) => list.some(b => b.start < iv.end && b.end > iv.start);
  const insertBuffer = async (buf) => {
    const row = { user_id: state.currentUser.id, text: buf.text, category: buf.category, completed: false, date, scheduled_hour: Math.floor(buf.start / 60), scheduled_minute: buf.start % 60, duration_min: minutes, kind: 'buffer' };
    const { data, error } = await db().from('tasks').insert(row).select().single();
    if (!error && data) { state.tasks.push(normalizeTask(data)); return true; }
    return false;
  };

  // Case 1: the new block sits right after a block of the opposite kind -> shift it later to make room.
  const before = prev && Sched.bufferBetween(prev, me, { minutes });
  if (before) {
    if (prev.end === me.start) {
      const shifted = { start: me.start + minutes, end: me.end + minutes };
      if (shifted.end <= 1440 && !overlaps(shifted, others)) {
        await scheduleTask(task.id, Math.floor(shifted.start / 60), shifted.start % 60, { silent: true });
        me.start = shifted.start; me.end = shifted.end;
        if (await insertBuffer(before)) toast(`Moved “${task.text}” to ${Sched.label(shifted.start)} to leave a ${minutes}-minute ${before.category === 'rest' ? 'recovery' : 'travel'} buffer.`);
        return;
      }
    } else if (!overlaps(before, blocks)) {
      if (await insertBuffer(before)) toast(`Added a ${minutes}-minute buffer at ${Sched.label(before.start)}.`);
      return;
    }
  }
  // Case 2: the new block sits right before one -> pull it earlier if there is room, otherwise fit a buffer in the gap.
  const after = next && Sched.bufferBetween(me, next, { minutes });
  if (after) {
    if (me.end === next.start) {
      const shifted = { start: me.start - minutes, end: me.end - minutes };
      if (shifted.start >= 0 && !overlaps(shifted, others)) {
        await scheduleTask(task.id, Math.floor(shifted.start / 60), shifted.start % 60, { silent: true });
        const buf = { ...after, start: shifted.end, end: shifted.end + minutes };
        if (await insertBuffer(buf)) toast(`Moved “${task.text}” to ${Sched.label(shifted.start)} to leave a ${minutes}-minute ${after.category === 'rest' ? 'recovery' : 'travel'} buffer.`);
      }
    } else if (!overlaps(after, blocks)) {
      if (await insertBuffer(after)) toast(`Added a ${minutes}-minute buffer at ${Sched.label(after.start)}.`);
    }
  }
}

async function toggleTask(id) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;
  const newCompleted = !task.completed;
  // Optimistic update — feels instant, rolls back on failure
  task.completed = newCompleted;
  task.completedAt = newCompleted ? Date.now() : null;
  renderToday();
  const { error } = await db().from('tasks').update({ completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }).eq('id', id);
  if (error) {
    console.error('Toggle failed:', error);
    task.completed = !newCompleted;
    renderToday();
    toast("Couldn't update that task.", 'error');
    return;
  }
  // Micro-steps roll up: finishing the last step completes the parent; reopening a step reopens it.
  if (task.kind === 'microstep' && task.parentId) {
    const parent = state.tasks.find(t => String(t.id) === String(task.parentId));
    const siblings = state.tasks.filter(t => String(t.parentId) === String(task.parentId));
    if (parent && siblings.length && siblings.every(t => t.completed) !== parent.completed) await toggleTask(parent.id);
  }
  if (newCompleted && task.kind === 'task') {
    const open = state.tasks.filter(t => String(t.parentId) === String(task.id) && !t.completed);
    for (const step of open) { step.completed = true; await db().from('tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', step.id); }
    if (open.length) renderToday();
  }
  const real = state.tasks.filter(countable);
  if (newCompleted && real.length && real.every(t => t.completed)) toast('Every task done. That is a full day.');
  await checkStreak();
}

async function deleteTask(id) {
  const prev = state.tasks;
  state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
  renderToday();
  renderFocusPanel();
  const { error } = await db().from('tasks').delete().eq('id', id);
  if (error) { console.error('Delete failed:', error); state.tasks = prev; renderToday(); toast("Couldn't delete that task.", 'error'); }
}

async function updateTaskText(id, text) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  text = cleanInput(text, LIMITS.task);
  if (!task || !text || text === task.text) { renderTasks(); return; }
  const old = task.text;
  task.text = text;
  renderToday();
  const { error } = await db().from('tasks').update({ text }).eq('id', id);
  if (error) { task.text = old; renderToday(); toast("Couldn't rename that task.", 'error'); }
}

/** Move a task to hour:minute (minute-precise) or unschedule it with hour = null. */
/** @param {{silent?: boolean}} [opts] silent: skip buffer routing (used by the buffer router itself) */
async function scheduleTask(id, hour, minute = 0, opts = {}) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;
  const prev = { h: task.scheduledHour, m: task.scheduledMinute };
  task.scheduledHour = hour;
  task.scheduledMinute = hour === null ? null : (minute || 0);
  renderToday();
  let { error } = await db().from('tasks').update({ scheduled_hour: hour, scheduled_minute: hour === null ? null : (minute || 0) }).eq('id', id);
  if (error && /column|schema cache/i.test(error.message || '')) ({ error } = await db().from('tasks').update({ scheduled_hour: hour }).eq('id', id));
  if (error) { console.error('Schedule failed:', error); task.scheduledHour = prev.h; task.scheduledMinute = prev.m; renderToday(); toast("Couldn't move that task.", 'error'); return; }
  if (hour !== null && !opts.silent && state.settings.autoBuffers && task.kind === 'task') await maybeAddBuffer(task);
}

const unscheduleTask = (id) => scheduleTask(id, null);

async function setTaskDuration(id, minutes) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;
  const prev = task.durationMin;
  task.durationMin = minutes || null;
  renderToday();
  const { error } = await db().from('tasks').update({ duration_min: minutes || null }).eq('id', id);
  if (error) {
    task.durationMin = prev; renderToday();
    const outdated = /column|schema cache/i.test(error.message || '');
    if (outdated) flagSchemaOutdated();
    toast(outdated ? 'Lengths need the 5.0 database update. See Account → Setup.' : "Couldn't change the length.", 'error');
  }
}

/** Micro-step decomposition: AI first, offline templates as fallback. */
async function breakDownTask(id) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task || !state.currentUser) return;
  if (state.tasks.some(t => String(t.parentId) === String(id))) { toast('This task already has steps.'); return; }
  toast('Finding a five-minute way in…');
  let steps = [];
  try {
    const res = await callAI('breakdown', { text: task.text, category: task.category });
    steps = Array.isArray(res?.steps) ? res.steps : [];
  } catch (err) { console.warn('Breakdown AI unavailable, using local steps:', err?.message); }
  if (!steps.length) steps = Momentum.localMicroSteps(task.text, task.category);
  const rows = steps.slice(0, 6).map(st => ({ user_id: state.currentUser.id, text: cleanInput(st.text, LIMITS.task), category: task.category, completed: false, date: task.date || todayISO(), kind: 'microstep', parent_id: task.id, duration_min: Math.max(1, Math.min(30, st.minutes || 5)) }));
  const { data, error } = await db().from('tasks').insert(rows).select();
  if (error) {
    console.error('Micro-steps failed:', error);
    const outdated = /column|schema cache|kind/i.test(error.message || '');
    if (outdated) flagSchemaOutdated();
    toast(outdated ? 'Micro-steps need the 5.0 database update. See Account → Setup.' : "Couldn't save the steps.", 'error');
    return;
  }
  state.tasks.push(...(data || []).map(normalizeTask));
  renderToday();
  renderFocusPanel();
  toast(`${rows.length} tiny steps added. Start with the first one.`);
}

// --- Streak ---
function displayStreak() {
  // A streak is only alive if the last counted day was today or yesterday
  if (state.lastCompleteDate === todayISO() || state.lastCompleteDate === yesterdayISO()) return state.streak;
  return 0;
}

/**
 * Momentum Grace: a day counts when every task is done, or when the person
 * still showed up (reflection + one task, or at least half the plan).
 */
async function checkStreak(reflected = false) {
  const today = todayISO();
  if (state.lastCompleteDate === today || !state.currentUser) return;
  const real = state.tasks.filter(countable);
  const verdict = Momentum.graceVerdict({ total: real.length, done: real.filter(t => t.completed).length, reflected: reflected || state.history.some(h => h.date === today) });
  if (!verdict.counts) return;
  state.streak = state.lastCompleteDate === yesterdayISO() ? state.streak + 1 : 1;
  state.longestStreak = Math.max(state.longestStreak, state.streak);
  state.lastCompleteDate = today;
  const patch = { streak: state.streak, longest_streak: state.longestStreak, last_complete_date: today };
  if (verdict.grace) { state.graceDays += 1; state.lastGraceDate = today; Object.assign(patch, { grace_days: state.graceDays, last_grace_date: today }); }
  let { error } = await db().from('profiles').update(patch).eq('id', state.currentUser.id);
  if (error && /column|schema cache/i.test(error.message || '')) ({ error } = await db().from('profiles').update({ streak: state.streak, longest_streak: state.longestStreak, last_complete_date: today }).eq('id', state.currentUser.id));
  if (error) console.error('Streak update failed:', error);
  if (verdict.grace) toast(verdict.reason);
  renderStats();
}

function renderTasks() {
  if (isEditing()) return;
  els.taskList.innerHTML = '';
  const visible = state.tasks.filter(topLevel);
  if (visible.length === 0) { els.emptyState.classList.remove('hidden'); return; }
  els.emptyState.classList.add('hidden');
  const ordered = [...visible].sort((a, b) => Number(a.completed) - Number(b.completed) || (startMinutes(a) ?? 9e9) - (startMinutes(b) ?? 9e9) || a.createdAt - b.createdAt);
  const frag = document.createDocumentFragment();
  ordered.forEach(task => {
    frag.appendChild(buildTaskItem(task));
    const steps = state.tasks.filter(t => String(t.parentId) === String(task.id)).sort((a, b) => a.createdAt - b.createdAt);
    if (steps.length) {
      const ul = document.createElement('ul');
      ul.className = 'microsteps';
      ul.setAttribute('aria-label', `Steps for ${task.text}`);
      steps.forEach(st => ul.appendChild(buildTaskItem(st)));
      const li = document.createElement('li');
      li.className = 'microsteps-wrap';
      li.appendChild(ul);
      frag.appendChild(li);
    }
  });
  els.taskList.appendChild(frag);
}

const timeValue = (t) => (t.scheduledHour === null ? '' : `${pad(t.scheduledHour)}:${pad(t.scheduledMinute || 0)}`);

/** @param {Task} task */
function buildTaskItem(task) {
  const li = document.createElement('li');
  const isStep = task.kind === 'microstep', isBuffer = task.kind === 'buffer';
  li.className = 'task-item' + (task.completed ? ' completed' : '') + (isStep ? ' microstep' : '') + (isBuffer ? ' buffer' : '');
  li.style.setProperty('--c', `var(--cat-${task.category})`);
  li.draggable = !isStep;
  li.dataset.id = String(task.id);
  const meta = [];
  if (task.durationMin) meta.push(Parse.formatDuration(task.durationMin));
  if (task.people) meta.push(`with ${task.people}`);
  const durOptions = ['', 5, 10, 15, 25, 30, 45, 60, 90, 120, 180].map(v => `<option value="${v}" ${(task.durationMin || '') === v ? 'selected' : ''}>${v === '' ? 'Length' : Parse.formatDuration(v)}</option>`).join('');
  li.innerHTML = `
    <span class="cat-bar" title="${CATEGORY_LABELS[task.category]}"></span>
    <button class="task-checkbox ${task.completed ? 'checked' : ''}" type="button" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}"><svg class="i"><use href="#i-check"/></svg></button>
    <span class="task-main">
      <span class="task-text" title="Double-click to edit">${escapeHtml(task.text)}</span>
      ${meta.length ? `<span class="task-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
    </span>
    ${isStep ? '' : `<label class="task-time ${task.scheduledHour !== null ? 'set' : ''}"><input type="time" step="300" value="${timeValue(task)}" aria-label="Start time"><span class="task-time-label">${task.scheduledHour !== null ? escapeHtml(Parse.formatTime(task.scheduledHour, task.scheduledMinute || 0)) : 'Anytime'}</span></label>`}
    <div class="task-actions">
      ${isStep || isBuffer ? '' : `<select class="task-duration" aria-label="Length">${durOptions}</select>`}
      ${isStep || isBuffer ? '' : `<button class="icon-btn steps-btn" type="button" title="Break into five-minute steps" aria-label="Break into five-minute steps"><svg class="i"><use href="#i-steps"/></svg></button>`}
      ${isBuffer ? '' : `<button class="icon-btn focus-btn" type="button" title="Focus on this" aria-label="Start focus on this task"><svg class="i"><use href="#i-timer"/></svg></button>`}
      <button class="icon-btn delete-btn" type="button" title="Delete" aria-label="Delete task"><svg class="i"><use href="#i-x"/></svg></button>
    </div>`;
  const time = li.querySelector('.task-time input');
  if (time) {
    time.addEventListener('change', () => {
      const v = /** @type {HTMLInputElement} */ (time).value;
      if (!v) return scheduleTask(task.id, null);
      const [h, m] = v.split(':').map(Number);
      scheduleTask(task.id, h, m);
    });
    li.querySelector('.task-time')?.addEventListener('contextmenu', (e) => { e.preventDefault(); if (task.scheduledHour !== null) scheduleTask(task.id, null); });
  }
  li.querySelector('.task-duration')?.addEventListener('change', (e) => setTaskDuration(task.id, Number(/** @type {HTMLSelectElement} */ (e.target).value) || null));
  li.querySelector('.task-checkbox')?.addEventListener('click', () => toggleTask(task.id));
  li.querySelector('.delete-btn')?.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
  li.querySelector('.steps-btn')?.addEventListener('click', () => breakDownTask(task.id));
  li.querySelector('.focus-btn')?.addEventListener('click', () => { switchView('focus'); focus.taskId = String(task.id); if (task.durationMin && !focus.running && focus.remaining === focus.duration) setTimerSeconds(task.durationMin * 60); renderFocusPanel(); });
  const textEl = li.querySelector('.task-text');
  textEl?.addEventListener('dblclick', () => startEdit(textEl, task));
  if (!isStep) {
    li.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', String(task.id)); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
  }
  return li;
}

function startEdit(el, task) {
  el.contentEditable = 'true';
  el.focus();
  document.getSelection()?.selectAllChildren(el);
  const finish = (save) => {
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    el.contentEditable = 'false';
    if (save) updateTaskText(task.id, el.textContent.trim()); else el.textContent = task.text;
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
}

function renderStats() {
  const real = state.tasks.filter(countable);
  const total = real.length;
  const done = real.filter(t => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.streakCount.textContent = displayStreak();
  els.completedCount.textContent = done;
  els.totalCount.textContent = total;
  els.progressPercent.textContent = pct;
  els.progressBar.style.width = pct + '%';
  const C = 2 * Math.PI * 18;
  els.progressRing.style.strokeDashoffset = String(C - (C * pct) / 100);
  els.focusMinutes.textContent = String(Math.round(todaysSessions().reduce((s, x) => s + x.minutes, 0) * 100) / 100);
  const graceEl = $('streak-grace');
  if (graceEl) {
    const verdict = Momentum.graceVerdict({ total, done, reflected: state.history.some(h => h.date === todayISO()) });
    const protectedToday = state.lastCompleteDate === todayISO();
    graceEl.textContent = protectedToday ? (state.lastGraceDate === todayISO() ? 'Held by Momentum Grace' : 'Today counted') : (verdict.counts ? 'Streak safe once you check in' : verdict.reason);
    graceEl.classList.toggle('ok', protectedToday || verdict.counts);
    graceEl.hidden = !total;
  }
}

// --- Timeline ---
function renderTimeline() {
  const container = els.timelineContainer;
  const prevScroll = container.scrollTop;
  container.innerHTML = '';
  const currentHour = new Date().getHours();
  const frag = document.createDocumentFragment();
  for (let hour = 0; hour < 24; hour += 1) {
    const block = document.createElement('div');
    block.className = 'hour-block' + (hour === currentHour ? ' now' : hour < currentHour ? ' past' : '');
    block.dataset.hour = String(hour);
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = formatHourShort(hour);
    const slot = document.createElement('div');
    slot.className = 'hour-slot';
    slot.dataset.hour = String(hour);
    state.tasks.filter(t => t.scheduledHour === hour && topLevel(t)).sort((a, b) => (a.scheduledMinute || 0) - (b.scheduledMinute || 0)).forEach(task => {
      const div = document.createElement('div');
      div.className = 'scheduled-task' + (task.completed ? ' completed' : '') + (task.kind === 'buffer' ? ' buffer' : '');
      div.style.setProperty('--c', `var(--cat-${task.category})`);
      div.draggable = true;
      const when = Parse.formatTime(hour, task.scheduledMinute || 0).replace(/ [AP]M$/, '');
      const len = task.durationMin ? ` · ${Parse.formatDuration(task.durationMin)}` : '';
      div.innerHTML = `<span class="st-time mono">${when}${len}</span><span class="st-text">${escapeHtml(task.text)}</span><button class="scheduled-remove" type="button" title="Unschedule" aria-label="Unschedule"><svg class="i"><use href="#i-x"/></svg></button>`;
      div.querySelector('.scheduled-remove')?.addEventListener('click', () => unscheduleTask(task.id));
      div.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', String(task.id)));
      slot.appendChild(div);
    });
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const id = e.dataTransfer?.getData('text/plain');
      if (!id) return;
      // Drop position inside the hour picks the minute, snapped to 5.
      const rect = slot.getBoundingClientRect();
      const frac = rect.height ? Math.max(0, Math.min(0.999, (e.clientY - rect.top) / rect.height)) : 0;
      const minute = Math.min(55, Math.round((frac * 60) / 5) * 5);
      scheduleTask(id, hour, minute);
    });
    block.appendChild(label);
    block.appendChild(slot);
    frag.appendChild(block);
  }
  const line = document.createElement('div');
  line.className = 'now-line';
  line.id = 'now-line';
  frag.appendChild(line);
  container.appendChild(frag);
  container.scrollTop = prevScroll;
  requestAnimationFrame(() => {
    positionNowLine();
    if (!timelineScrolled && state.currentView === 'today' && container.offsetParent) scrollTimelineToNow();
  });
}

function positionNowLine() {
  const line = $('now-line');
  if (!line) return;
  const now = new Date();
  const block = els.timelineContainer.querySelector(`.hour-block[data-hour="${now.getHours()}"]`);
  if (!block) return;
  line.style.top = `${block.offsetTop + (now.getMinutes() / 60) * block.offsetHeight}px`;
}

function scrollTimelineToNow(smooth = false) {
  const c = els.timelineContainer;
  const block = c.querySelector(`.hour-block[data-hour="${Math.max(0, new Date().getHours() - 1)}"]`);
  if (!block) return;
  c.scrollTo({ top: block.offsetTop - 4, behavior: smooth ? 'smooth' : 'auto' });
  timelineScrolled = true;
}

// ============================================
// Focus timer
// ============================================
const focus = { duration: 25 * 60, remaining: 25 * 60, running: false, endAt: 0, startedAt: 0, taskId: null, timer: null };
const DIAL_C = 2 * Math.PI * 104;

function buildDialTicks() {
  const g = $('dial-ticks');
  if (!g) return;
  let html = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r1 = i % 5 === 0 ? 86 : 90, r2 = 94;
    html += `<line x1="${120 + r1 * Math.cos(a)}" y1="${120 + r1 * Math.sin(a)}" x2="${120 + r2 * Math.cos(a)}" y2="${120 + r2 * Math.sin(a)}"/>`;
  }
  g.innerHTML = html;
}

function setTimerSeconds(seconds) {
  if (focus.running || focus.remaining < focus.duration) {
    toast('Reset the current session to change its length.');
    syncFocusLengthUI();
    return;
  }
  focus.duration = Math.max(0, Math.min(359999, Math.floor(Number(seconds) || 0)));
  focus.remaining = focus.duration;
  store.set('visionary-timer-seconds', focus.duration);
  syncFocusLengthUI();
  renderFocusDial();
}

function setFocusDuration(min) { setTimerSeconds(min * 60); }

function syncFocusLengthUI() {
  $('timer-hours').value = Math.floor(focus.duration / 3600);
  $('timer-minutes').value = Math.floor(focus.duration / 60) % 60;
  $('timer-seconds').value = focus.duration % 60;
  const locked = focus.running || focus.remaining < focus.duration;
  document.querySelector('.focus-card')?.classList.toggle('length-locked', locked);
  $('timer-picker').disabled = locked;
  $('focus-start').disabled = focus.duration === 0;
  $('timer-note').textContent = locked ? 'Reset to choose a new duration.' : focus.duration === 0
    ? 'Choose at least one second.' : 'Keep this page open while the timer runs.';
}

function toggleFocus() {
  if (!focus.duration) return;
  if (focus.running) {
    if (Date.now() >= focus.endAt) return completeFocus();
    focus.running = false;
    focus.remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
    clearInterval(focus.timer);
  } else {
    if (focus.remaining <= 0) focus.remaining = focus.duration;
    if (focus.remaining === focus.duration) focus.startedAt = Date.now();
    focus.running = true;
    focus.endAt = Date.now() + focus.remaining * 1000;
    focus.timer = setInterval(tickFocus, 250);
  }
  renderFocusDial();
}

function tickFocus() {
  focus.remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
  renderFocusDial();
  if (focus.remaining <= 0) completeFocus();
}

async function completeFocus() {
  clearInterval(focus.timer);
  focus.running = false;
  const minutes = Math.round(focus.duration / 60 * 100) / 100;
  const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
  const entry = logSession(minutes, task?.text || 'Free focus', focus.duration, { category: task?.category || null, taskId: task?.id ?? null, completed: true });
  chime();
  focus.remaining = focus.duration;
  renderFocusDial();
  if (Shield.isZen()) Shield.exitZen();
  toast(`Timer complete: ${formatTimerTime(focus.duration)} of focus.`);
  if (task && !task.completed && /** @type {HTMLInputElement|null} */ ($('focus-complete-toggle'))?.checked) await toggleTask(task.id);
  renderFocusPanel();
  renderStats();
  openJournal(entry);
}

function resetFocus() {
  if (focus.running) focus.remaining = Math.max(0, (focus.endAt - Date.now()) / 1000);
  if (focus.running || focus.remaining < focus.duration) {
    const elapsedSec = Math.floor(focus.duration - focus.remaining);
    if (elapsedSec >= 60) {
      const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
      logSession(Math.round(elapsedSec / 60 * 100) / 100, task?.text || 'Free focus', elapsedSec, { category: task?.category || null, taskId: task?.id ?? null, completed: false });
      toast(`Logged ${Math.floor(elapsedSec / 60)} min.`);
    }
  }
  clearInterval(focus.timer);
  focus.running = false;
  focus.remaining = focus.duration;
  if (Shield.isZen()) Shield.exitZen();
  renderFocusPanel();
  renderStats();
}

// --- Distraction Shield controls ---
function setAmbient(name) {
  const btns = document.querySelectorAll('[data-ambient]');
  if (!name || name === 'off') { Shield.stop(); } else if (!Shield.start(name)) { toast('Audio is not available in this browser.', 'error'); return; }
  btns.forEach(b => b.setAttribute('aria-pressed', String((/** @type {HTMLElement} */ (b)).dataset.ambient === (name || 'off'))));
  saveSetting('ambient', name || 'off');
}

// --- Session journal (shown after a finished session) ---
let journalEntry = null;
function openJournal(entry) {
  const modal = $('journal-modal');
  if (!modal || !entry) return;
  journalEntry = entry;
  $('journal-label').textContent = `${entry.label} · ${formatTimerTime(entry.seconds)}`;
  /** @type {HTMLTextAreaElement} */ ($('journal-note')).value = '';
  modal.classList.add('open');
  setTimeout(() => $('journal-note')?.focus(), 50);
}
function closeJournal() { $('journal-modal')?.classList.remove('open'); journalEntry = null; }
async function saveJournal(save = true) {
  const note = save ? cleanInput(/** @type {HTMLTextAreaElement} */ ($('journal-note')).value, LIMITS.note) : '';
  if (journalEntry && note) {
    journalEntry.note = note;
    const all = allSessions();
    const hit = all.find(x => x.at === journalEntry.at);
    if (hit) hit.note = note;
    if (state.demo) demoSessions = all; else store.set(sessionsKey(), all);
    if (journalEntry.cloudId) await db().from('focus_sessions').update({ note }).eq('id', journalEntry.cloudId);
    toast('Saved to your session log.');
  }
  closeJournal();
  renderFocusPanel();
}

function formatTimerTime(seconds) {
  const total = Math.ceil(seconds);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function renderFocusDial() {
  const label = formatTimerTime(focus.remaining);
  $('focus-time').textContent = label;
  const frac = focus.duration ? focus.remaining / focus.duration : 0;
  $('dial-fill').style.strokeDasharray = String(DIAL_C);
  $('dial-fill').style.strokeDashoffset = String(DIAL_C * (1 - frac));
  const card = document.querySelector('.focus-card');
  card?.classList.toggle('running', focus.running);
  syncFocusLengthUI();
  const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
  $('focus-state').textContent = focus.running ? (task ? `On: ${task.text}` : 'In the zone') : (focus.remaining < focus.duration ? 'Paused' : 'Ready when you are');
  const btn = $('focus-start');
  btn.innerHTML = focus.running
    ? '<svg class="i"><use href="#i-pause"/></svg><span>Pause</span>'
    : `<svg class="i"><use href="#i-play"/></svg><span>${focus.remaining < focus.duration ? 'Resume' : 'Start timer'}</span>`;
  document.title = focus.running ? `${label} · Visionary` : 'Visionary — Daily planner with focus timer and AI coaching';
}

let demoSessions = [];
function sessionsKey() { return `visionary-focus-${state.currentUser?.id || 'anon'}`; }
function allSessions() { return state.demo ? demoSessions : (store.get(sessionsKey(), []) || []); }
function todaysSessions() { return allSessions().filter(s => s.date === todayISO()); }

/**
 * Log a focus/stopwatch session locally (instant) and to the cloud (best effort).
 * Local-first: the device log is the source of truth for today; the cloud copy
 * powers analytics across devices and survives a cleared browser.
 */
function logSession(minutes, label, seconds = Math.round(minutes * 60), extra = {}) {
  const all = allSessions();
  const entry = { date: todayISO(), at: Date.now(), minutes, seconds, label, mode: extra.mode || 'timer', category: extra.category || null, completed: extra.completed !== false, taskId: extra.taskId ?? null, note: null, cloudId: null };
  all.push(entry);
  if (state.demo) demoSessions = all.slice(-500);
  else store.set(sessionsKey(), all.slice(-500));
  if (state.currentUser && seconds >= 1) {
    db().from('focus_sessions').insert({ user_id: state.currentUser.id, date: entry.date, label: cleanInput(label, 200), category: entry.category, task_id: entry.taskId === null ? null : String(entry.taskId), seconds: Math.min(86400, Math.max(1, Math.round(seconds))), mode: entry.mode, completed: entry.completed, started_at: new Date(Date.now() - seconds * 1000).toISOString() })
      .select().single()
      .then(({ data, error }) => {
        if (error) { console.warn('Session not synced:', error.message); return; }
        entry.cloudId = data?.id || null;
        if (!state.demo) store.set(sessionsKey(), allSessions().map(x => (x.at === entry.at ? { ...x, cloudId: entry.cloudId } : x)));
      });
  }
  return entry;
}
window.visionaryLogSession = (minutes, label, seconds, extra) => logSession(minutes, label, seconds, extra);

/** Merge cloud sessions (other devices) into the local log, keyed by start time. */
async function loadCloudSessions() {
  if (!state.currentUser) return;
  if (state.demo) { await seedDemoSessions(); return; }
  const since = new Date(); since.setDate(since.getDate() - 90);
  const { data, error } = await db().from('focus_sessions').select('*').eq('user_id', state.currentUser.id).gte('date', isoOf(since)).order('started_at', { ascending: true }).limit(1000);
  if (error) { console.warn('Cloud sessions unavailable:', error.message); return; }
  const local = allSessions();
  const known = new Set(local.map(x => x.cloudId).filter(Boolean));
  let added = 0;
  for (const row of data || []) {
    if (known.has(row.id)) continue;
    const at = new Date(row.started_at).getTime() + row.seconds * 1000;
    if (local.some(x => Math.abs(x.at - at) < 2000)) continue;
    local.push({ date: row.date, at, minutes: Math.round(row.seconds / 60 * 100) / 100, seconds: row.seconds, label: row.label, mode: row.mode, category: row.category, completed: row.completed, taskId: row.task_id, note: row.note, cloudId: row.id });
    added++;
  }
  if (added) { local.sort((a, b) => a.at - b.at); store.set(sessionsKey(), local.slice(-1000)); }
}

/** Demo mode: seed the in-memory session log from the demo database once. */
async function seedDemoSessions() {
  if (demoSessions.length) return;
  const { data } = await db().from('focus_sessions').select('*');
  const rows = data || [];
  demoSessions = rows.map(r => ({ date: r.date, at: new Date(r.started_at).getTime() + r.seconds * 1000, minutes: r.seconds / 60, seconds: r.seconds, label: r.label, mode: r.mode, category: r.category, completed: r.completed, taskId: null, note: r.note, cloudId: r.id }));
}

function renderFocusPanel() {
  const sel = $('focus-task');
  if (sel) {
    const open = state.tasks.filter(t => !t.completed);
    sel.innerHTML = '<option value="">Free focus (no task)</option>' + open.map(t => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.text)}</option>`).join('');
    if (focus.taskId && open.some(t => String(t.id) === String(focus.taskId))) sel.value = String(focus.taskId);
    else if (!focus.running) focus.taskId = null;
  }
  const list = $('session-list');
  const sessions = todaysSessions().reverse();
  list.innerHTML = sessions.map(s => `<li><span class="task-category-dot" style="--c:var(--cat-${s.category || 'focus'})"></span><span class="session-main"><span>${escapeHtml(s.label)}</span>${s.note ? `<span class="session-note">${escapeHtml(s.note)}</span>` : ''}</span><span class="mono">${new Date(s.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${formatTimerTime(s.seconds ?? Math.round(s.minutes * 60))}${s.completed === false ? ' · stopped' : ''}</span></li>`).join('');
  $('session-empty').classList.toggle('hidden', sessions.length > 0);
  $('focus-total').textContent = `${Math.round(sessions.reduce((a, s) => a + s.minutes, 0) * 100) / 100} min`;
  const week = allSessions().filter(s => (parseAppDate(s.date)?.getTime() ?? 0) >= Date.now() - 7 * 86400000).reduce((a, s) => a + s.minutes, 0);
  const weekEl = $('focus-week');
  if (weekEl) weekEl.textContent = `${Math.round(week)} min`;
  document.querySelectorAll('[data-ambient]').forEach(b => b.setAttribute('aria-pressed', String((/** @type {HTMLElement} */ (b)).dataset.ambient === (Shield.current() || 'off'))));
  renderFocusDial();
}

function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 1);
    });
  } catch { /* audio not available */ }
}

// ============================================
// Reflection
// ============================================
function openReflection() {
  const total = state.tasks.filter(countable).length;
  const done = state.tasks.filter(t => countable(t) && t.completed).length;
  els.reflectDone.textContent = done;
  els.reflectTotal.textContent = total;
  els.reflectRate.textContent = total ? Math.round((done / total) * 100) : 0;
  const existing = state.history.find(h => h.date === todayISO());
  els.energySlider.value = existing?.energy || 5;
  els.focusSlider.value = existing?.focus || 5;
  els.energyVal.textContent = els.energySlider.value;
  els.focusVal.textContent = els.focusSlider.value;
  els.reflectNote.value = existing?.note || '';
  els.aiInsightArea.style.display = 'none';
  els.reflectSave.disabled = false;
  els.reflectSave.textContent = existing ? 'Update reflection' : 'Save reflection';
  els.reflectModal.classList.add('open');
}

function closeReflection() { els.reflectModal.classList.remove('open'); }

async function saveReflection() {
  if (!state.currentUser) return;
  const total = state.tasks.filter(countable).length;
  const done = state.tasks.filter(t => countable(t) && t.completed).length;
  const categoryBreakdown = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  state.tasks.filter(countable).forEach(t => { if (t.completed && categoryBreakdown[t.category] !== undefined) categoryBreakdown[t.category] += 1; });
  const reflection = {
    user_id: state.currentUser.id,
    date: todayISO(),
    total,
    completed: done,
    rate: total ? done / total : 0,
    energy: parseInt(els.energySlider.value, 10),
    focus: parseInt(els.focusSlider.value, 10),
    note: cleanInput(els.reflectNote.value, LIMITS.note),
    categories: categoryBreakdown
  };
  const verdict = Momentum.graceVerdict({ total, done, reflected: true });
  if (verdict.grace) reflection.grace = true;
  els.reflectSave.disabled = true;
  els.reflectSave.textContent = 'Saving…';
  let { error } = await db().from('reflections').upsert(reflection, { onConflict: 'user_id,date' });
  if (error && /column|schema cache/i.test(error.message || '')) { const { grace, ...legacy } = reflection; ({ error } = await db().from('reflections').upsert(legacy, { onConflict: 'user_id,date' })); }
  if (error) {
    console.error('Save reflection failed:', error);
    els.reflectSave.disabled = false;
    els.reflectSave.textContent = 'Try again';
    toast("Couldn't save your reflection.", 'error');
    return;
  }
  state.history = state.history.filter(h => h.date !== reflection.date);
  state.history.unshift({ ...reflection, grace: !!reflection.grace, timestamp: Date.now() });
  els.reflectSave.textContent = 'Saved';
  await checkStreak(true);
  await showReflectionInsight();
  if (state.currentView === 'analytics') renderAnalytics();
  setTimeout(closeReflection, 4500);
}

async function showReflectionInsight() {
  els.aiInsightArea.style.display = 'block';
  els.aiInsightText.innerHTML = '<span class="shimmer">Thinking about your day…</span>';
  try {
    const insight = await callAI('insight');
    els.aiInsightText.textContent = insight || localInsight();
  } catch {
    els.aiInsightText.textContent = localInsight();
  }
}

// ============================================
// Analytics
// ============================================
function filteredHistory() {
  const period = state.analyticsPeriod;
  if (period === 9999) return state.history;
  const cutoff = Date.now() - period * 86400000;
  return state.history.filter(h => (parseAppDate(h.date)?.getTime() ?? 0) >= cutoff);
}

function renderAnalytics() {
  const filtered = filteredHistory();
  const chartData = sortByAppDateAsc(filtered);
  const hasData = filtered.length > 0;
  els.analyticsEmpty.classList.toggle('visible', !hasData);
  document.querySelector('.charts-grid').style.display = hasData ? '' : 'none';
  const totalTasks = filtered.reduce((s, h) => s + h.total, 0);
  const totalCompleted = filtered.reduce((s, h) => s + h.completed, 0);
  $('summary-completed').textContent = totalCompleted;
  $('summary-rate').textContent = (totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0) + '%';
  $('summary-energy').textContent = filtered.length ? (filtered.reduce((s, h) => s + h.energy, 0) / filtered.length).toFixed(1) : '—';
  $('summary-streak').textContent = state.longestStreak;
  renderHeatmap();
  renderPatterns();
  if (hasData) {
    loadChartLibrary().then(() => {
      renderChartCompletion(chartData);
      renderChartCategory(filtered);
      renderChartEnergy(chartData);
      renderChartEnergyByCategory(filtered);
      renderChartHours();
    }).catch(() => { /* charts are optional; the rest of the page still renders */ });
  }
  const fsEl = $('summary-focus');
  if (fsEl) {
    const cutoff = state.analyticsPeriod === 9999 ? 0 : Date.now() - state.analyticsPeriod * 86400000;
    const mins = allSessions().filter(x => (parseAppDate(x.date)?.getTime() ?? 0) >= cutoff).reduce((a, x) => a + x.minutes, 0);
    fsEl.textContent = mins >= 120 ? `${Math.round(mins / 60 * 10) / 10} h` : `${Math.round(mins)} min`;
  }
  const graceEl = $('summary-grace');
  if (graceEl) graceEl.textContent = String(state.graceDays || filtered.filter(h => h.grace).length);
}

function renderHeatmap() {
  const el = $('heatmap');
  if (!el) return;
  const byDate = Object.fromEntries(state.history.map(h => [h.date, h]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end); start.setDate(start.getDate() - 26 * 7 + 1);
  const tIso = todayISO();
  let html = '';
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = isoOf(d);
    let rate = byDate[iso]?.rate;
    if (iso === tIso && rate === undefined && state.tasks.length) rate = state.tasks.filter(t => t.completed).length / state.tasks.length;
    const future = d > today;
    const lvl = future || rate === undefined ? 0 : rate === 0 ? 0 : rate < 0.34 ? 1 : rate < 0.67 ? 2 : rate < 1 ? 3 : 4;
    const title = future ? '' : `${formatAppDateLabel(iso, { weekday: 'short', month: 'short', day: 'numeric' })} · ${rate === undefined ? 'no reflection' : Math.round(rate * 100) + '% done'}`;
    html += `<i data-l="${lvl}" class="${iso === tIso ? 'today' : ''} ${future ? 'future' : ''}" title="${title}"></i>`;
  }
  el.innerHTML = html;
  requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
  $('heat-logged').textContent = state.history.length;
  $('heat-perfect').textContent = state.history.filter(h => h.total > 0 && h.completed >= h.total).length;
  $('heat-streak').textContent = displayStreak();
}

// Facts first, then words — rule-based findings from the user's own data
function computePatterns() {
  const h = state.history.filter(x => x.total > 0);
  const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const out = [];
  if (h.length < 3) return out;

  const sizes = h.map(x => x.total).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const light = h.filter(x => x.total <= median), heavy = h.filter(x => x.total > median);
  if (light.length && heavy.length) {
    const a = avg(light, x => x.rate), b = avg(heavy, x => x.rate);
    out.push({ fact: `<em>${pct(a)}</em> vs ${pct(b)}`, text: a >= b ? `You finish more on days with ${median} or fewer tasks. Try capping tomorrow at ${median}.` : `Busier days actually go better for you — you rise to a full plate.` });
  }

  const hiE = h.filter(x => x.energy >= 7), loE = h.filter(x => x.energy > 0 && x.energy < 7);
  if (hiE.length && loE.length) {
    const a = avg(hiE, x => x.rate), b = avg(loE, x => x.rate);
    out.push({ fact: `+<em>${Math.round((a - b) * 100)}</em> pts`, text: `Completion on high-energy days (7+) compared with low-energy days. Protect sleep and movement — they pay off.` });
  }

  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const wk = Array.from({ length: 7 }, () => []);
  h.forEach(x => { const d = parseAppDate(x.date); if (d) wk[d.getDay()].push(x.rate); });
  const scored = wk.map((r, i) => ({ i, n: r.length, v: r.length ? r.reduce((a, b) => a + b, 0) / r.length : -1 })).filter(x => x.n >= 1);
  if (scored.length >= 3) {
    const best = scored.reduce((a, b) => (b.v > a.v ? b : a));
    const worst = scored.reduce((a, b) => (b.v < a.v ? b : a));
    out.push({ fact: `<em>${days[best.i]}</em>`, text: `Your strongest day at ${pct(best.v)} completion. ${days[worst.i]} lag at ${pct(worst.v)} — plan lighter there.` });
  }

  const cats = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  h.forEach(x => CATEGORIES.forEach(c => { cats[c] += x.categories?.[c] || 0; }));
  const totalWins = Object.values(cats).reduce((a, b) => a + b, 0);
  if (totalWins) {
    const top = CATEGORIES.reduce((a, b) => (cats[b] > cats[a] ? b : a));
    const low = CATEGORIES.reduce((a, b) => (cats[b] < cats[a] ? b : a));
    out.push({ fact: `<em>${CATEGORY_LABELS[top]}</em> leads`, text: `${Math.round((cats[top] / totalWins) * 100)}% of your wins. ${CATEGORY_LABELS[low]} is your quietest area — one small ${CATEGORY_LABELS[low].toLowerCase()} task a day would balance it.` });
  }

  const sorted = sortByAppDateAsc(h);
  const last7 = sorted.slice(-7), prev7 = sorted.slice(-14, -7);
  if (last7.length >= 3 && prev7.length >= 3) {
    const a = avg(last7, x => x.rate), b = avg(prev7, x => x.rate);
    const diff = Math.round((a - b) * 100);
    out.push({ fact: `${diff >= 0 ? '↑' : '↓'} <em>${Math.abs(diff)}</em> pts`, text: diff >= 0 ? `Your last 7 logged days beat the 7 before. Momentum is real — keep the same rhythm.` : `A dip versus the previous week. Nothing to fix yet — just make tomorrow's plan smaller.` });
  }

  const noteDays = h.filter(x => x.note);
  if (noteDays.length >= 2) {
    const a = avg(noteDays, x => x.rate), b = avg(h.filter(x => !x.note), x => x.rate) ?? a;
    out.push({ fact: `<em>${noteDays.length}</em> notes`, text: a >= b ? `Days you wrote a note averaged ${pct(a)} completion. Reflection seems to sharpen you.` : `You tend to write notes on harder days — that's a healthy way to process them.` });
  }
  return out.slice(0, 6);
}

function renderPatterns() {
  const grid = $('pattern-grid');
  if (!grid) return;
  const patterns = computePatterns();
  if (!patterns.length) {
    grid.innerHTML = `<div class="pattern"><div class="pattern-fact">Three days in.</div><p>Save at least three reflections and Visionary will start spotting patterns — plan size, energy, best weekdays and more.</p></div>`;
    return;
  }
  grid.innerHTML = patterns.map(p => `<div class="pattern"><div class="pattern-fact">${p.fact}</div><p>${escapeHtml(p.text)}</p></div>`).join('');
}

// Chart.js (~200 KB) is only downloaded the first time the Patterns view opens.
let chartLibraryPromise = null;
function loadChartLibrary() {
  if (window.Chart) return Promise.resolve();
  chartLibraryPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/chart-4.4.0.min.js';
    s.onload = resolve;
    s.onerror = () => { chartLibraryPromise = null; reject(new Error('chart load failed')); };
    document.head.appendChild(s);
  });
  return chartLibraryPromise;
}

function getChartColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (n) => s.getPropertyValue(n).trim();
  return { text: v('--muted'), grid: v('--line'), accent: v('--accent'), focus: v('--cat-focus'), health: v('--cat-health'), learn: v('--cat-learn'), build: v('--cat-build'), rest: v('--cat-rest'), surface: v('--surface') };
}

function chartBaseOptions(colors) {
  if (window.Chart) { Chart.defaults.font.family = "'Satoshi', 'Inter', sans-serif"; Chart.defaults.font.size = 12; }
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: colors.text, usePointStyle: true, boxWidth: 8 } }, tooltip: { padding: 10, cornerRadius: 10 } },
    scales: {
      x: { ticks: { color: colors.text }, grid: { display: false }, border: { display: false } },
      y: { ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid }, border: { display: false }, beginAtZero: true }
    }
  };
}

function renderChartCompletion(history) {
  const canvas = $('chart-completion');
  if (!canvas || !window.Chart) return;
  const colors = getChartColors();
  chartCompletion?.destroy();
  const base = chartBaseOptions(colors);
  chartCompletion = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: history.map(h => formatAppDateLabel(h.date)),
      datasets: [
        { label: 'Completed', data: history.map(h => h.completed), backgroundColor: colors.accent, borderRadius: 6, maxBarThickness: 22 },
        { label: 'Not done', data: history.map(h => Math.max(0, h.total - h.completed)), backgroundColor: colors.grid, borderRadius: 6, maxBarThickness: 22 }
      ]
    },
    options: { ...base, scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } }
  });
}

function renderChartCategory(history) {
  const canvas = $('chart-category');
  if (!canvas || !window.Chart) return;
  const colors = getChartColors();
  const totals = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  history.forEach(h => CATEGORIES.forEach(k => { totals[k] += h.categories?.[k] || 0; }));
  chartCategory?.destroy();
  chartCategory = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: CATEGORIES.map(c => CATEGORY_LABELS[c]),
      datasets: [{ data: CATEGORIES.map(c => totals[c]), backgroundColor: CATEGORIES.map(c => colors[c]), borderColor: colors.surface, borderWidth: 3, hoverOffset: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: colors.text, usePointStyle: true, boxWidth: 8, padding: 14 } } } }
  });
}

function renderChartEnergy(history) {
  const canvas = $('chart-energy');
  if (!canvas || !window.Chart) return;
  const colors = getChartColors();
  chartEnergy?.destroy();
  const base = chartBaseOptions(colors);
  chartEnergy = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: history.map(h => formatAppDateLabel(h.date)),
      datasets: [
        { label: 'Energy', data: history.map(h => h.energy), borderColor: colors.accent, backgroundColor: colors.accent + '22', fill: true, tension: 0.35, pointRadius: 2.5, borderWidth: 2 },
        { label: 'Focus', data: history.map(h => h.focus), borderColor: colors.focus, backgroundColor: 'transparent', tension: 0.35, pointRadius: 2.5, borderWidth: 2 }
      ]
    },
    options: { ...base, interaction: { mode: 'index', intersect: false }, scales: { ...base.scales, y: { ...base.scales.y, min: 0, max: 10 } } }
  });
}

/** Energy vs. task type: average reported energy on days where each category led the wins. */
function renderChartEnergyByCategory(history) {
  const canvas = $('chart-energy-cat');
  if (!canvas || !window.Chart) return;
  const colors = getChartColors();
  chartEnergyCat?.destroy();
  const sums = Object.fromEntries(CATEGORIES.map(c => [c, { e: 0, n: 0 }]));
  history.forEach(h => {
    if (!h.energy) return;
    CATEGORIES.forEach(c => { const k = h.categories?.[c] || 0; if (k > 0) { sums[c].e += h.energy * k; sums[c].n += k; } });
  });
  const data = CATEGORIES.map(c => (sums[c].n ? Math.round((sums[c].e / sums[c].n) * 10) / 10 : 0));
  const base = chartBaseOptions(colors);
  chartEnergyCat = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: CATEGORIES.map(c => CATEGORY_LABELS[c]), datasets: [{ label: 'Avg energy when completing', data, backgroundColor: CATEGORIES.map(c => colors[c] + 'cc'), borderRadius: 8, maxBarThickness: 36 }] },
    options: { ...base, plugins: { ...base.plugins, legend: { display: false } }, scales: { ...base.scales, y: { ...base.scales.y, min: 0, max: 10 } } }
  });
}

/** Time of day vs. completion: how often blocks scheduled at each hour actually got done (last 26 weeks). */
function renderChartHours() {
  const canvas = $('chart-hours');
  if (!canvas || !window.Chart) return;
  const colors = getChartColors();
  chartHours?.destroy();
  const past = state.pastTasks.filter(t => t.scheduledHour !== null && countable(t));
  const agg = Array.from({ length: 24 }, () => ({ n: 0, done: 0 }));
  past.forEach(t => { agg[t.scheduledHour].n++; if (t.completed) agg[t.scheduledHour].done++; });
  const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => h >= 5 && h <= 23);
  const rate = hours.map(h => (agg[h].n ? Math.round((agg[h].done / agg[h].n) * 100) : null));
  const planned = hours.map(h => agg[h].n);
  const base = chartBaseOptions(colors);
  chartHours = new Chart(canvas.getContext('2d'), {
    data: {
      labels: hours.map(h => formatHourShort(h).replace(' ', '')),
      datasets: [
        { type: 'bar', label: 'Blocks planned', data: planned, backgroundColor: colors.grid, borderRadius: 6, yAxisID: 'y1', maxBarThickness: 22 },
        { type: 'line', label: 'Completion %', data: rate, borderColor: colors.accent, backgroundColor: colors.accent, spanGaps: true, tension: 0.35, pointRadius: 3, borderWidth: 2, yAxisID: 'y' }
      ]
    },
    options: { ...base, interaction: { mode: 'index', intersect: false }, scales: { x: base.scales.x, y: { ...base.scales.y, min: 0, max: 100, position: 'left', ticks: { ...base.scales.y.ticks, callback: (v) => v + '%' } }, y1: { ...base.scales.y, position: 'right', grid: { display: false } } } }
  });
  const note = $('chart-hours-note');
  if (note) note.textContent = past.length ? `${past.length} scheduled blocks over the last 26 weeks.` : 'Schedule tasks at specific times and this fills in over the coming weeks.';
}

// ============================================
// Nudges — quiet, data-backed, at most one per hour
// ============================================
let lastNudgeAt = 0;
function maybeNudge(force = false) {
  if (!state.currentUser || !state.settings.nudges) return;
  if (!force && Date.now() - lastNudgeAt < 60 * 60 * 1000) return;
  if (document.querySelector('.ai-suggestion-popup')) return;
  const nudges = Momentum.computeNudges({ sessions: allSessions(), history: state.history, tasks: state.tasks });
  const dismissed = store.get('visionary-nudges-dismissed', {}) || {};
  const pick = nudges.find(n => !dismissed[n.id] || Date.now() - dismissed[n.id] > 3 * 86400000);
  if (!pick) return;
  lastNudgeAt = Date.now();
  els.aiSlot.innerHTML = '';
  const popup = document.createElement('div');
  popup.className = 'ai-suggestion-popup nudge';
  popup.setAttribute('role', 'status');
  popup.innerHTML = `<svg class="i"><use href="#i-sparkle"/></svg><div><span class="nudge-kicker">Pattern</span>${escapeHtml(pick.text)}${pick.action ? ` <button class="link-inline nudge-action" type="button">${escapeHtml(pick.actionLabel || 'Do it')}</button>` : ''}</div><button class="icon-btn ai-suggestion-close" type="button" aria-label="Dismiss"><svg class="i"><use href="#i-x"/></svg></button>`;
  popup.querySelector('.ai-suggestion-close')?.addEventListener('click', () => { dismissed[pick.id] = Date.now(); store.set('visionary-nudges-dismissed', dismissed); popup.remove(); });
  popup.querySelector('.nudge-action')?.addEventListener('click', () => {
    popup.remove();
    const [kind, arg] = String(pick.action).split(':');
    if (kind === 'timer') { switchView('focus'); $('mode-timer')?.click(); setTimerSeconds(Number(arg) * 60); }
    else if (kind === 'suggest') handleAISuggest();
    else if (kind === 'reflect') openReflection();
    else if (kind === 'breakdown') { const t = state.tasks.find(x => !x.completed && x.kind === 'task' && x.scheduledHour !== null && x.scheduledHour < new Date().getHours()); if (t) breakDownTask(t.id); }
  });
  els.aiSlot.appendChild(popup);
}

// ============================================
// History
// ============================================
function renderHistoryList() {
  els.historyList.innerHTML = '';
  if (!state.history.length) { els.historyListEmpty.classList.remove('hidden'); return; }
  els.historyListEmpty.classList.add('hidden');
  state.history.forEach(day => {
    const li = document.createElement('li');
    li.className = 'history-day' + (day.date === selectedHistoryDate ? ' active' : '');
    const pct = Math.round((day.rate || 0) * 100);
    const dateLabel = formatAppDateLabel(day.date, { weekday: 'short', month: 'short', day: 'numeric' });
    li.innerHTML = `<div class="history-day-date">${dateLabel}</div><div class="history-day-meta"><span>${day.completed}/${day.total} · ${pct}%</span><div class="history-day-bar"><div class="history-day-bar-fill" style="width:${pct}%"></div></div><span></span></div>`;
    li.addEventListener('click', () => selectHistoryDay(day.date));
    els.historyList.appendChild(li);
  });
}

async function selectHistoryDay(date) {
  selectedHistoryDate = date;
  renderHistoryList();
  await renderHistoryDetail(date);
}

async function renderHistoryDetail(date) {
  const day = state.history.find(h => h.date === date);
  if (!day || !state.currentUser) return;
  const pct = Math.round((day.rate || 0) * 100);
  els.historyDetailDate.textContent = formatAppDateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' });
  els.historyDetailSummary.textContent = `Completed ${day.completed} of ${day.total} tasks · ${pct}%`;
  els.copyToTodayBtn.classList.remove('hidden');
  els.historyDetailBody.innerHTML = '<div class="skeleton"></div>';
  const { data: tasks, error } = await db().from('tasks').select('*').eq('user_id', state.currentUser.id).eq('date', date).order('created_at', { ascending: true });
  if (error) { console.error('Failed to load past tasks:', error); els.historyDetailBody.innerHTML = '<p class="subtitle">Couldn\'t load that day.</p>'; return; }
  els.historyDetailBody.innerHTML = `
    <div class="history-stats">
      <div class="history-stat"><div class="history-stat-label">Tasks</div><div class="history-stat-value">${day.completed}/${day.total}</div></div>
      <div class="history-stat"><div class="history-stat-label">Rate</div><div class="history-stat-value">${pct}%</div></div>
      <div class="history-stat"><div class="history-stat-label">Energy</div><div class="history-stat-value">${day.energy}/10</div></div>
      <div class="history-stat"><div class="history-stat-label">Focus</div><div class="history-stat-value">${day.focus}/10</div></div>
    </div>
    ${day.note ? `<div class="history-section-title">Reflection</div><blockquote class="history-note">${escapeHtml(day.note)}</blockquote>` : ''}
    ${(tasks && tasks.length) ? `<div class="history-section-title">Tasks that day</div><ul class="task-list">${tasks.map(t => `<li class="history-task ${t.completed ? 'was-completed' : ''}"><span class="task-category-dot ${escapeHtml(t.category)}"></span><span>${escapeHtml(t.text)}</span></li>`).join('')}</ul>` : ''}`;
}

async function copyDayToToday(date) {
  if (!date || !state.currentUser) return;
  if (!confirm("Copy this day's tasks to today? They'll be added as new, unfinished tasks.")) return;
  const { data: pastTasks, error } = await db().from('tasks').select('*').eq('user_id', state.currentUser.id).eq('date', date);
  if (error) { toast("Couldn't read that day.", 'error'); return; }
  if (!pastTasks?.length) { toast('No tasks to copy from that day.'); return; }
  const today = todayISO();
  const newTasks = pastTasks.map(t => ({ user_id: state.currentUser.id, text: cleanInput(t.text, LIMITS.task), category: t.category, completed: false, scheduled_hour: t.scheduled_hour, date: today }));
  const { error: insertError } = await db().from('tasks').insert(newTasks);
  if (insertError) { toast("Couldn't copy those tasks.", 'error'); return; }
  await loadTasks();
  renderToday();
  renderFocusPanel();
  switchView('today');
  toast(`Copied ${newTasks.length} task${newTasks.length > 1 ? 's' : ''} to today.`);
}

// ============================================
// AI
// ============================================
async function callAI(mode, payload = {}) {
  if (state.demo) return localAI(mode, payload);
  const { data, error } = await supabaseClient.functions.invoke('ai-suggest', {
    body: { mode, payload: { tasks: state.tasks, history: state.history.slice(0, 14), currentHour: new Date().getHours(), ...payload } }
  });
  if (error) {
    let message = error.message;
    try { const body = await error.context?.json?.(); if (body?.error) message = body.error; } catch { /* not JSON */ }
    const err = new Error(message);
    err.status = error.context?.status;
    throw err;
  }
  if (data?.error) throw new Error(data.error);
  if (mode === 'schedule-import' || mode === 'schedule-text' || mode === 'breakdown') return data;
  return data?.suggestion || data?.message || null;
}

// Offline brain used in demo mode and as a fallback when the edge function is unreachable
async function localAI(mode, payload = {}) {
  await new Promise(r => setTimeout(r, mode === 'schedule-text' ? 200 : 900));
  if (mode === 'next-action') return localSuggestion();
  if (mode === 'insight') return localInsight();
  if (mode === 'breakdown') return { steps: Momentum.localMicroSteps(payload.text || '', payload.category || 'focus') };
  if (mode === 'schedule-text') {
    const tasks = Parse.parseScheduleText(payload.text || '');
    return { tasks, message: tasks.length ? `Found ${tasks.length} item${tasks.length > 1 ? 's' : ''} in your text.` : 'No items found. Try one item per line, like “9:00-10:15 CS 1570 lecture”.' };
  }
  if (mode === 'schedule-import') {
    return {
      message: 'Demo scan: here is what a class schedule might turn into.',
      tasks: [
        { text: 'CS 1570 lecture', category: 'learn', scheduledHour: 9, scheduledMinute: 0, durationMin: 75 },
        { text: 'Calculus II recitation', category: 'learn', scheduledHour: 11, scheduledMinute: 0, durationMin: 50 },
        { text: 'Lunch + walk', category: 'health', scheduledHour: 12, scheduledMinute: 15, durationMin: 45 },
        { text: 'Digital logic lab', category: 'build', scheduledHour: 14, scheduledMinute: 0, durationMin: 110 },
        { text: 'Office hours', category: 'focus', scheduledHour: 16, scheduledMinute: 0, durationMin: 60 },
        { text: 'Gym — pull day', category: 'health', scheduledHour: 18, scheduledMinute: 0, durationMin: 60 }
      ]
    };
  }
  return null;
}

function localSuggestion() {
  const h = new Date().getHours();
  const open = state.tasks.filter(t => !t.completed && countable(t));
  if (!state.tasks.length) return 'Start small: add one task you can finish in the next 30 minutes, then build from there.';
  if (!open.length) return 'Everything is done. Close the loop with a quick reflection, then actually rest.';
  const due = open.filter(t => t.scheduledHour !== null && t.scheduledHour <= h).sort((a, b) => (startMinutes(a) || 0) - (startMinutes(b) || 0))[0];
  if (due) return `“${due.text}” was planned for ${Parse.formatTime(due.scheduledHour, due.scheduledMinute || 0)}. Give it ${due.durationMin && due.durationMin <= 60 ? due.durationMin : 25} focused minutes now and it's behind you.`;
  const next = open.filter(t => t.scheduledHour !== null).sort((a, b) => (startMinutes(a) || 0) - (startMinutes(b) || 0))[0];
  if (next && next.scheduledHour - h <= 1) return `“${next.text}” is coming up at ${Parse.formatTime(next.scheduledHour, next.scheduledMinute || 0)}. Use the gap to clear something quick.`;
  const pick = open.find(t => t.category === (h < 12 ? 'focus' : h < 17 ? 'build' : 'rest')) || open[0];
  return `Your best next move: “${pick.text}”. It fits this part of the day — start a focus session and let the timer carry you.`;
}

function localInsight() {
  const p = computePatterns();
  if (p.length) return p[0].text;
  const done = state.tasks.filter(t => t.completed).length;
  return done ? `You showed up for ${done} task${done > 1 ? 's' : ''} today. That's the whole game — do it again tomorrow.` : 'Some days are for resetting. Tomorrow, start with one small win before noon.';
}

function showAISuggestion(text, loading = false) {
  els.aiSlot.innerHTML = '';
  const popup = document.createElement('div');
  popup.className = 'ai-suggestion-popup';
  popup.innerHTML = `<svg class="i"><use href="#i-sparkle"/></svg><div>${loading ? `<span class="shimmer">${escapeHtml(text)}</span>` : escapeHtml(text)}</div><button class="icon-btn ai-suggestion-close" type="button" aria-label="Dismiss"><svg class="i"><use href="#i-x"/></svg></button>`;
  popup.querySelector('.ai-suggestion-close').addEventListener('click', () => popup.remove());
  els.aiSlot.appendChild(popup);
  if (!loading) setTimeout(() => popup.isConnected && popup.remove(), 45000);
}

async function handleAISuggest() {
  if (!state.currentUser) return;
  els.aiSuggestBtn.disabled = true;
  els.aiSuggestLabel.textContent = 'Thinking…';
  showAISuggestion('Reading your day…', true);
  try {
    const suggestion = await callAI('next-action');
    showAISuggestion(suggestion || localSuggestion());
  } catch (err) {
    console.error('AI call failed:', err);
    // Quota/rate limits are shown as-is; anything else falls back to the offline coach.
    if (err?.status === 429) showAISuggestion(err.message);
    else showAISuggestion(localSuggestion());
  } finally {
    els.aiSuggestBtn.disabled = false;
    els.aiSuggestLabel.textContent = 'Suggest';
  }
}

// --- Schedule image import (with review step) ---
let importItems = [];

// Downscale big phone photos so uploads stay fast and under function limits
async function imageToBase64(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image.')); i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', 0.86).split(',')[1], mimeType: 'image/jpeg', previewUrl: url };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function handleScheduleImageUpload(event) {
  const file = event?.target?.files?.[0];
  if (event?.target) event.target.value = '';
  return importScheduleImage(file);
}

/** Shared by the file picker, clipboard paste and drag-and-drop. */
async function importScheduleImage(file) {
  if (!file || !state.currentUser) return;
  const cfg = window.VISIONARY_CONFIG || {};
  const allowed = cfg.allowedUploadTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) { toast('Please choose a JPG, PNG, WebP or GIF image.', 'error'); return; }
  if (file.size > (cfg.maxUploadMB || 15) * 1024 * 1024) { toast(`That image is over ${cfg.maxUploadMB || 15} MB. Try a screenshot instead.`, 'error'); return; }

  importItems = [];
  $('import-message').textContent = `Scanning ${file.name || 'image'}…`;
  $('import-list').innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
  /** @type {HTMLButtonElement} */ ($('import-confirm')).disabled = true;
  $('import-count').textContent = 'Reading the image';
  showImportSource('image');
  $('import-modal').classList.add('open');

  try {
    const { base64, mimeType, previewUrl } = await imageToBase64(file);
    /** @type {HTMLImageElement} */ ($('import-img')).src = previewUrl;
    const result = await callAI('schedule-import', {
      image: base64,
      mimeType,
      date: todayISO(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    });
    importItems = (result?.tasks || []).map(t => ({ ...t, include: true }));
    $('import-message').textContent = importItems.length
      ? (result?.message || `Found ${importItems.length} item${importItems.length > 1 ? 's' : ''}. Edit anything before importing.`)
      : (result?.message || 'No schedule items were found in that image. Try a clearer, straight-on screenshot.');
    renderImportList();
  } catch (error) {
    console.error('Schedule import failed:', error);
    $('import-message').textContent = [413, 415, 429].includes(error?.status) ? error.message : 'The scan failed. Please try again in a moment.';
    $('import-list').innerHTML = '';
    $('import-count').textContent = '';
  }
}

/** Switch the import modal between the image preview and the paste-text box. */
function showImportSource(kind) {
  $('import-preview-image')?.toggleAttribute('hidden', kind !== 'image');
  $('import-preview-text')?.toggleAttribute('hidden', kind !== 'text');
}

/** "Paste text" entry point: opens the modal with an empty textarea. */
function openTextImport() {
  if (!state.currentUser) return;
  importItems = [];
  showImportSource('text');
  $('import-message').textContent = 'Paste a syllabus, class schedule, meeting list or any notes with times. One item per line works best.';
  $('import-list').innerHTML = '';
  $('import-count').textContent = '';
  /** @type {HTMLButtonElement} */ ($('import-confirm')).disabled = true;
  /** @type {HTMLTextAreaElement} */ ($('import-text')).value = '';
  $('import-modal').classList.add('open');
  setTimeout(() => $('import-text')?.focus(), 50);
}

async function parsePastedText() {
  const raw = /** @type {HTMLTextAreaElement} */ ($('import-text')).value.trim();
  if (!raw) { toast('Paste some text first.', 'error'); return; }
  const btn = /** @type {HTMLButtonElement} */ ($('import-parse'));
  btn.disabled = true; btn.textContent = 'Reading…';
  $('import-list').innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
  try {
    let result;
    try {
      result = await callAI('schedule-text', { text: raw.slice(0, 6000), date: todayISO(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    } catch (err) {
      console.warn('Text import AI unavailable, using local parser:', err?.message);
      result = await localAI('schedule-text', { text: raw });
    }
    if (!result?.tasks?.length) result = await localAI('schedule-text', { text: raw });
    importItems = (result?.tasks || []).map(t => ({ ...t, include: true }));
    $('import-message').textContent = importItems.length ? (result?.message || `Found ${importItems.length} items. Edit anything before importing.`) : (result?.message || 'No schedule items found in that text.');
    renderImportList();
  } finally {
    btn.disabled = false; btn.textContent = 'Read text';
  }
}

function renderImportList() {
  const list = $('import-list');
  const catOpts = (sel) => CATEGORIES.map(c => `<option value="${c}" ${sel === c ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('');
  const durOpts = (sel) => ['', 15, 25, 30, 45, 50, 60, 75, 90, 110, 120, 180].map(v => `<option value="${v}" ${(sel || '') === v ? 'selected' : ''}>${v === '' ? 'Length' : Parse.formatDuration(v)}</option>`).join('');
  const timeVal = (it) => (Number.isInteger(it.scheduledHour) ? `${pad(it.scheduledHour)}:${pad(it.scheduledMinute || 0)}` : '');
  list.innerHTML = importItems.map((it, i) => `
    <li class="import-row ${it.include ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" ${it.include ? 'checked' : ''} aria-label="Include">
      <input type="text" value="${escapeHtml(it.text)}" aria-label="Task text">
      <div class="imp-controls">
        <select class="imp-cat" aria-label="Category">${catOpts(it.category)}</select>
        <input type="time" class="imp-time" step="300" value="${timeVal(it)}" aria-label="Start time">
        <select class="imp-dur" aria-label="Length">${durOpts(it.durationMin)}</select>
      </div>
    </li>`).join('');
  list.querySelectorAll('.import-row').forEach(row => {
    const it = importItems[Number(/** @type {HTMLElement} */ (row).dataset.i)];
    row.querySelector('input[type="checkbox"]')?.addEventListener('change', (e) => { it.include = /** @type {HTMLInputElement} */ (e.target).checked; row.classList.toggle('off', !it.include); updateImportCount(); });
    row.querySelector('input[type="text"]')?.addEventListener('input', (e) => { it.text = /** @type {HTMLInputElement} */ (e.target).value; });
    row.querySelector('.imp-cat')?.addEventListener('change', (e) => { it.category = /** @type {HTMLSelectElement} */ (e.target).value; });
    row.querySelector('.imp-time')?.addEventListener('change', (e) => {
      const v = /** @type {HTMLInputElement} */ (e.target).value;
      if (!v) { it.scheduledHour = null; it.scheduledMinute = null; return; }
      const [h, m] = v.split(':').map(Number); it.scheduledHour = h; it.scheduledMinute = m;
    });
    row.querySelector('.imp-dur')?.addEventListener('change', (e) => { it.durationMin = Number(/** @type {HTMLSelectElement} */ (e.target).value) || null; });
  });
  updateImportCount();
}

function updateImportCount() {
  const n = importItems.filter(i => i.include && i.text.trim()).length;
  $('import-count').textContent = `${n} selected`;
  $('import-confirm').disabled = n === 0;
  $('import-confirm').textContent = n ? `Add ${n} to today` : 'Add to today';
}

async function confirmImport() {
  const chosen = importItems.filter(i => i.include && cleanInput(i.text, LIMITS.task));
  if (!chosen.length || !state.currentUser) return;
  $('import-confirm').disabled = true;
  $('import-confirm').textContent = 'Adding…';
  const rows = chosen.map(item => ({
    user_id: state.currentUser.id,
    text: cleanInput(item.text, LIMITS.task),
    category: CATEGORIES.includes(item.category) ? item.category : 'focus',
    completed: false,
    date: todayISO(),
    scheduled_hour: Number.isInteger(item.scheduledHour) ? item.scheduledHour : null,
    scheduled_minute: Number.isInteger(item.scheduledHour) ? (Number.isInteger(item.scheduledMinute) ? item.scheduledMinute : 0) : null,
    duration_min: Number.isInteger(item.durationMin) && item.durationMin > 0 ? item.durationMin : null,
    people: item.people ? cleanInput(String(item.people), 120) : null
  }));
  // Conflict resolution: items that overlap an existing block get nudged to the next free 15-minute boundary.
  const busy = Sched.busyIntervals(state.tasks.filter(topLevel));
  let moved = 0;
  rows.forEach(r => {
    if (r.scheduled_hour === null) return;
    const len = r.duration_min || 60;
    let start = r.scheduled_hour * 60 + r.scheduled_minute;
    let tries = 0;
    while (busy.some(b => start < b.end && start + len > b.start) && tries < 12) { start = Math.ceil((start + 1) / 15) * 15; tries++; }
    if (start + len <= 1440 && start !== r.scheduled_hour * 60 + r.scheduled_minute && tries < 12) { r.scheduled_hour = Math.floor(start / 60); r.scheduled_minute = start % 60; moved++; }
    busy.push({ start, end: start + len });
  });
  let { data, error } = await db().from('tasks').insert(rows).select();
  if (error && /column|schema cache/i.test(error.message || '')) {
    ({ data, error } = await db().from('tasks').insert(rows.map(({ scheduled_minute, duration_min, people, ...r }) => r)).select());
  }
  if (error) { console.error(error); toast("Couldn't import those tasks.", 'error'); updateImportCount(); return; }
  if (moved) toast(`${moved} item${moved > 1 ? 's' : ''} moved slightly to avoid overlaps.`);
  state.tasks.push(...(data || []).map(normalizeTask));
  closeImport();
  renderToday();
  renderFocusPanel();
  toast(`Imported ${rows.length} task${rows.length > 1 ? 's' : ''} onto your timeline.`);
}

function closeImport() {
  $('import-modal').classList.remove('open');
  const img = /** @type {HTMLImageElement} */ ($('import-img'));
  const src = img.src;
  if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  img.removeAttribute('src');
}

/** Clipboard and drag-and-drop: a pasted screenshot or dropped image starts a scan. */
function bindImportShortcuts() {
  document.addEventListener('paste', (e) => {
    if (!state.currentUser || document.activeElement?.matches('input, textarea, [contenteditable="true"]')) return;
    const file = Array.from(e.clipboardData?.files || []).find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); importScheduleImage(file); return; }
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.split('\n').filter(l => l.trim()).length >= 2 && Parse.TIME_RE.test(text)) {
      e.preventDefault();
      openTextImport();
      /** @type {HTMLTextAreaElement} */ ($('import-text')).value = text.slice(0, 6000);
      parsePastedText();
    }
  });
  const shell = $('app-shell');
  ['dragenter', 'dragover'].forEach(ev => shell?.addEventListener(ev, (e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); shell.classList.add('drop-ready'); } }));
  shell?.addEventListener('dragleave', (e) => { if (e.target === shell) shell.classList.remove('drop-ready'); });
  shell?.addEventListener('drop', (e) => {
    shell.classList.remove('drop-ready');
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); importScheduleImage(file); }
  });
}

// ============================================
// Command palette
// ============================================
let paletteIndex = 0;
let paletteItems = [];

function paletteCommands() {
  return [
    { group: 'Go to', icon: 'i-today', label: 'Today', run: () => switchView('today') },
    { group: 'Go to', icon: 'i-timer', label: 'Focus session', run: () => switchView('focus') },
    { group: 'Go to', icon: 'i-history', label: 'History', run: () => switchView('history') },
    { group: 'Go to', icon: 'i-chart', label: 'Patterns & analytics', run: () => switchView('analytics') },
    { group: 'Actions', icon: 'i-play', label: focus.running ? 'Pause timer' : 'Start or resume timer', run: () => { switchView('focus'); $('mode-timer').click(); toggleFocus(); } },
    { group: 'Actions', icon: 'i-sparkle', label: 'Suggest my next action', run: () => { switchView('today'); handleAISuggest(); } },
    { group: 'Actions', icon: 'i-scan', label: 'Scan a schedule image', run: () => $('schedule-image-input').click() },
    { group: 'Actions', icon: 'i-paste', label: 'Paste a schedule as text', run: openTextImport },
    { group: 'Actions', icon: 'i-steps', label: 'Break a task into five-minute steps', run: () => { const t = state.tasks.find(x => !x.completed && x.kind === 'task'); if (t) breakDownTask(t.id); else toast('Add a task first.'); } },
    { group: 'Actions', icon: 'i-link', label: 'Booking link & requests', run: () => window.visionaryOpenBooking?.() },
    { group: 'Actions', icon: 'i-shield', label: Shield.isZen() ? 'Leave full-screen focus' : 'Enter full-screen focus', run: () => { switchView('focus'); Shield.isZen() ? Shield.exitZen() : Shield.enterZen(); } },
    { group: 'Actions', icon: 'i-feather', label: 'End-of-day reflection', run: openReflection },
    { group: 'Actions', icon: state.theme === 'dark' ? 'i-sun' : 'i-moon', label: `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} mode`, run: () => applyTheme(state.theme === 'dark' ? 'light' : 'dark') },
    { group: 'Actions', icon: 'i-gift', label: `What's new in ${APP_VERSION}`, run: openWhatsNew },
    { group: 'Account', icon: 'i-logout', label: state.demo ? 'Leave demo' : 'Log out', run: () => logout() }
  ];
}

function openPalette() {
  $('cmdk').classList.add('open');
  $('cmdk-input').value = '';
  paletteIndex = 0;
  renderPalette();
  setTimeout(() => $('cmdk-input').focus(), 10);
}
function closePalette() { $('cmdk').classList.remove('open'); }

function renderPalette() {
  const q = $('cmdk-input').value.trim();
  const ql = q.toLowerCase();
  const cmds = paletteCommands().filter(c => !ql || c.label.toLowerCase().includes(ql) || c.group.toLowerCase().includes(ql));
  paletteItems = [];
  if (q) {
    const p = parseTaskInput(q);
    if (p.intent === 'find') {
      paletteItems.push(...slotSuggestions(p, q));
    } else if (p.text) {
      const bits = [];
      if (p.hour !== null) bits.push(`at ${Parse.formatTime(p.hour, p.minute || 0)}`);
      if (p.duration) bits.push(`for ${Parse.formatDuration(p.duration)}`);
      if (p.people) bits.push(`with ${p.people}`);
      if (p.dateOffset) bits.push(p.dateOffset === 1 ? 'tomorrow' : formatAppDateLabel(offsetISO(p.dateOffset), { weekday: 'short', month: 'short', day: 'numeric' }));
      const cat = p.category && p.category !== state.selectedCategory ? ` · ${CATEGORY_LABELS[p.category]}` : '';
      paletteItems.push({ group: 'Create', icon: 'i-plus', label: `Add “${p.text}”${bits.length ? ' ' + bits.join(' ') : ''}${cat}`, run: () => { switchView('today'); createTask(q, p.category || state.selectedCategory); } });
    }
  }
  paletteItems.push(...cmds);
  if (paletteIndex >= paletteItems.length) paletteIndex = 0;
  let lastGroup = '';
  $('cmdk-list').innerHTML = paletteItems.map((c, i) => {
    const head = c.group !== lastGroup ? `<li class="cmdk-group">${c.group}</li>` : '';
    lastGroup = c.group;
    return `${head}<li class="cmdk-item ${i === paletteIndex ? 'active' : ''}" data-i="${i}" role="option"><svg class="i"><use href="#${c.icon}"/></svg><span>${escapeHtml(c.label)}</span></li>`;
  }).join('');
  $('cmdk-list').querySelectorAll('.cmdk-item').forEach(li => {
    li.addEventListener('mousemove', () => { if (paletteIndex !== Number(li.dataset.i)) { paletteIndex = Number(li.dataset.i); highlightPalette(); } });
    li.addEventListener('click', () => runPalette(Number(li.dataset.i)));
  });
}

/**
 * Booking agent: "find 30 minutes next Tuesday after my discrete math class".
 * Looks at the target day's blocks (today from state, other days from the DB
 * cache) and offers up to three free slots ranked by the user's strong hours.
 */
let slotCache = { date: null, tasks: [] };
function slotSuggestions(p, raw) {
  const date = offsetISO(p.dateOffset || 0);
  const duration = p.duration || 30;
  const dayTasks = date === todayISO() ? state.tasks : (slotCache.date === date ? slotCache.tasks : null);
  if (dayTasks === null) {
    // Fetch once, then re-render the palette with real availability.
    slotCache = { date, tasks: [] };
    db().from('tasks').select('*').eq('user_id', state.currentUser?.id).eq('date', date).then(({ data }) => { slotCache = { date, tasks: (data || []).map(normalizeTask) }; if ($('cmdk').classList.contains('open')) renderPalette(); });
    return [{ group: 'Find time', icon: 'i-clock', label: `Checking ${formatAppDateLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })}…`, run: () => {} }];
  }
  const blocks = Sched.busyIntervals(dayTasks.filter(topLevel));
  let notBefore = 0, to = 22 * 60;
  const anchorFor = (phrase) => dayTasks.find(t => t.scheduledHour !== null && t.text.toLowerCase().includes(phrase.toLowerCase().replace(/\b(class|lecture|meeting|session)\b/g, '').trim()));
  if (p.after) { const a = anchorFor(p.after); if (a) notBefore = (startMinutes(a) || 0) + (a.durationMin || 60); }
  if (p.before) { const b = anchorFor(p.before); if (b) to = startMinutes(b) || to; }
  if (date === todayISO()) { const now = new Date(); notBefore = Math.max(notBefore, now.getHours() * 60 + now.getMinutes() + 10); }
  const buffer = Sched.bufferLength(state.history.slice(0, 7));
  const slots = Sched.freeSlots(blocks, { duration, from: 7 * 60, to, buffer, notBefore });
  const ranked = Sched.shortlist(Sched.rankSlots(slots, Sched.hourScores(state.pastTasks), p.part), 3);
  const dayLabel = date === todayISO() ? 'today' : formatAppDateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' });
  if (!ranked.length) return [{ group: 'Find time', icon: 'i-clock', label: `No free ${Parse.formatDuration(duration)} ${dayLabel}${p.after ? ` after ${p.after}` : ''}. Try another day.`, run: () => {} }];
  const title = p.text && p.text !== 'Open block' ? p.text : 'Open block';
  return ranked.map(sl => ({
    group: 'Find time',
    icon: 'i-clock',
    label: `${Sched.label(sl.start)} ${dayLabel} · ${Parse.formatDuration(duration)}${p.after ? ` (after ${p.after})` : ''} — book “${title}”`,
    run: () => createTask(title, p.category || state.selectedCategory, { date, hour: Math.floor(sl.start / 60), minute: sl.start % 60, duration, people: p.people })
  }));
}

function highlightPalette() {
  $('cmdk-list').querySelectorAll('.cmdk-item').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === paletteIndex));
  $('cmdk-list').querySelector('.cmdk-item.active')?.scrollIntoView({ block: 'nearest' });
}

function runPalette(i) {
  const item = paletteItems[i];
  closePalette();
  item?.run();
}

function onPaletteKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = (paletteIndex + 1) % paletteItems.length; highlightPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = (paletteIndex - 1 + paletteItems.length) % paletteItems.length; highlightPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIndex); }
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
}

// ============================================
// What's new
// ============================================
function maybeShowWhatsNew() {
  const seen = store.get('visionary-seen-version');
  $('whatsnew-dot')?.classList.toggle('hidden', seen === APP_VERSION);
  if (seen !== APP_VERSION) setTimeout(openWhatsNew, 700);
}
function openWhatsNew() { $('whatsnew-modal').classList.add('open'); }
function closeWhatsNew() {
  $('whatsnew-modal').classList.remove('open');
  store.set('visionary-seen-version', APP_VERSION);
  $('whatsnew-dot')?.classList.add('hidden');
}

// ============================================
// Utilities
// ============================================
window.visionaryToast = (...args) => toast(...args);
window.visionaryReloadTasks = async () => { if (!state.currentUser) return; await loadTasks(); renderToday(); };
function toast(message, type = 'info') {
  const wrap = $('toasts');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = `toast ${type === 'error' ? 'error' : ''}`;
  t.innerHTML = `<svg class="i"><use href="#${type === 'error' ? 'i-x' : 'i-check'}"/></svg><span>${escapeHtml(message)}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
}

function formatHour(hour) {
  const h = hour % 12 || 12;
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

function formatHourShort(hour) {
  const h = hour % 12 || 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Normalises user text before it is stored: strips control/bidi characters, collapses whitespace, caps length. */
function cleanInput(value, max = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeHtml(str = '') {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML.replace(/"/g, '&quot;');
}

init();
