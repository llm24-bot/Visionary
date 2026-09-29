// Independent, timestamp-based stopwatch. Never counts by adding interval ticks.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let running = false, accumulated = 0, startedAt = 0, interval = null;
  let mode = 'timer', lapAt = 0, lapNumber = 0;
  const elapsed = () => accumulated + (running ? Math.max(0, Date.now() - startedAt) : 0);
  const pad = (n) => String(n).padStart(2, '0');
  function format(ms) {
    const cs = Math.floor(ms / 10), seconds = Math.floor(cs / 100);
    const hours = Math.floor(seconds / 3600);
    return `${hours ? pad(hours) + ':' : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}.${pad(cs % 100)}`;
  }
  function render() {
    const parts = format(elapsed()).split('.');
    $('stopwatch-time').replaceChildren(document.createTextNode(parts[0]));
    const fraction = document.createElement('span');
    fraction.textContent = '.' + parts[1];
    $('stopwatch-time').append(fraction);
  }
  function controls() {
    $('stopwatch-start').textContent = running ? 'Pause' : accumulated ? 'Resume' : 'Start';
    $('stopwatch-secondary').textContent = running ? 'Lap' : 'Reset';
    $('stopwatch-secondary').disabled = !running && accumulated === 0;
    $('stopwatch-status').textContent = running ? 'Stopwatch running' : accumulated ? 'Paused' : 'Ready when you are';
    $('mode-stopwatch').textContent = running && mode !== 'stopwatch' ? 'Stopwatch · running' : 'Stopwatch';
  }
  function reset() {
    clearInterval(interval);
    running = false; accumulated = 0; lapAt = 0; lapNumber = 0;
    $('stopwatch-laps').replaceChildren();
    render(); controls();
  }
  $('stopwatch-start').addEventListener('click', () => {
    if (running) {
      accumulated = elapsed(); running = false; clearInterval(interval);
    } else {
      startedAt = Date.now(); running = true;
      interval = setInterval(() => { if (mode === 'stopwatch' && !document.hidden) render(); }, 40);
    }
    render(); controls();
  });
  $('stopwatch-secondary').addEventListener('click', () => {
    if (!running) return reset();
    const now = elapsed(), li = document.createElement('li');
    for (const value of [`Lap ${++lapNumber}`, format(now - lapAt), format(now)]) {
      const span = document.createElement('span'); span.textContent = value; li.append(span);
    }
    lapAt = now;
    $('stopwatch-laps').prepend(li);
    // Bound memory and DOM growth during long sessions.
    if ($('stopwatch-laps').children.length > 100) $('stopwatch-laps').lastElementChild.remove();
  });
  function switchMode(next) {
    mode = next;
    for (const name of ['timer', 'stopwatch']) {
      $(`${name}-panel`).hidden = name !== mode;
      $(`mode-${name}`).setAttribute('aria-pressed', String(name === mode));
      $(`mode-${name}`).classList.toggle('active', name === mode);
    }
    render(); controls();
  }
  $('mode-timer').addEventListener('click', () => switchMode('timer'));
  $('mode-stopwatch').addEventListener('click', () => switchMode('stopwatch'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.visionaryResetStopwatch = () => { reset(); switchMode('timer'); };
  reset();
})();
