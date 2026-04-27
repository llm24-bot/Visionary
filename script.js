// ============================================
// VISIONARY — Cloud-synced (Supabase)
// ============================================

// --- State ---
const state = {
  tasks: [],
  streak: 0,
  longestStreak: 0,
  lastCompleteDate: null,
  history: [],
  theme: localStorage.getItem('v-theme') || 'dark',
  selectedCategory: 'focus',
  currentView: 'today',
  analyticsPeriod: 7,
  currentUser: null,
  viewingDate: null,
};

const todayDate = () => new Date().toDateString();

// --- DOM refs ---
const $ = (id) => document.getElementById(id);

const taskInput = $('task-input');
const categorySelect = $('category-select');
const selectTrigger = $('select-trigger');
const selectLabel = $('select-label');
const selectOptions = $('select-options');
const addBtn = $('add-btn');
const taskList = $('task-list');
const emptyState = $('empty-state');
const streakCount = $('streak-count');
const completedCount = $('completed-count');
const totalCount = $('total-count');
const progressPercent = $('progress-percent');
const progressBar = $('progress-bar');
const timelineContainer = $('timeline-container');
const dateDisplay = $('date-display');
const nowTime = $('now-time');

const themeToggle = $('theme-toggle');
const themeIcon = $('theme-icon');
const reflectBtn = $('reflect-btn');

const reflectModal = $('reflect-modal');
const reflectClose = $('reflect-close');
const reflectDone = $('reflect-done');
const reflectTotal = $('reflect-total');
const reflectRate = $('reflect-rate');
const energySlider = $('energy-slider');
const focusSlider = $('focus-slider');
const energyVal = $('energy-val');
const focusVal = $('focus-val');
const reflectNote = $('reflect-note');
const reflectSave = $('reflect-save');

let chartCompletion = null;
let chartCategory = null;
let chartEnergy = null;

// --- Init ---
init();

async function init() {
  applyTheme(state.theme);
  renderDate();
  attachEventListeners();
  let currentLoadedDate = todayDate();
  setInterval(async () => {
  renderTimeline();
  renderDate();
  // If midnight passed, reload data
  if (todayDate() !== currentLoadedDate) {
    currentLoadedDate = todayDate();
    if (state.currentUser) {
      await loadAllData();
      renderTasks();
      renderTimeline();
      renderStats();
    }
  }
}, 60 * 1000);

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    state.currentUser = session.user;
    await loadAllData();
  }

  renderTimeline();
  renderTasks();
  renderStats();
}

// Re-init when auth changes
supabaseClient?.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') {
    state.currentUser = session.user;
    await loadAllData();
    renderTimeline();
    renderTasks();
    renderStats();
  } else if (event === 'SIGNED_OUT') {
    state.tasks = [];
    state.history = [];
    state.streak = 0;
    state.longestStreak = 0;
    state.currentUser = null;
  }
});

// --- Data loading ---
async function loadAllData() {
  await Promise.all([
    loadTasks(),
    loadProfile(),
    loadHistory(),
  ]);
}

async function loadTasks() {
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', todayDate())
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load tasks:', error); return; }

  state.tasks = (data || []).map(t => ({
    id: t.id,
    text: t.text,
    category: t.category,
    completed: t.completed,
    scheduledHour: t.scheduled_hour,
    createdAt: new Date(t.created_at).getTime(),
    completedAt: t.completed_at ? new Date(t.completed_at).getTime() : null,
  }));
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', state.currentUser.id)
    .single();
  if (error) { console.error('Failed to load profile:', error); return; }
  state.streak = data.streak || 0;
  state.longestStreak = data.longest_streak || 0;
  state.lastCompleteDate = data.last_complete_date;
}

async function loadHistory() {
  const { data, error } = await supabaseClient
    .from('reflections')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .order('date', { ascending: false });
  if (error) { console.error('Failed to load history:', error); return; }

  state.history = (data || []).map(h => ({
    date: h.date,
    timestamp: new Date(h.created_at).getTime(),
    total: h.total,
    completed: h.completed,
    rate: h.rate,
    energy: h.energy,
    focus: h.focus,
    note: h.note,
    categories: h.categories,
  }));
}

// --- Theme ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('v-theme', theme);

  if (theme === 'dark') {
    themeIcon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  } else {
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  if (state.currentView === 'analytics') renderAnalytics();
}

// --- Events ---
function attachEventListeners() {
  addBtn.addEventListener('click', handleAdd);
  taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAdd();
  });

  // Copy past day to today
  const copyBtn = document.getElementById('copy-to-today-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyDayToToday(selectedHistoryDate));
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Log out?')) logout();
    });
  }

  selectTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    categorySelect.classList.toggle('open');
  });
  selectOptions.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.selectedCategory = opt.dataset.value;
      selectLabel.textContent = opt.textContent;
      categorySelect.classList.remove('open');
    });
  });
  document.addEventListener('click', () => categorySelect.classList.remove('open'));

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  reflectBtn.addEventListener('click', openReflection);

  reflectClose.addEventListener('click', closeReflection);
  reflectModal.addEventListener('click', (e) => {
    if (e.target === reflectModal) closeReflection();
  });
  energySlider.addEventListener('input', () => energyVal.textContent = energySlider.value);
  focusSlider.addEventListener('input', () => focusVal.textContent = focusSlider.value);
  reflectSave.addEventListener('click', saveReflection);

  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.analyticsPeriod = btn.dataset.period === 'all' ? 9999 : parseInt(btn.dataset.period);
      renderAnalytics();
    });
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.getElementById('auth-screen')?.style.display !== 'none') return;

    if (e.key === 'n') {
      e.preventDefault();
      taskInput.focus();
    }
    if (e.key === 'Escape') {
      if (reflectModal.classList.contains('open')) closeReflection();
    }
  });
}

// --- View switching ---
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');

  if (view === 'analytics') renderAnalytics();
  if (view === 'history') renderHistoryList();
}

// --- Date / time ---
function renderDate() {
  const now = new Date();
  dateDisplay.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  nowTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// --- Task CRUD (cloud) ---
async function handleAdd() {
  const text = taskInput.value.trim();
  if (!text || !state.currentUser) return;

  const { data, error } = await supabaseClient
    .from('tasks')
    .insert({
      user_id: state.currentUser.id,
      text,
      category: state.selectedCategory,
      completed: false,
      date: todayDate(),
    })
    .select()
    .single();

  if (error) { console.error('Add failed:', error); return; }

  state.tasks.push({
    id: data.id,
    text: data.text,
    category: data.category,
    completed: data.completed,
    scheduledHour: data.scheduled_hour,
    createdAt: new Date(data.created_at).getTime(),
  });

  renderTasks();
  renderStats();
  taskInput.value = '';
  taskInput.focus();
}

async function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  const newCompleted = !task.completed;
  const { error } = await supabaseClient
    .from('tasks')
    .update({
      completed: newCompleted,
      completed_at: newCompleted ? new Date().toISOString() : null,
    })
    .eq('id', id);

  if (error) { console.error('Toggle failed:', error); return; }

  task.completed = newCompleted;
  if (newCompleted) task.completedAt = Date.now();
  renderTasks();
  renderTimeline();
  renderStats();
  checkStreak();
}

async function deleteTask(id) {
  const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
  if (error) { console.error('Delete failed:', error); return; }
  state.tasks = state.tasks.filter(t => t.id !== id);
  renderTasks();
  renderTimeline();
  renderStats();
}

async function scheduleTask(id, hour) {
  const { error } = await supabaseClient
    .from('tasks')
    .update({ scheduled_hour: hour })
    .eq('id', id);
  if (error) { console.error('Schedule failed:', error); return; }
  const task = state.tasks.find(t => t.id === id);
  if (task) task.scheduledHour = hour;
  renderTimeline();
  renderTasks();
}

async function unscheduleTask(id) {
  const { error } = await supabaseClient
    .from('tasks')
    .update({ scheduled_hour: null })
    .eq('id', id);
  if (error) { console.error('Unschedule failed:', error); return; }
  const task = state.tasks.find(t => t.id === id);
  if (task) task.scheduledHour = null;
  renderTimeline();
  renderTasks();
}

// --- Streak ---
async function checkStreak() {
  const today = todayDate();
  const allDone = state.tasks.length > 0 && state.tasks.every(t => t.completed);

  if (allDone && state.lastCompleteDate !== today) {
    state.streak++;
    state.longestStreak = Math.max(state.longestStreak, state.streak);
    state.lastCompleteDate = today;

    await supabaseClient
      .from('profiles')
      .update({
        streak: state.streak,
        longest_streak: state.longestStreak,
        last_complete_date: today,
      })
      .eq('id', state.currentUser.id);

    renderStats();
  }
}

// --- Reflection ---
function openReflection() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const rate = total === 0 ? 0 : Math.round((done / total) * 100);

  reflectDone.textContent = done;
  reflectTotal.textContent = total;
  reflectRate.textContent = rate;

  energySlider.value = 5;
  focusSlider.value = 5;
  energyVal.textContent = '5';
  focusVal.textContent = '5';
  reflectNote.value = '';

  reflectModal.classList.add('open');
}

function closeReflection() {
  reflectModal.classList.remove('open');
}

async function saveReflection() {
  if (!state.currentUser) return;

  const today = todayDate();
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;

  const categoryBreakdown = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  state.tasks.forEach(t => {
    if (t.completed && categoryBreakdown.hasOwnProperty(t.category)) {
      categoryBreakdown[t.category]++;
    }
  });

  const reflection = {
    user_id: state.currentUser.id,
    date: today,
    total,
    completed: done,
    rate: total === 0 ? 0 : done / total,
    energy: parseInt(energySlider.value),
    focus: parseInt(focusSlider.value),
    note: reflectNote.value.trim(),
    categories: categoryBreakdown,
  };

  const { error } = await supabaseClient
    .from('reflections')
    .upsert(reflection, { onConflict: 'user_id,date' });

  if (error) { console.error('Save reflection failed:', error); return; }

  state.history = state.history.filter(h => h.date !== today);
  state.history.unshift({
    date: today,
    timestamp: Date.now(),
    total,
    completed: done,
    rate: reflection.rate,
    energy: reflection.energy,
    focus: reflection.focus,
    note: reflection.note,
    categories: categoryBreakdown,
  });

  closeReflection();

  reflectBtn.style.animation = 'none';
  void reflectBtn.offsetWidth;
  reflectBtn.style.animation = 'slide-in 0.5s ease';
}

// --- Rendering: Today ---
function renderTasks() {
  taskList.innerHTML = '';

  if (state.tasks.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

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
      <button class="delete-btn" title="Delete">✕</button>
    `;

    li.querySelector('.task-checkbox').addEventListener('click', () => toggleTask(task.id));
    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    taskList.appendChild(li);
  });
}

function renderStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  streakCount.textContent = state.streak;
  completedCount.textContent = done;
  totalCount.textContent = total;
  progressPercent.textContent = pct;
  progressBar.style.width = pct + '%';
}

function renderTimeline() {
  const now = new Date();
  const currentHour = now.getHours();

  timelineContainer.innerHTML = '';

  for (let hour = 6; hour <= 23; hour++) {
    const block = document.createElement('div');
    block.className = 'hour-block';

    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = formatHour(hour);

    const slot = document.createElement('div');
    slot.className = 'hour-slot' + (hour === currentHour ? ' is-now' : '');
    slot.dataset.hour = hour;

    const scheduledHere = state.tasks.filter(t => t.scheduledHour === hour);
    scheduledHere.forEach(task => {
      const div = document.createElement('div');
      div.className = 'scheduled-task ' + task.category + (task.completed ? ' completed' : '');
      div.innerHTML = `
        <div class="task-category-dot ${task.category}"></div>
        <span>${escapeHtml(task.text)}</span>
        <button class="scheduled-remove" title="Unschedule">✕</button>
      `;
      div.querySelector('.scheduled-remove').addEventListener('click', () => unscheduleTask(task.id));
      slot.appendChild(div);
    });

    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.classList.add('drag-over');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      scheduleTask(id, hour);
    });

    block.appendChild(label);
    block.appendChild(slot);
    timelineContainer.appendChild(block);
  }

  const nowSlot = timelineContainer.querySelector('.is-now');
  if (nowSlot) {
    setTimeout(() => nowSlot.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }
}

// --- Rendering: Analytics ---
function renderAnalytics() {
  const period = state.analyticsPeriod;
  const cutoff = Date.now() - (period * 24 * 60 * 60 * 1000);
  const filtered = period === 9999
    ? state.history
    : state.history.filter(h => h.timestamp >= cutoff);

  const hasData = filtered.length > 0;
  $('analytics-empty').classList.toggle('visible', !hasData);

  const totalCompleted = filtered.reduce((sum, h) => sum + h.completed, 0);
  const totalTasks = filtered.reduce((sum, h) => sum + h.total, 0);
  const avgRate = totalTasks === 0 ? 0 : Math.round((totalCompleted / totalTasks) * 100);
  const avgEnergy = filtered.length === 0 ? '—' : (filtered.reduce((s, h) => s + h.energy, 0) / filtered.length).toFixed(1);

  $('summary-completed').textContent = totalCompleted;
  $('summary-rate').textContent = avgRate + '%';
  $('summary-energy').textContent = avgEnergy;
  $('summary-streak').textContent = state.longestStreak;

  renderChartCompletion(filtered);
  renderChartCategory(filtered);
  renderChartEnergy(filtered);
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
    accent5: styles.getPropertyValue('--accent-5').trim(),
  };
}

function renderChartCompletion(history) {
  const ctx = $('chart-completion').getContext('2d');
  const colors = getChartColors();
  const labels = history.map(h => new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const data = history.map(h => h.completed);

  if (chartCompletion) chartCompletion.destroy();
  chartCompletion = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Completed',
        data,
        backgroundColor: colors.accent1 + 'cc',
        borderRadius: 6,
      }],
    },
    options: chartBaseOptions(colors),
  });
}

function renderChartCategory(history) {
  const ctx = $('chart-category').getContext('2d');
  const colors = getChartColors();

  const totals = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  history.forEach(h => {
    Object.keys(totals).forEach(k => totals[k] += (h.categories?.[k] || 0));
  });

  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Focus', 'Health', 'Learn', 'Build', 'Rest'],
      datasets: [{
        data: [totals.focus, totals.health, totals.learn, totals.build, totals.rest],
        backgroundColor: [colors.accent1, colors.accent3, colors.accent2, colors.accent4, colors.accent5],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: colors.text, font: { family: 'Inter' } },
        },
      },
    },
  });
}

function renderChartEnergy(history) {
  const ctx = $('chart-energy').getContext('2d');
  const colors = getChartColors();
  const labels = history.map(h => new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

  if (chartEnergy) chartEnergy.destroy();
  chartEnergy = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Energy',
          data: history.map(h => h.energy),
          borderColor: colors.accent4,
          backgroundColor: colors.accent4 + '22',
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: colors.accent4,
        },
        {
          label: 'Focus',
          data: history.map(h => h.focus),
          borderColor: colors.accent1,
          backgroundColor: colors.accent1 + '22',
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: colors.accent1,
        },
      ],
    },
    options: {
      ...chartBaseOptions(colors),
      scales: {
        ...chartBaseOptions(colors).scales,
        y: { ...chartBaseOptions(colors).scales.y, min: 0, max: 10 },
      },
    },
  });
}

function chartBaseOptions(colors) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: colors.text, font: { family: 'Inter' } } },
    },
    scales: {
      x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
      y: { ticks: { color: colors.text }, grid: { color: colors.grid }, beginAtZero: true },
    },
  };
}

// --- Rendering: History ---
let selectedHistoryDate = null;

function renderHistoryList() {
  const listEl = $('history-list');
  const emptyEl = $('history-list-empty');

  if (state.history.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.innerHTML = '';

  state.history.forEach(day => {
    const li = document.createElement('li');
    li.className = 'history-day' + (day.date === selectedHistoryDate ? ' active' : '');

    const pct = Math.round((day.rate || 0) * 100);
    const dateObj = new Date(day.date);
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });

    li.innerHTML = `
      <div class="history-day-date">${dateLabel}</div>
      <div class="history-day-meta">
        <span>${day.completed}/${day.total}</span>
        <div class="history-day-bar">
          <div class="history-day-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span>${pct}%</span>
      </div>
    `;

    li.addEventListener('click', () => selectHistoryDay(day.date));
    listEl.appendChild(li);
  });
}

async function selectHistoryDay(date) {
  selectedHistoryDate = date;
  renderHistoryList();
  await renderHistoryDetail(date);
}

async function renderHistoryDetail(date) {
  const day = state.history.find(h => h.date === date);
  if (!day) return;

  const dateObj = new Date(date);
  const dateLabel = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  const pct = Math.round((day.rate || 0) * 100);

  $('history-detail-date').textContent = dateLabel;
  $('history-detail-summary').textContent =
    `Completed ${day.completed} of ${day.total} tasks · ${pct}%`;
  $('copy-to-today-btn').style.display = '';

  const { data: tasks, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', date)
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load past tasks:', error); return; }

  const body = $('history-detail-body');
  body.innerHTML = `
    <div class="history-stats">
      <div class="history-stat">
        <div class="history-stat-label">Tasks</div>
        <div class="history-stat-value">${day.completed}/${day.total}</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-label">Rate</div>
        <div class="history-stat-value">${pct}%</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-label">Energy</div>
        <div class="history-stat-value">${day.energy}/10</div>
      </div>
      <div class="history-stat">
        <div class="history-stat-label">Focus</div>
        <div class="history-stat-value">${day.focus}/10</div>
      </div>
    </div>

    ${(tasks && tasks.length > 0) ? `
      <div>
        <div class="history-section-title">Tasks that day</div>
        <ul class="history-task-list">
          ${tasks.map(t => `
            <li class="history-task ${t.completed ? 'was-completed' : ''}">
              <div class="task-category-dot ${t.category}"></div>
              <span>${escapeHtml(t.text)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    ${day.note ? `
      <div>
        <div class="history-section-title">Reflection note</div>
        <div class="history-note">"${escapeHtml(day.note)}"</div>
      </div>
    ` : ''}
  `;
}

// --- Copy past day to today ---
async function copyDayToToday(date) {
  if (!date || !state.currentUser) return;

  if (!confirm('Copy this day\'s tasks to today? This will add them as new uncompleted tasks.')) return;

  // Fetch past tasks
  const { data: pastTasks, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .eq('user_id', state.currentUser.id)
    .eq('date', date);

  if (error) { console.error('Copy fetch failed:', error); return; }
  if (!pastTasks || pastTasks.length === 0) {
    alert('No tasks to copy from that day.');
    return;
  }

  // Create new tasks for today (uncompleted)
  const today = todayDate();
  const newTasks = pastTasks.map(t => ({
    user_id: state.currentUser.id,
    text: t.text,
    category: t.category,
    completed: false,
    scheduled_hour: t.scheduled_hour,
    date: today,
  }));

  const { error: insertError } = await supabaseClient
    .from('tasks')
    .insert(newTasks);

  if (insertError) { console.error('Copy insert failed:', insertError); return; }

  // Reload today's tasks and switch view
  await loadTasks();
  renderTasks();
  renderTimeline();
  renderStats();
  switchView('today');
}

// --- Re-sync data when tab regains focus ---
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.currentUser) {
    // Check if session is still valid
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      // Session expired — let the auth state change handler kick in
      return;
    }
    // Check if it's a new day
    const lastSeen = state.lastVisibleDate || todayDate();
    state.lastVisibleDate = todayDate();
    if (lastSeen !== todayDate()) {
      // New day — reload everything
      await loadAllData();
    }
    renderTasks();
    renderTimeline();
    renderStats();
  }
});

// --- Helpers ---
function formatHour(hour) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:00 ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}