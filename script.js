// ============================================
// VISIONARY — Cloud-synced (Supabase)
// ============================================

// --- State ---
const todayDate = () => new Date().toDateString();
const $ = (id) => document.getElementById(id);

const state = {
  tasks: [],
  streak: 0,
  longestStreak: 0,
  lastCompleteDate: null,
  history: [],
  theme: 'dark',
  selectedCategory: 'focus',
  currentView: 'today',
  analyticsPeriod: 7,
  currentUser: null
};

const els = {
  taskInput: $('task-input'),
  categorySelect: $('category-select'),
  selectTrigger: $('select-trigger'),
  selectLabel: $('select-label'),
  selectOptions: $('select-options'),
  addBtn: $('add-btn'),
  taskList: $('task-list'),
  emptyState: $('empty-state'),
  streakCount: $('streak-count'),
  completedCount: $('completed-count'),
  totalCount: $('total-count'),
  progressPercent: $('progress-percent'),
  progressBar: $('progress-bar'),
  timelineContainer: $('timeline-container'),
  dateDisplay: $('date-display'),
  nowTime: $('now-time'),
  themeToggle: $('theme-toggle'),
  themeIcon: $('theme-icon'),
  reflectBtn: $('reflect-btn'),
  reflectModal: $('reflect-modal'),
  reflectClose: $('reflect-close'),
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
  aiInsightText: $('ai-insight-text')
};

let chartCompletion = null;
let chartCategory = null;
let chartEnergy = null;
let selectedHistoryDate = null;
let currentLoadedDate = todayDate();
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  applyTheme('dark');
  renderDate();
  attachEventListeners();

  setInterval(async () => {
    renderDate();
    renderTimeline();
    if (todayDate() !== currentLoadedDate) {
      currentLoadedDate = todayDate();
      if (state.currentUser) {
        await loadAllData();
        renderAll();
      }
    }
  }, 60000);

  setInterval(async () => {
    if (document.visibilityState === 'visible' && state.currentUser) {
      await loadTasks();
      renderTasks();
      renderTimeline();
      renderStats();
    }
  }, 30000);

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.currentUser) {
      await loadAllData();
      renderAll();
    }
  });

  renderAll();
}

window.visionaryOnSignedIn = async function(user) {
  state.currentUser = user;
  currentLoadedDate = todayDate();
  await ensureProfile(user.id);
  await loadAllData();
  renderAll();
};

window.visionaryOnSignedOut = function() {
  state.currentUser = null;
  state.tasks = [];
  state.history = [];
  state.streak = 0;
  state.longestStreak = 0;
  state.lastCompleteDate = null;
  selectedHistoryDate = null;
  renderAll();
};

async function ensureProfile(userId) {
  const payload = { id: userId, streak: 0, longest_streak: 0, last_complete_date: null };
  const { error } = await supabaseClient.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) console.error('Profile bootstrap failed:', error);
}

async function loadAllData() {
  if (!state.currentUser) return;
  await Promise.all([loadTasks(), loadProfile(), loadHistory()]);
}

async function loadTasks() {
  if (!state.currentUser) return;
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', todayDate())
    .order('created_at', { ascending: true });
  if (error) return console.error('Failed to load tasks:', error);
  state.tasks = (data || []).map(t => ({
    id: t.id,
    text: t.text,
    category: t.category,
    completed: !!t.completed,
    scheduledHour: Number.isInteger(t.scheduled_hour) ? t.scheduled_hour : null,
    createdAt: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
    completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null
  }));
}

async function loadProfile() {
  if (!state.currentUser) return;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', state.currentUser.id)
    .single();
  if (error) return console.error('Failed to load profile:', error);
  state.streak = data?.streak || 0;
  state.longestStreak = data?.longest_streak || 0;
  state.lastCompleteDate = data?.last_complete_date || null;
}

async function loadHistory() {
  if (!state.currentUser) return;
  const { data, error } = await supabaseClient
    .from('reflections')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('date', { ascending: false });
  if (error) return console.error('Failed to load history:', error);
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

function attachEventListeners() {
  els.addBtn?.addEventListener('click', handleAdd);
  els.taskInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });
  els.selectTrigger?.addEventListener('click', (e) => { e.stopPropagation(); els.categorySelect?.classList.toggle('open'); });
  els.selectOptions?.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.selectedCategory = opt.dataset.value;
      els.selectLabel.textContent = opt.textContent;
      els.categorySelect.classList.remove('open');
    });
  });
  document.addEventListener('click', () => els.categorySelect?.classList.remove('open'));
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('.period-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.analyticsPeriod = btn.dataset.period === 'all' ? 9999 : parseInt(btn.dataset.period, 10);
    renderAnalytics();
  }));
  els.themeToggle?.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  els.reflectBtn?.addEventListener('click', openReflection);
  els.reflectClose?.addEventListener('click', closeReflection);
  els.reflectModal?.addEventListener('click', (e) => { if (e.target === els.reflectModal) closeReflection(); });
  els.energySlider?.addEventListener('input', () => { els.energyVal.textContent = els.energySlider.value; });
  els.focusSlider?.addEventListener('input', () => { els.focusVal.textContent = els.focusSlider.value; });
  els.reflectSave?.addEventListener('click', saveReflection);
  els.copyToTodayBtn?.addEventListener('click', () => { if (selectedHistoryDate) copyDayToToday(selectedHistoryDate); });
  $('logout-btn')?.addEventListener('click', () => { if (confirm('Log out?')) logout(); });
  document.addEventListener('keydown', (e) => {
    if (document.activeElement?.matches('input, textarea')) return;
    if ($('auth-screen')?.style.display !== 'none') return;
    if (e.key === 'n') { e.preventDefault(); els.taskInput?.focus(); }
    if (e.key === 'Escape' && els.reflectModal?.classList.contains('open')) closeReflection();
  });
  els.aiSuggestBtn?.addEventListener('click', handleAISuggest);
}

function renderAll() {
  renderDate();
  renderTasks();
  renderTimeline();
  renderStats();
  if (state.currentView === 'history') renderHistoryList();
  if (state.currentView === 'analytics') renderAnalytics();
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view)?.classList.add('active');
  if (view === 'history') renderHistoryList();
  if (view === 'analytics') renderAnalytics();
}

function renderDate() {
  const now = new Date();
  els.dateDisplay.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  els.nowTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  els.themeIcon.innerHTML = theme === 'dark'
    ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  if (state.currentView === 'analytics') renderAnalytics();
}

async function handleAdd() {
  const text = els.taskInput.value.trim();
  if (!text || !state.currentUser) return;
  const { data, error } = await supabaseClient
    .from('tasks')
    .insert({ user_id: state.currentUser.id, text, category: state.selectedCategory, completed: false, date: todayDate() })
    .select()
    .single();
  if (error) return console.error('Add failed:', error);
  state.tasks.push({
    id: data.id,
    text: data.text,
    category: data.category,
    completed: !!data.completed,
    scheduledHour: Number.isInteger(data.scheduled_hour) ? data.scheduled_hour : null,
    createdAt: new Date(data.created_at).getTime(),
    completedAt: data.completed_at ? new Date(data.completed_at).getTime() : null
  });
  els.taskInput.value = '';
  els.taskInput.focus();
  renderTasks();
  renderTimeline();
  renderStats();
}

async function toggleTask(id) {
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (!task) return;
  const newCompleted = !task.completed;
  const { error } = await supabaseClient
    .from('tasks')
    .update({ completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return console.error('Toggle failed:', error);
  task.completed = newCompleted;
  task.completedAt = newCompleted ? Date.now() : null;
  renderTasks();
  renderTimeline();
  renderStats();
  await checkStreak();
}

async function deleteTask(id) {
  const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
  if (error) return console.error('Delete failed:', error);
  state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
  renderTasks();
  renderTimeline();
  renderStats();
}

async function scheduleTask(id, hour) {
  const { error } = await supabaseClient.from('tasks').update({ scheduled_hour: hour }).eq('id', id);
  if (error) return console.error('Schedule failed:', error);
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (task) task.scheduledHour = hour;
  renderTasks();
  renderTimeline();
}

async function unscheduleTask(id) {
  const { error } = await supabaseClient.from('tasks').update({ scheduled_hour: null }).eq('id', id);
  if (error) return console.error('Unschedule failed:', error);
  const task = state.tasks.find(t => String(t.id) === String(id));
  if (task) task.scheduledHour = null;
  renderTasks();
  renderTimeline();
}

async function checkStreak() {
  const today = todayDate();
  const allDone = state.tasks.length > 0 && state.tasks.every(t => t.completed);
  if (!allDone || state.lastCompleteDate === today || !state.currentUser) return;
  state.streak += 1;
  state.longestStreak = Math.max(state.longestStreak, state.streak);
  state.lastCompleteDate = today;
  const { error } = await supabaseClient
    .from('profiles')
    .update({ streak: state.streak, longest_streak: state.longestStreak, last_complete_date: today })
    .eq('id', state.currentUser.id);
  if (error) console.error('Streak update failed:', error);
  renderStats();
}

function openReflection() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const rate = total ? Math.round((done / total) * 100) : 0;
  els.reflectDone.textContent = done;
  els.reflectTotal.textContent = total;
  els.reflectRate.textContent = rate;
  els.energySlider.value = 5;
  els.focusSlider.value = 5;
  els.energyVal.textContent = '5';
  els.focusVal.textContent = '5';
  els.reflectNote.value = '';
  els.aiInsightArea.style.display = 'none';
  els.reflectModal.classList.add('open');
}

function closeReflection() {
  els.reflectModal.classList.remove('open');
}

async function saveReflection() {
  if (!state.currentUser) return;
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const categoryBreakdown = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  state.tasks.forEach(t => { if (t.completed && categoryBreakdown[t.category] !== undefined) categoryBreakdown[t.category] += 1; });
  const reflection = {
    user_id: state.currentUser.id,
    date: todayDate(),
    total,
    completed: done,
    rate: total ? done / total : 0,
    energy: parseInt(els.energySlider.value, 10),
    focus: parseInt(els.focusSlider.value, 10),
    note: els.reflectNote.value.trim(),
    categories: categoryBreakdown
  };
  const { error } = await supabaseClient.from('reflections').upsert(reflection, { onConflict: 'user_id,date' });
  if (error) return console.error('Save reflection failed:', error);
  state.history = state.history.filter(h => h.date !== reflection.date);
  state.history.unshift({ ...reflection, timestamp: Date.now() });
  await showReflectionInsight();
  renderAnalytics();
  setTimeout(() => {
    closeReflection();
    els.aiInsightArea.style.display = 'none';
  }, 4000);
}

function renderTasks() {
  els.taskList.innerHTML = '';
  if (state.tasks.length === 0) {
    els.emptyState.classList.remove('hidden');
    return;
  }
  els.emptyState.classList.add('hidden');
  state.tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    li.draggable = true;
    li.dataset.id = task.id;
    li.innerHTML = `
      <div class="task-category-dot ${task.category}"></div>
      <div class="task-checkbox ${task.completed ? 'checked' : ''}"></div>
      <span class="task-text">${escapeHtml(task.text)}</span>
      ${task.scheduledHour !== null ? `<span class="task-time">${formatHour(task.scheduledHour)}</span>` : ''}
      <button class="delete-btn" type="button" title="Delete">✕</button>`;
    li.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(task.id));
    li.querySelector('.delete-btn').addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(task.id)); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    els.taskList.appendChild(li);
  });
}

function renderStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.streakCount.textContent = state.streak;
  els.completedCount.textContent = done;
  els.totalCount.textContent = total;
  els.progressPercent.textContent = pct;
  els.progressBar.style.width = pct + '%';
}

function renderTimeline() {
  els.timelineContainer.innerHTML = '';
  const currentHour = new Date().getHours();
  for (let hour = 0; hour < 24; hour += 1) {
    const block = document.createElement('div');
    block.className = 'hour-block';
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = formatHour(hour);
    const slot = document.createElement('div');
    slot.className = 'hour-slot' + (hour === currentHour ? ' is-now' : '');
    slot.dataset.hour = hour;
    state.tasks.filter(t => t.scheduledHour === hour).forEach(task => {
      const div = document.createElement('div');
      div.className = 'scheduled-task ' + task.category + (task.completed ? ' completed' : '');
      div.innerHTML = `<div class="task-category-dot ${task.category}"></div><span>${escapeHtml(task.text)}</span><button class="scheduled-remove" type="button" title="Unschedule">✕</button>`;
      div.querySelector('.scheduled-remove').addEventListener('click', () => unscheduleTask(task.id));
      slot.appendChild(div);
    });
    slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      scheduleTask(id, hour);
    });
    block.appendChild(label);
    block.appendChild(slot);
    els.timelineContainer.appendChild(block);
  }
}

function renderAnalytics() {
  const period = state.analyticsPeriod;
  const cutoff = Date.now() - period * 24 * 60 * 60 * 1000;
  const filtered = period === 9999 ? state.history : state.history.filter(h => h.timestamp >= cutoff);
  const chartData = [...filtered].reverse();
  const hasData = filtered.length > 0;
  els.analyticsEmpty.classList.toggle('visible', !hasData);
  $('summary-completed').textContent = filtered.reduce((sum, h) => sum + h.completed, 0);
  const totalTasks = filtered.reduce((sum, h) => sum + h.total, 0);
  const totalCompleted = filtered.reduce((sum, h) => sum + h.completed, 0);
  $('summary-rate').textContent = (totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0) + '%';
  $('summary-energy').textContent = filtered.length ? (filtered.reduce((s, h) => s + h.energy, 0) / filtered.length).toFixed(1) : '—';
  $('summary-streak').textContent = state.longestStreak;
  renderChartCompletion(chartData);
  renderChartCategory(filtered);
  renderChartEnergy(chartData);
}

function getChartColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--text-dim').trim(),
    grid: styles.getPropertyValue('--border').trim(),
    accent1: styles.getPropertyValue('--accent-1').trim(),
    accent2: styles.getPropertyValue('--accent-2').trim(),
    accent3: styles.getPropertyValue('--accent-3').trim(),
    accent4: styles.getPropertyValue('--accent-4').trim(),
    accent5: styles.getPropertyValue('--accent-5').trim()
  };
}

function chartBaseOptions(colors) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: colors.text } } },
    scales: {
      x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
      y: { ticks: { color: colors.text }, grid: { color: colors.grid }, beginAtZero: true }
    }
  };
}

function renderChartCompletion(history) {
  const canvas = $('chart-completion');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = getChartColors();
  if (chartCompletion) chartCompletion.destroy();
  chartCompletion = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: history.map(h => new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [{ label: 'Completed', data: history.map(h => h.completed), backgroundColor: colors.accent1 + 'cc', borderRadius: 8 }]
    },
    options: chartBaseOptions(colors)
  });
}

function renderChartCategory(history) {
  const canvas = $('chart-category');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = getChartColors();
  const totals = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  history.forEach(h => Object.keys(totals).forEach(k => { totals[k] += h.categories?.[k] || 0; }));
  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Focus', 'Health', 'Learn', 'Build', 'Rest'],
      datasets: [{ data: [totals.focus, totals.health, totals.learn, totals.build, totals.rest], backgroundColor: [colors.accent1, colors.accent3, colors.accent2, colors.accent4, colors.accent5], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: colors.text } } } }
  });
}

function renderChartEnergy(history) {
  const canvas = $('chart-energy');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = getChartColors();
  if (chartEnergy) chartEnergy.destroy();
  chartEnergy = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [
        { label: 'Energy', data: history.map(h => h.energy), borderColor: colors.accent4, backgroundColor: colors.accent4 + '22', tension: .35, pointRadius: 4 },
        { label: 'Focus', data: history.map(h => h.focus), borderColor: colors.accent1, backgroundColor: colors.accent1 + '22', tension: .35, pointRadius: 4 }
      ]
    },
    options: { ...chartBaseOptions(colors), scales: { ...chartBaseOptions(colors).scales, y: { ...chartBaseOptions(colors).scales.y, min: 0, max: 10 } } }
  });
}

function renderHistoryList() {
  els.historyList.innerHTML = '';
  if (!state.history.length) {
    els.historyListEmpty.classList.remove('hidden');
    return;
  }
  els.historyListEmpty.classList.add('hidden');
  state.history.forEach(day => {
    const li = document.createElement('li');
    li.className = 'history-day' + (day.date === selectedHistoryDate ? ' active' : '');
    const pct = Math.round((day.rate || 0) * 100);
    const dateLabel = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    li.innerHTML = `<div class="history-day-date">${dateLabel}</div><div class="history-day-meta"><span>${day.completed}/${day.total}</span><div class="history-day-bar"><div class="history-day-bar-fill" style="width:${pct}%"></div></div><span>${pct}%</span></div>`;
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
  els.historyDetailDate.textContent = new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  els.historyDetailSummary.textContent = `Completed ${day.completed} of ${day.total} tasks · ${pct}%`;
  els.copyToTodayBtn.classList.remove('hidden');
  const { data: tasks, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', date)
    .order('created_at', { ascending: true });
  if (error) return console.error('Failed to load past tasks:', error);
  els.historyDetailBody.innerHTML = `
    <div class="history-stats">
      <div class="history-stat"><div class="history-stat-label">Tasks</div><div class="history-stat-value">${day.completed}/${day.total}</div></div>
      <div class="history-stat"><div class="history-stat-label">Rate</div><div class="history-stat-value">${pct}%</div></div>
      <div class="history-stat"><div class="history-stat-label">Energy</div><div class="history-stat-value">${day.energy}/10</div></div>
      <div class="history-stat"><div class="history-stat-label">Focus</div><div class="history-stat-value">${day.focus}/10</div></div>
    </div>
    ${(tasks && tasks.length) ? `<div><div class="history-section-title">Tasks that day</div><ul class="task-list">${tasks.map(t => `<li class="history-task ${t.completed ? 'was-completed' : ''}"><div class="task-category-dot ${t.category}"></div><span>${escapeHtml(t.text)}</span></li>`).join('')}</ul></div>` : ''}
    ${day.note ? `<div><div class="history-section-title">Reflection note</div><div class="history-note">"${escapeHtml(day.note)}"</div></div>` : ''}`;
}

async function copyDayToToday(date) {
  if (!date || !state.currentUser) return;
  if (!confirm("Copy this day's tasks to today? This will add them as new uncompleted tasks.")) return;
  const { data: pastTasks, error } = await supabaseClient.from('tasks').select('*').eq('user_id', state.currentUser.id).eq('date', date);
  if (error) return console.error('Copy fetch failed:', error);
  if (!pastTasks?.length) return alert('No tasks to copy from that day.');
  const today = todayDate();
  const newTasks = pastTasks.map(t => ({ user_id: state.currentUser.id, text: t.text, category: t.category, completed: false, scheduled_hour: t.scheduled_hour, date: today }));
  const { error: insertError } = await supabaseClient.from('tasks').insert(newTasks);
  if (insertError) return console.error('Copy insert failed:', insertError);
  await loadTasks();
  renderTasks();
  renderTimeline();
  renderStats();
  switchView('today');
}

async function callAI(mode, payload = {}) {
  try {
    const { data, error } = await supabaseClient.functions.invoke('ai-suggest', {
      body: { mode, tasks: state.tasks, history: state.history, currentHour: new Date().getHours(), ...payload }
    });
    if (error) throw error;
    return data?.suggestion || null;
  } catch (error) {
    console.error('AI call failed:', error);
    return null;
  }
}

async function handleAISuggest() {
  if (!state.currentUser) return;
  els.aiSuggestBtn.disabled = true;
  els.aiSuggestLabel.textContent = 'Thinking...';
  const suggestion = await callAI('next-action');
  els.aiSuggestBtn.disabled = false;
  els.aiSuggestLabel.textContent = 'Suggest';
  showAISuggestion(suggestion || "Couldn't reach the AI right now. Try again in a moment.");
}

function showAISuggestion(text) {
  document.querySelector('.ai-suggestion-popup')?.remove();
  const focusCard = document.querySelector('.col-left .glass-card');
  if (!focusCard) return;
  const popup = document.createElement('div');
  popup.className = 'ai-suggestion-popup';
  popup.innerHTML = `${escapeHtml(text)}<button class="ai-suggestion-close" type="button" title="Dismiss">✕</button>`;
  popup.querySelector('.ai-suggestion-close').addEventListener('click', () => popup.remove());
  focusCard.appendChild(popup);
  setTimeout(() => popup.remove(), 30000);
}

async function showReflectionInsight() {
  if (!els.aiInsightArea || !els.aiInsightText) return;
  els.aiInsightArea.style.display = 'block';
  els.aiInsightText.textContent = 'Thinking about your day...';
  const insight = await callAI('insight');
  if (insight) els.aiInsightText.textContent = insight;
  else els.aiInsightArea.style.display = 'none';
}

function formatHour(hour) {
  const h = hour % 12 || 12;
  return `${h}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

function escapeHtml(str = '') {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();