// ============================================
// VISIONARY v2 — Logic
// Data layer is clean/separated so AI can plug in later
// ============================================

// --- State (single source of truth) ---
const state = {
  tasks: JSON.parse(localStorage.getItem('v-tasks')) || [],
  streak: parseInt(localStorage.getItem('v-streak')) || 0,
  lastCompleteDate: localStorage.getItem('v-last-date') || null,
};

// --- DOM refs ---
const $ = (id) => document.getElementById(id);
const taskInput = $('task-input');
const categorySelect = $('task-category');
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
const aiToggle = $('ai-toggle');
const aiPanel = $('ai-panel');
const aiClose = $('ai-close');

// --- Init ---
init();

function init() {
  renderDate();
  renderTimeline();
  renderTasks();
  renderStats();
  attachEventListeners();
  // Update "now" indicator every minute
  setInterval(() => { renderTimeline(); renderDate(); }, 60 * 1000);
}

// --- Events ---
function attachEventListeners() {
  addBtn.addEventListener('click', handleAdd);
  taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAdd();
  });

  // Keyboard shortcut: N to focus input
  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && document.activeElement !== taskInput) {
      e.preventDefault();
      taskInput.focus();
    }
    if (e.key === 'Escape' && aiPanel.classList.contains('open')) {
      aiPanel.classList.remove('open');
    }
  });

  aiToggle.addEventListener('click', () => aiPanel.classList.toggle('open'));
  aiClose.addEventListener('click', () => aiPanel.classList.remove('open'));
}

// --- Date / time ---
function renderDate() {
  const now = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  dateDisplay.textContent = now.toLocaleDateString('en-US', opts);
  nowTime.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// --- Task CRUD ---
function handleAdd() {
  const text = taskInput.value.trim();
  if (!text) return;

  const task = {
    id: Date.now() + Math.random(),
    text,
    category: categorySelect.value,
    completed: false,
    scheduledHour: null, // set when dragged to timeline
    createdAt: Date.now(),
  };

  state.tasks.push(task);
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
}

function unscheduleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.scheduledHour = null;
  save();
  renderTimeline();
}

function save() {
  localStorage.setItem('v-tasks', JSON.stringify(state.tasks));
  localStorage.setItem('v-streak', state.streak);
  if (state.lastCompleteDate) localStorage.setItem('v-last-date', state.lastCompleteDate);
}

// --- Streak logic ---
function checkStreak() {
  const today = new Date().toDateString();
  const allDone = state.tasks.length > 0 && state.tasks.every(t => t.completed);

  if (allDone && state.lastCompleteDate !== today) {
    state.streak++;
    state.lastCompleteDate = today;
    save();
    renderStats();
    celebrate();
  }
}

function celebrate() {
  // Tiny celebration: pulse the streak
  const card = streakCount.closest('.stat-card');
  if (!card) return;
  card.style.animation = 'none';
  void card.offsetWidth; // trigger reflow
  card.style.animation = 'slide-in 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
}

// --- Rendering ---
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

    // Drag handlers
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

    // Add scheduled tasks
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

    // Drop handlers
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

  // Scroll to current hour
  const nowSlot = timelineContainer.querySelector('.is-now');
  if (nowSlot) {
    setTimeout(() => {
      nowSlot.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
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

// ============================================
// AI HOOK (placeholder — plug in later)
// ============================================
// When you're ready to add AI:
// 1. Call an API (OpenAI/Anthropic) with `state.tasks` as context
// 2. Parse suggestions
// 3. Render them into #ai-panel
// 4. User can accept → calls scheduleTask() / handleAdd()
//
// The data structure is already AI-ready: each task has
// category, completed status, scheduled time, created time.
// Perfect for pattern learning later.