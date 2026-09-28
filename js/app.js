// ============================================
// VISIONARY 4.0 — "Horizon"
// Cloud-synced with Supabase, plus a local demo mode.
// ============================================

const APP_VERSION = '4.1';
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
  demo: false
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
let selectedHistoryDate = null;
let currentLoadedDate = todayISO();
let bootstrapping = false;
let initialized = false;
let timelineScrolled = false;

// ============================================
// Demo database — a tiny local stand-in for the Supabase query builder
// ============================================
function createDemoDb() {
  const KEY = 'visionary-demo-v4';
  let data = store.get(KEY) || seedDemoData();
  const save = () => store.set(KEY, data);
  save();
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
    order(k, o = {}) { this.sort = [k, o.ascending !== false]; return this; }
    single() { this.one = true; return this; }
    then(resolve) {
      try { resolve(this.run()); } catch (error) { resolve({ data: null, error }); }
    }
    run() {
      const rows = (data[this.table] ||= []);
      const match = (r) => this.filters.every(([k, v]) => String(r[k]) === String(v));
      const finish = (list) => {
        const out = clone(list);
        if (this.one) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: 'Row not found' } };
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
        data[this.table] = rows.filter(r => !match(r)); save();
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
    ['Gym — push day', 'health', Math.max(6, nowH - 3), true],
    ['Digital logic notes', 'learn', Math.max(7, nowH - 1), true],
    ['Ship Visionary feature', 'build', Math.min(22, nowH + 1), false],
    ['Calculus problem set', 'learn', Math.min(23, nowH + 3), false],
    ['Plan tomorrow', 'focus', null, false],
    ['No-screen hour', 'rest', null, false]
  ];
  todays.forEach(([text, category, hour, completed], i) => tasks.push({ id: `today-${i}`, user_id: user, text, category, completed, date: t, scheduled_hour: hour, created_at: new Date(Date.now() - (10 - i) * 60000).toISOString() }));
  return {
    tasks,
    reflections,
    profiles: [{ id: user, streak: 4, longest_streak: 11, last_complete_date: yesterdayISO() }]
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
function normalizeTask(t) {
  return {
    id: t.id,
    text: t.text,
    category: CATEGORIES.includes(t.category) ? t.category : 'focus',
    completed: !!t.completed,
    scheduledHour: Number.isInteger(t.scheduled_hour) ? t.scheduled_hour : null,
    createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null
  };
}

// "gym at 6pm", "study @ 14:00", "call mom 7 am" -> { text, hour }
function parseTaskInput(raw) {
  let text = raw.trim();
  let hour = null;
  const re = /\s*(?:\b(?:at|@)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*$|\s*(?:\bat\b|@)\s*(\d{1,2})(?::(\d{2}))?\s*$/i;
  const m = text.match(re);
  if (m) {
    const h = Number(m[1] ?? m[4]);
    const ampm = (m[3] || '').toLowerCase();
    let hr = h;
    if (ampm === 'pm' && h < 12) hr = h + 12;
    if (ampm === 'am' && h === 12) hr = 0;
    if (hr >= 0 && hr <= 23 && (ampm ? h >= 1 && h <= 12 : true)) {
      hour = hr;
      text = text.slice(0, m.index).trim() || text;
    }
  }
  return { text, hour };
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
  } finally {
    bootstrapping = false;
  }
};

window.visionaryOnSignedOut = function () {
  state.currentUser = null;
  state.tasks = [];
  state.history = [];
  state.streak = 0;
  state.longestStreak = 0;
  state.lastCompleteDate = null;
  selectedHistoryDate = null;
  timelineScrolled = false;
  renderAll();
};

window.visionaryIsDemo = () => state.demo;
window.visionaryStartDemo = async function () {
  state.demo = true;
  document.body.classList.add('is-demo');
  window.showApp?.();
  await window.visionaryOnSignedIn({ id: 'demo', email: 'demo@visionary.app' });
  toast('Welcome to the demo — everything stays in this browser.');
};
window.visionaryExitDemo = function () {
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
  await Promise.all([loadTasks(), loadProfile(), loadHistory()]);
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
    categories: h.categories || {}
  }));
}

// ============================================
// Events
// ============================================
function attachEventListeners() {
  els.addBtn?.addEventListener('click', handleAdd);
  els.taskInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });

  document.querySelectorAll('#category-chips .chip').forEach(chip => chip.addEventListener('click', () => setCategory(chip.dataset.value)));

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
  document.querySelectorAll('.focus-presets .seg').forEach(b => b.addEventListener('click', () => setFocusDuration(Number(b.dataset.min))));
  $('focus-start')?.addEventListener('click', toggleFocus);
  $('focus-reset')?.addEventListener('click', resetFocus);
  $('focus-task')?.addEventListener('change', (e) => { focus.taskId = e.target.value || null; });

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
const HZ = { cx: 320, base: 136, rx: 292, ry: 112 };
function arcPoint(hourFloat) {
  const t = Math.max(0, Math.min(24, hourFloat)) / 24;
  const a = Math.PI * (1 - t);
  return { x: HZ.cx + HZ.rx * Math.cos(a), y: HZ.base - HZ.ry * Math.sin(a) };
}

function renderHorizon() {
  const svg = els.horizon;
  if (!svg) return;
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

  const byHour = {};
  const dots = state.tasks.filter(t => t.scheduledHour !== null).map(t => {
    const idx = (byHour[t.scheduledHour] = (byHour[t.scheduledHour] ?? -1) + 1);
    const p = arcPoint(t.scheduledHour + 0.5);
    const off = idx * 13;
    // Stack extra tasks in the same hour slightly inward (toward the center)
    const dx = (HZ.cx - p.x), dy = (HZ.base - p.y);
    const len = Math.hypot(dx, dy) || 1;
    const x = p.x + (dx / len) * off, y = p.y + (dy / len) * off;
    const fill = t.completed ? catColor(t.category) : 'var(--surface)';
    return `<circle class="task-dot ${t.completed ? 'done' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${fill}" stroke="${catColor(t.category)}"><title>${escapeHtml(formatHour(t.scheduledHour))} · ${escapeHtml(t.text)}</title></circle>`;
  }).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="pastGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".15"/><stop offset="1" stop-color="var(--accent)"/></linearGradient>
    </defs>
    <line x1="0" y1="${HZ.base}" x2="640" y2="${HZ.base}" class="ground"/>
    <path class="arc-future" d="M${start.x} ${HZ.base} A${HZ.rx} ${HZ.ry} 0 0 1 ${end.x} ${HZ.base}"/>
    <path class="arc-past" stroke="url(#pastGrad)" d="M${start.x} ${HZ.base} A${HZ.rx} ${HZ.ry} 0 0 1 ${sun.x.toFixed(2)} ${sun.y.toFixed(2)}"/>
    ${ticks}
    ${dots}
    <circle class="sun-halo" cx="${sun.x.toFixed(1)}" cy="${sun.y.toFixed(1)}" r="16"/>
    <circle class="sun-core" cx="${sun.x.toFixed(1)}" cy="${sun.y.toFixed(1)}" r="7"/>
  `;

  const minsLeft = Math.max(0, (24 - nowH) * 60);
  const hL = Math.floor(minsLeft / 60), mL = Math.round(minsLeft % 60);
  els.horizonLeft.innerHTML = now.getHours() >= 22 || now.getHours() < 4
    ? 'The day is almost done. <em>Rest well.</em>'
    : `<em>${hL}h ${mL}m</em> of today left`;

  const nowHour = now.getHours();
  const upcoming = state.tasks.filter(t => !t.completed && t.scheduledHour !== null && t.scheduledHour >= nowHour).sort((a, b) => a.scheduledHour - b.scheduledHour)[0];
  const anytime = state.tasks.find(t => !t.completed && t.scheduledHour === null);
  const overdue = state.tasks.filter(t => !t.completed && t.scheduledHour !== null && t.scheduledHour < nowHour).length;
  if (upcoming) els.nextUp.textContent = `${formatHour(upcoming.scheduledHour)} · ${upcoming.text}`;
  else if (anytime) els.nextUp.textContent = `Anytime · ${anytime.text}`;
  else if (state.tasks.length && state.tasks.every(t => t.completed)) els.nextUp.textContent = 'All clear — nice work';
  else if (overdue) els.nextUp.textContent = `${overdue} earlier task${overdue > 1 ? 's' : ''} still open`;
  else els.nextUp.textContent = 'Nothing scheduled';
}

// --- Tasks ---
async function handleAdd() {
  const raw = els.taskInput.value.trim();
  if (!raw || !state.currentUser) return;
  const ok = await createTask(raw, state.selectedCategory);
  if (ok) { els.taskInput.value = ''; els.taskInput.focus(); }
}

async function createTask(raw, category = 'focus') {
  const parsed = parseTaskInput(raw);
  const text = cleanInput(parsed.text, LIMITS.task);
  const hour = parsed.hour;
  if (!text) { toast('Give the task a name first.', 'error'); return false; }
  const row = { user_id: state.currentUser.id, text, category, completed: false, date: todayISO() };
  if (hour !== null) row.scheduled_hour = hour;
  const { data, error } = await db().from('tasks').insert(row).select().single();
  if (error) { console.error('Add failed:', error); toast("Couldn't save that task. Check your connection.", 'error'); return false; }
  state.tasks.push(normalizeTask(data));
  renderToday();
  renderFocusPanel();
  if (hour !== null) toast(`Added and scheduled for ${formatHour(hour)}`);
  return true;
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
  if (newCompleted && state.tasks.every(t => t.completed)) toast('Every task done. That is a full day.');
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

async function scheduleTask(id, hour) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;
  const prev = task.scheduledHour;
  task.scheduledHour = hour;
  renderToday();
  const { error } = await db().from('tasks').update({ scheduled_hour: hour }).eq('id', id);
  if (error) { console.error('Schedule failed:', error); task.scheduledHour = prev; renderToday(); toast("Couldn't move that task.", 'error'); }
}

const unscheduleTask = (id) => scheduleTask(id, null);

// --- Streak ---
function displayStreak() {
  // A streak is only alive if the last full day was today or yesterday
  if (state.lastCompleteDate === todayISO() || state.lastCompleteDate === yesterdayISO()) return state.streak;
  return 0;
}

async function checkStreak() {
  const today = todayISO();
  const allDone = state.tasks.length > 0 && state.tasks.every(t => t.completed);
  if (!allDone || state.lastCompleteDate === today || !state.currentUser) return;
  state.streak = state.lastCompleteDate === yesterdayISO() ? state.streak + 1 : 1;
  state.longestStreak = Math.max(state.longestStreak, state.streak);
  state.lastCompleteDate = today;
  const { error } = await db().from('profiles').update({ streak: state.streak, longest_streak: state.longestStreak, last_complete_date: today }).eq('id', state.currentUser.id);
  if (error) console.error('Streak update failed:', error);
  renderStats();
}

function renderTasks() {
  if (isEditing()) return;
  els.taskList.innerHTML = '';
  if (state.tasks.length === 0) { els.emptyState.classList.remove('hidden'); return; }
  els.emptyState.classList.add('hidden');
  const ordered = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed));
  const hourOptions = ['<option value="">Anytime</option>']
    .concat(Array.from({ length: 24 }, (_, h) => `<option value="${h}">${formatHourShort(h)}</option>`)).join('');

  ordered.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    li.style.setProperty('--c', `var(--cat-${task.category})`);
    li.draggable = true;
    li.dataset.id = task.id;
    li.innerHTML = `
      <span class="cat-bar" title="${CATEGORY_LABELS[task.category]}"></span>
      <button class="task-checkbox ${task.completed ? 'checked' : ''}" type="button" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}"><svg class="i"><use href="#i-check"/></svg></button>
      <span class="task-text" title="Double-click to edit">${escapeHtml(task.text)}</span>
      <select class="task-hour ${task.scheduledHour !== null ? 'set' : ''}" aria-label="Schedule time">${hourOptions}</select>
      <div class="task-actions">
        <button class="icon-btn focus-btn" type="button" title="Focus on this" aria-label="Start focus on this task"><svg class="i"><use href="#i-timer"/></svg></button>
        <button class="icon-btn delete-btn" type="button" title="Delete" aria-label="Delete task"><svg class="i"><use href="#i-x"/></svg></button>
      </div>`;
    const sel = li.querySelector('.task-hour');
    sel.value = task.scheduledHour !== null ? String(task.scheduledHour) : '';
    sel.addEventListener('change', () => scheduleTask(task.id, sel.value === '' ? null : Number(sel.value)));
    li.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(task.id));
    li.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
    li.querySelector('.focus-btn').addEventListener('click', () => { switchView('focus'); focus.taskId = String(task.id); renderFocusPanel(); });
    const textEl = li.querySelector('.task-text');
    textEl.addEventListener('dblclick', () => startEdit(textEl, task));
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(task.id)); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    els.taskList.appendChild(li);
  });
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
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.streakCount.textContent = displayStreak();
  els.completedCount.textContent = done;
  els.totalCount.textContent = total;
  els.progressPercent.textContent = pct;
  els.progressBar.style.width = pct + '%';
  const C = 2 * Math.PI * 18;
  els.progressRing.style.strokeDashoffset = String(C - (C * pct) / 100);
  els.focusMinutes.textContent = todaysSessions().reduce((s, x) => s + x.minutes, 0);
}

// --- Timeline ---
function renderTimeline() {
  const container = els.timelineContainer;
  const prevScroll = container.scrollTop;
  container.innerHTML = '';
  const currentHour = new Date().getHours();
  for (let hour = 0; hour < 24; hour += 1) {
    const block = document.createElement('div');
    block.className = 'hour-block' + (hour === currentHour ? ' now' : hour < currentHour ? ' past' : '');
    block.dataset.hour = hour;
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = formatHourShort(hour);
    const slot = document.createElement('div');
    slot.className = 'hour-slot';
    slot.dataset.hour = hour;
    state.tasks.filter(t => t.scheduledHour === hour).forEach(task => {
      const div = document.createElement('div');
      div.className = 'scheduled-task' + (task.completed ? ' completed' : '');
      div.style.setProperty('--c', `var(--cat-${task.category})`);
      div.draggable = true;
      div.innerHTML = `<span>${escapeHtml(task.text)}</span><button class="scheduled-remove" type="button" title="Unschedule" aria-label="Unschedule"><svg class="i"><use href="#i-x"/></svg></button>`;
      div.querySelector('.scheduled-remove').addEventListener('click', () => unscheduleTask(task.id));
      div.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(task.id)));
      slot.appendChild(div);
    });
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) scheduleTask(id, hour);
    });
    block.appendChild(label);
    block.appendChild(slot);
    container.appendChild(block);
  }
  const line = document.createElement('div');
  line.className = 'now-line';
  line.id = 'now-line';
  container.appendChild(line);
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

function setFocusDuration(min) {
  if (focus.running) return toast('Pause or reset the current session first.');
  focus.duration = min * 60;
  focus.remaining = focus.duration;
  document.querySelectorAll('.focus-presets .seg').forEach(b => b.classList.toggle('active', Number(b.dataset.min) === min));
  renderFocusDial();
}

function toggleFocus() {
  if (focus.running) {
    focus.running = false;
    focus.remaining = Math.max(0, Math.round((focus.endAt - Date.now()) / 1000));
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
  focus.remaining = Math.max(0, Math.round((focus.endAt - Date.now()) / 1000));
  renderFocusDial();
  if (focus.remaining <= 0) completeFocus();
}

async function completeFocus() {
  clearInterval(focus.timer);
  focus.running = false;
  const minutes = Math.round(focus.duration / 60);
  const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
  logSession(minutes, task?.text || 'Free focus');
  chime();
  focus.remaining = focus.duration;
  renderFocusDial();
  toast(`Session complete — ${minutes} minutes of focus.`);
  if (task && !task.completed && $('focus-complete-toggle')?.checked) await toggleTask(task.id);
  renderFocusPanel();
  renderStats();
}

function resetFocus() {
  if (focus.running || focus.remaining < focus.duration) {
    const elapsed = Math.floor((focus.duration - focus.remaining) / 60);
    if (elapsed >= 1) {
      const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
      logSession(elapsed, task?.text || 'Free focus');
      toast(`Logged ${elapsed} min.`);
    }
  }
  clearInterval(focus.timer);
  focus.running = false;
  focus.remaining = focus.duration;
  renderFocusPanel();
  renderStats();
}

function renderFocusDial() {
  const m = Math.floor(focus.remaining / 60), s = focus.remaining % 60;
  const label = `${pad(m)}:${pad(s)}`;
  $('focus-time').textContent = label;
  const frac = focus.remaining / focus.duration;
  $('dial-fill').style.strokeDasharray = String(DIAL_C);
  $('dial-fill').style.strokeDashoffset = String(DIAL_C * (1 - frac));
  const card = document.querySelector('.focus-card');
  card?.classList.toggle('running', focus.running);
  const task = state.tasks.find(t => String(t.id) === String(focus.taskId));
  $('focus-state').textContent = focus.running ? (task ? `On: ${task.text}` : 'In the zone') : (focus.remaining < focus.duration ? 'Paused' : 'Ready when you are');
  const btn = $('focus-start');
  btn.innerHTML = focus.running
    ? '<svg class="i"><use href="#i-pause"/></svg><span>Pause</span>'
    : `<svg class="i"><use href="#i-play"/></svg><span>${focus.remaining < focus.duration ? 'Resume' : 'Start focus'}</span>`;
  document.title = focus.running ? `${label} · Visionary` : 'Visionary — Daily planner with focus timer and AI coaching';
}

function sessionsKey() { return `visionary-focus-${state.demo ? 'demo' : state.currentUser?.id || 'anon'}`; }
function todaysSessions() { return (store.get(sessionsKey(), []) || []).filter(s => s.date === todayISO()); }
function logSession(minutes, label) {
  const all = store.get(sessionsKey(), []) || [];
  all.push({ date: todayISO(), at: Date.now(), minutes, label });
  store.set(sessionsKey(), all.slice(-500));
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
  list.innerHTML = sessions.map(s => `<li><span class="task-category-dot" style="--c:var(--accent)"></span><span>${escapeHtml(s.label)}</span><span class="mono">${new Date(s.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${s.minutes}m</span></li>`).join('');
  $('session-empty').classList.toggle('hidden', sessions.length > 0);
  $('focus-total').textContent = `${sessions.reduce((a, s) => a + s.minutes, 0)} min`;
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
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
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
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const categoryBreakdown = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  state.tasks.forEach(t => { if (t.completed && categoryBreakdown[t.category] !== undefined) categoryBreakdown[t.category] += 1; });
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
  els.reflectSave.disabled = true;
  els.reflectSave.textContent = 'Saving…';
  const { error } = await db().from('reflections').upsert(reflection, { onConflict: 'user_id,date' });
  if (error) {
    console.error('Save reflection failed:', error);
    els.reflectSave.disabled = false;
    els.reflectSave.textContent = 'Try again';
    toast("Couldn't save your reflection.", 'error');
    return;
  }
  state.history = state.history.filter(h => h.date !== reflection.date);
  state.history.unshift({ ...reflection, timestamp: Date.now() });
  els.reflectSave.textContent = 'Saved';
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
    }).catch(() => { /* charts are optional; the rest of the page still renders */ });
  }
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
  if (mode === 'schedule-import') return data;
  return data?.suggestion || data?.message || null;
}

// Offline brain used in demo mode and as a fallback when the edge function is unreachable
async function localAI(mode) {
  await new Promise(r => setTimeout(r, 900));
  if (mode === 'next-action') return localSuggestion();
  if (mode === 'insight') return localInsight();
  if (mode === 'schedule-import') {
    return {
      message: 'Demo scan: here is what a class schedule might turn into.',
      tasks: [
        { text: 'CS 1570 lecture', category: 'learn', scheduledHour: 9 },
        { text: 'Calculus II recitation', category: 'learn', scheduledHour: 11 },
        { text: 'Lunch + walk', category: 'health', scheduledHour: 12 },
        { text: 'Digital logic lab', category: 'build', scheduledHour: 14 },
        { text: 'Office hours', category: 'focus', scheduledHour: 16 },
        { text: 'Gym — pull day', category: 'health', scheduledHour: 18 }
      ]
    };
  }
  return null;
}

function localSuggestion() {
  const h = new Date().getHours();
  const open = state.tasks.filter(t => !t.completed);
  if (!state.tasks.length) return 'Start small: add one task you can finish in the next 30 minutes, then build from there.';
  if (!open.length) return 'Everything is done. Close the loop with a quick reflection, then actually rest.';
  const due = open.filter(t => t.scheduledHour !== null && t.scheduledHour <= h).sort((a, b) => a.scheduledHour - b.scheduledHour)[0];
  if (due) return `“${due.text}” was planned for ${formatHour(due.scheduledHour)}. Give it 25 focused minutes now and it's behind you.`;
  const next = open.filter(t => t.scheduledHour !== null).sort((a, b) => a.scheduledHour - b.scheduledHour)[0];
  if (next && next.scheduledHour - h <= 1) return `“${next.text}” is coming up at ${formatHour(next.scheduledHour)}. Use the gap to clear something quick.`;
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
  if (!file || !state.currentUser) return;
  const cfg = window.VISIONARY_CONFIG || {};
  const allowed = cfg.allowedUploadTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) { toast('Please choose a JPG, PNG, WebP or GIF image.', 'error'); return; }
  if (file.size > (cfg.maxUploadMB || 15) * 1024 * 1024) { toast(`That image is over ${cfg.maxUploadMB || 15} MB. Try a screenshot instead.`, 'error'); return; }

  importItems = [];
  $('import-message').textContent = `Scanning ${file.name}…`;
  $('import-list').innerHTML = '<li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li><li class="skeleton"></li>';
  $('import-confirm').disabled = true;
  $('import-count').textContent = 'Reading the image';
  $('import-modal').classList.add('open');

  try {
    const { base64, mimeType, previewUrl } = await imageToBase64(file);
    $('import-img').src = previewUrl;
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

function renderImportList() {
  const list = $('import-list');
  const hourOpts = (sel) => ['<option value="">Anytime</option>'].concat(Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${sel === h ? 'selected' : ''}>${formatHourShort(h)}</option>`)).join('');
  const catOpts = (sel) => CATEGORIES.map(c => `<option value="${c}" ${sel === c ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('');
  list.innerHTML = importItems.map((it, i) => `
    <li class="import-row ${it.include ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" ${it.include ? 'checked' : ''} aria-label="Include">
      <input type="text" value="${escapeHtml(it.text)}" aria-label="Task text">
      <select class="imp-cat" aria-label="Category">${catOpts(it.category)}</select>
      <select class="imp-hour" aria-label="Time">${hourOpts(Number.isInteger(it.scheduledHour) ? it.scheduledHour : null)}</select>
    </li>`).join('');
  list.querySelectorAll('.import-row').forEach(row => {
    const it = importItems[Number(row.dataset.i)];
    row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => { it.include = e.target.checked; row.classList.toggle('off', !it.include); updateImportCount(); });
    row.querySelector('input[type="text"]').addEventListener('input', (e) => { it.text = e.target.value; });
    row.querySelector('.imp-cat').addEventListener('change', (e) => { it.category = e.target.value; });
    row.querySelector('.imp-hour').addEventListener('change', (e) => { it.scheduledHour = e.target.value === '' ? null : Number(e.target.value); });
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
    scheduled_hour: Number.isInteger(item.scheduledHour) ? item.scheduledHour : null
  }));
  const { data, error } = await db().from('tasks').insert(rows).select();
  if (error) { console.error(error); toast("Couldn't import those tasks.", 'error'); updateImportCount(); return; }
  state.tasks.push(...(data || []).map(normalizeTask));
  closeImport();
  renderToday();
  renderFocusPanel();
  toast(`Imported ${rows.length} task${rows.length > 1 ? 's' : ''} onto your timeline.`);
}

function closeImport() {
  $('import-modal').classList.remove('open');
  const src = $('import-img').src;
  if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  $('import-img').removeAttribute('src');
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
    { group: 'Actions', icon: 'i-play', label: focus.running ? 'Pause focus timer' : 'Start a 25-minute focus', run: () => { switchView('focus'); if (!focus.running) setFocusDuration(25); toggleFocus(); } },
    { group: 'Actions', icon: 'i-sparkle', label: 'Suggest my next action', run: () => { switchView('today'); handleAISuggest(); } },
    { group: 'Actions', icon: 'i-scan', label: 'Scan a schedule image', run: () => $('schedule-image-input').click() },
    { group: 'Actions', icon: 'i-feather', label: 'End-of-day reflection', run: openReflection },
    { group: 'Actions', icon: state.theme === 'dark' ? 'i-sun' : 'i-moon', label: `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} mode`, run: () => applyTheme(state.theme === 'dark' ? 'light' : 'dark') },
    { group: 'Actions', icon: 'i-gift', label: "What's new in 4.0", run: openWhatsNew },
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
    const { text, hour } = parseTaskInput(q);
    paletteItems.push({ group: 'Create', icon: 'i-plus', label: `Add task “${text}”${hour !== null ? ` at ${formatHour(hour)}` : ''}`, run: () => { switchView('today'); createTask(q, state.selectedCategory); } });
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
