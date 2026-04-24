// ============================================
// VISIONARY v3 — Reflection, Analytics, Theme
// ============================================

// --- State ---
const state = {
  tasks: JSON.parse(localStorage.getItem('v-tasks')) || [],
  streak: parseInt(localStorage.getItem('v-streak')) || 0,
  longestStreak: parseInt(localStorage.getItem('v-longest-streak')) || 0,
  lastCompleteDate: localStorage.getItem('v-last-date') || null,
  history: JSON.parse(localStorage.getItem('v-history')) || [],
  theme: localStorage.getItem('v-theme') || 'dark',
  selectedCategory: 'focus',
  currentView: 'today',
  analyticsPeriod: 7,
};

// --- DOM refs ---
const $ = (id) => document.getElementById(id);

// Today view
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

// Nav
const themeToggle = $('theme-toggle');
const themeIcon = $('theme-icon');
const reflectBtn = $('reflect-btn');

// Reflection modal
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

// Charts
let chartCompletion = null;
let chartCategory = null;
let chartEnergy = null;

// --- Init ---
init();

function init() {
  applyTheme(state.theme);
  renderDate();
  renderTimeline();
  renderTasks();
  renderStats();
  attachEventListeners();
  checkForNewDay();
  setInterval(() => { renderTimeline(); renderDate(); }, 60 * 1000);
}

// --- Theme ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('v-theme', theme);

  // Swap sun/moon icon
  if (theme === 'dark') {
    themeIcon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';
  } else {
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  }

  // Re-render charts with new theme colors
  if (state.currentView === 'analytics') renderAnalytics();
}

// --- Events ---
function attachEventListeners() {
  // Task input
  addBtn.addEventListener('click', handleAdd);
  taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAdd();
  });

  // Custom dropdown
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

  // Nav
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  themeToggle.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  reflectBtn.addEventListener('click', openReflection);

  // Reflection modal
  reflectClose.addEventListener('click', closeReflection);
  reflectModal.addEventListener('click', (e) => {
    if (e.target === reflectModal) closeReflection();
  });
  energySlider.addEventListener('input', () => energyVal.textContent = energySlider.value);
  focusSlider.addEventListener('input', () => focusVal.textContent = focusSlider.value);
  reflectSave.addEventListener('click', saveReflection);

  // Analytics period
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.analyticsPeriod = btn.dataset.period === 'all' ? 9999 : parseInt(btn.dataset.period);
      renderAnalytics();
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && document.activeElement !== taskInput && document.activeElement !== reflectNote) {
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
}

// --- Date / time ---
function renderDate() {
  const now = new Date();
  dateDisplay.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  nowTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// --- New day check: carry uncompleted tasks forward ---
function checkForNewDay() {
  const today = new Date().toDateString();
  const lastSeen = localStorage.getItem('v-last-seen');
  if (lastSeen && lastSeen !== today) {
    // Different day — clear completed tasks, keep uncompleted
    state.tasks = state.tasks.filter(t => !t.completed);
    // Reset their scheduled hours (yesterday's schedule doesn't apply)
    state.tasks.forEach(t => t.scheduledHour = null);
    save();
    renderTasks();
    renderTimeline();
  }
  localStorage.setItem('v-last-seen', today);
}

// --- Task CRUD ---
function handleAdd() {
  const text = taskInput.value.trim();
  if (!text) return;

  state.tasks.push({
    id: Date.now() + Math.random(),
    text,
    category: state.selectedCategory,
    completed: false,
    scheduledHour: null,
    createdAt: Date.now(),
  });

  save();
  renderTasks();
  renderStats();
  taskInput.value = '';
  taskInput.focus();
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed) task.completedAt = Date.now();
  save();
  renderTasks();
  renderTimeline();
  renderStats();
  checkStreak();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  save();
  renderTasks();
  renderTimeline();
  renderStats();
}

function scheduleTask(id, hour) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.scheduledHour = hour;
  save();
  renderTimeline();
  renderTasks();
}

function unscheduleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.scheduledHour = null;
  save();
  renderTimeline();
  renderTasks();
}

function save() {
  localStorage.setItem('v-tasks', JSON.stringify(state.tasks));
  localStorage.setItem('v-streak', state.streak);
  localStorage.setItem('v-longest-streak', state.longestStreak);
  localStorage.setItem('v-history', JSON.stringify(state.history));
  if (state.lastCompleteDate) localStorage.setItem('v-last-date', state.lastCompleteDate);
}

// --- Streak logic ---
function checkStreak() {
  const today = new Date().toDateString();
  const allDone = state.tasks.length > 0 && state.tasks.every(t => t.completed);

  if (allDone && state.lastCompleteDate !== today) {
    state.streak++;
    state.longestStreak = Math.max(state.longestStreak, state.streak);
    state.lastCompleteDate = today;
    save();
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

function saveReflection() {
  const today = new Date().toDateString();
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.completed).length;

  // Build category breakdown
  const categoryBreakdown = { focus: 0, health: 0, learn: 0, build: 0, rest: 0 };
  state.tasks.forEach(t => {
    if (t.completed && categoryBreakdown.hasOwnProperty(t.category)) {
      categoryBreakdown[t.category]++;
    }
  });

  // Remove any existing entry for today (re-reflecting)
  state.history = state.history.filter(h => h.date !== today);

  state.history.push({
    date: today,
    timestamp: Date.now(),
    total,
    completed: done,
    rate: total === 0 ? 0 : done / total,
    energy: parseInt(energySlider.value),
    focus: parseInt(focusSlider.value),
    note: reflectNote.value.trim(),
    categories: categoryBreakdown,
  });

  save();
  closeReflection();

  // Brief visual confirmation
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
      const id = parseFloat(e.dataTransfer.getData('text/plain'));
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

  // Summary cards
  const totalCompleted = filtered.reduce((sum, h) => sum + h.completed, 0);
  const totalTasks = filtered.reduce((sum, h) => sum + h.total, 0);
  const avgRate = totalTasks === 0 ? 0 : Math.round((totalCompleted / totalTasks) * 100);
  const avgEnergy = filtered.length === 0 ? '—' : (filtered.reduce((s, h) => s + h.energy, 0) / filtered.length).toFixed(1);

  $('summary-completed').textContent = totalCompleted;
  $('summary-rate').textContent = avgRate + '%';
  $('summary-energy').textContent = avgEnergy;
  $('summary-streak').textContent = state.longestStreak;

  // Charts
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
        y: {
          ...chartBaseOptions(colors).scales.y,
          min: 0,
          max: 10,
        },
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