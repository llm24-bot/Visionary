// Get references to the DOM elements
const taskInput = document.getElementById('task-input');
const addBtn = document.getElementById('add-btn');
const taskList = document.getElementById('task-list');
const streakCount = document.getElementById('streak-count');

// Load tasks from localStorage when page loads
let tasks = JSON.parse(localStorage.getItem('visionary-tasks')) || [];
let streak = parseInt(localStorage.getItem('visionary-streak')) || 0;

// Display the initial state
renderTasks();
streakCount.textContent = streak;

// Add a task when Add button is clicked
addBtn.addEventListener('click', addTask);

// Add a task when Enter key is pressed in the input
taskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTask();
});

function addTask() {
  const text = taskInput.value.trim();
  if (!text) return; // Don't add empty tasks

  const newTask = {
    id: Date.now(),
    text: text,
    completed: false
  };

  tasks.push(newTask);
  saveTasks();
  renderTasks();

  taskInput.value = ''; // Clear input
  taskInput.focus(); // Keep cursor in input
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    renderTasks();
    updateStreak();
  }
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveTasks();
  renderTasks();
}

function renderTasks() {
  taskList.innerHTML = ''; // Clear the list

  if (tasks.length === 0) {
    taskList.innerHTML = '<li style="color: #71717a; text-align: center; padding: 1rem;">No tasks yet. Add one above.</li>';
    return;
  }

  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');

    li.innerHTML = `
      <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
      <span class="task-text">${task.text}</span>
      <button class="delete-btn">×</button>
    `;

    // Add event listeners
    li.querySelector('.task-checkbox').addEventListener('change', () => toggleTask(task.id));
    li.querySelector('.delete-btn').addEventListener('click', () => deleteTask(task.id));

    taskList.appendChild(li);
  });
}

function saveTasks() {
  localStorage.setItem('visionary-tasks', JSON.stringify(tasks));
}

function updateStreak() {
  // If all tasks are completed, increment streak
  const allCompleted = tasks.length > 0 && tasks.every(t => t.completed);
  if (allCompleted) {
    streak++;
    localStorage.setItem('visionary-streak', streak);
    streakCount.textContent = streak;
  }
}