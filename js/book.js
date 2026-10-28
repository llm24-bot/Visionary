// @ts-check
/**
 * Public booking page (/book?u=slug).
 *
 * Works without an account. It calls two security-definer RPCs with the
 * publishable key: `public_availability` (free/busy only, no titles) and
 * `request_booking` (rate-limited, clash-checked server side). Slots are
 * computed in the owner's time zone and displayed in the visitor's.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cfg = window.VISIONARY_CONFIG;
  const slug = new URLSearchParams(location.search).get('u') || '';
  const visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const pad = (n) => String(n).padStart(2, '0');

  /** @type {any} */ let settings = null;
  /** @type {Record<string, number[]>} */ let slotsByDate = {};
  /** @type {Date | null} */ let selected = null;
  let selectedDate = '';

  async function rpc(name, body) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabasePublishableKey, Authorization: `Bearer ${cfg.supabasePublishableKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`${name} failed (${res.status})`);
    return res.json();
  }

  /** Local calendar date (YYYY-MM-DD) and wall-clock parts of `d` in time zone `tz`. */
  function partsIn(d, tz) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
    const o = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
    return { date: `${o.year}-${o.month}-${o.day}`, minutes: Number(o.hour) * 60 + Number(o.minute), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) };
  }

  /** The UTC instant for wall-clock `date` + `minutes` in time zone `tz` (iterative DST-safe search). */
  function instantIn(date, minutes, tz) {
    const [y, m, d] = date.split('-').map(Number);
    const want = Date.UTC(y, m - 1, d) / 60000 + minutes;
    let guess = want * 60000;
    for (let i = 0; i < 3; i++) {
      const p = partsIn(new Date(guess), tz);
      const [py, pm, pd] = p.date.split('-').map(Number);
      const have = Date.UTC(py, pm - 1, pd) / 60000 + p.minutes;
      const diff = want - have;
      if (!diff) break;
      guess += diff * 60000;
    }
    return new Date(guess);
  }

  function fail(title, text) {
    $('bk-loading').hidden = true;
    $('bk-error').hidden = false;
    $('bk-error-title').textContent = title;
    $('bk-error-text').textContent = text;
  }

  async function init() {
    if (!slug || !/^[a-z0-9][a-z0-9-]{2,39}$/i.test(slug)) return fail('No booking link here', 'Ask the person who shared it for a fresh link.');
    let data;
    try {
      const from = new Date();
      const to = new Date(); to.setDate(to.getDate() + 60);
      data = await rpc('public_availability', { p_slug: slug.toLowerCase(), p_from: isoDate(from), p_to: isoDate(to) });
    } catch (err) {
      console.error(err);
      return fail("Couldn't load availability", 'The booking service is not reachable right now. Please try again in a minute.');
    }
    if (!data) return fail('This link is not available', 'It may have been turned off or renamed. Ask for a new one.');
    settings = data;
    computeSlots();
    renderPage();
  }

  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function computeSlots() {
    const tz = settings.timezone || 'UTC';
    const busy = /** @type {{date: string, start: number, end: number}[]} */ (settings.busy || []);
    const byDate = {};
    busy.forEach(b => { (byDate[b.date] ||= []).push(b); });
    const now = new Date();
    const lead = new Date(now.getTime() + 60 * 60000); // at least an hour of notice
    slotsByDate = {};
    for (let i = 0; i < settings.horizon_days; i++) {
      const dayInstant = new Date(now.getTime() + i * 86400000);
      const p = partsIn(dayInstant, tz);
      if (!settings.days.includes(p.weekday)) continue;
      const slots = [];
      const step = settings.duration_min <= 20 ? 15 : 30;
      for (let m = settings.start_hour * 60; m + settings.duration_min <= settings.end_hour * 60; m += step) {
        const s = m, e = m + settings.duration_min;
        const clash = (byDate[p.date] || []).some(b => s < b.end + settings.buffer_min && e + settings.buffer_min > b.start);
        if (clash) continue;
        if (instantIn(p.date, s, tz) < lead) continue;
        slots.push(s);
      }
      if (slots.length) slotsByDate[p.date] = slots;
    }
  }

  function renderPage() {
    $('bk-loading').hidden = true;
    $('bk-app').hidden = false;
    $('bk-title').textContent = settings.title;
    $('bk-meta').textContent = `${settings.duration_min} min · times shown in ${visitorTz.replace(/_/g, ' ')}`;
    const dates = Object.keys(slotsByDate);
    const dayList = $('bk-days');
    if (!dates.length) {
      dayList.innerHTML = '<p class="subtitle">No open slots in the next few weeks. Check back later or reach out another way.</p>';
      return;
    }
    selectedDate = selectedDate && slotsByDate[selectedDate] ? selectedDate : dates[0];
    dayList.innerHTML = dates.map(d => {
      const dt = new Date(`${d}T12:00:00`);
      return `<button type="button" class="bk-day ${d === selectedDate ? 'active' : ''}" data-date="${d}"><span class="bk-dow">${dt.toLocaleDateString('en-US', { weekday: 'short' })}</span><span class="bk-dom">${dt.getDate()}</span><span class="bk-mon">${dt.toLocaleDateString('en-US', { month: 'short' })}</span><span class="bk-n">${slotsByDate[d].length}</span></button>`;
    }).join('');
    dayList.querySelectorAll('.bk-day').forEach(b => b.addEventListener('click', () => { selectedDate = /** @type {HTMLElement} */ (b).dataset.date || ''; selected = null; renderPage(); }));
    renderSlots();
  }

  function renderSlots() {
    const tz = settings.timezone || 'UTC';
    const list = $('bk-slots');
    const slots = slotsByDate[selectedDate] || [];
    $('bk-slots-head').textContent = new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    list.innerHTML = slots.map(m => {
      const inst = instantIn(selectedDate, m, tz);
      const label = inst.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const on = selected && selected.getTime() === inst.getTime();
      return `<button type="button" class="bk-slot ${on ? 'active' : ''}" data-ts="${inst.getTime()}">${label}</button>`;
    }).join('');
    list.querySelectorAll('.bk-slot').forEach(b => b.addEventListener('click', () => {
      selected = new Date(Number(/** @type {HTMLElement} */ (b).dataset.ts));
      list.querySelectorAll('.bk-slot').forEach(x => x.classList.toggle('active', x === b));
      $('bk-form').hidden = false;
      $('bk-chosen').textContent = selected.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      $('bk-name')?.focus();
    }));
    if (!selected) $('bk-form').hidden = true;
  }

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    const name = /** @type {HTMLInputElement} */ ($('bk-name')).value.trim();
    const email = /** @type {HTMLInputElement} */ ($('bk-email')).value.trim();
    const note = /** @type {HTMLTextAreaElement} */ ($('bk-note')).value.trim();
    const msg = $('bk-msg');
    if (!name) { msg.textContent = 'Please add your name.'; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please use a valid email address.'; return; }
    const btn = /** @type {HTMLButtonElement} */ ($('bk-submit'));
    btn.disabled = true; msg.textContent = 'Sending…';
    try {
      const res = await rpc('request_booking', { p_slug: slug.toLowerCase(), p_starts_at: selected.toISOString(), p_name: name, p_email: email, p_note: note || null });
      if (!res?.ok) { msg.textContent = res?.error || 'Could not send that request.'; btn.disabled = false; return; }
      $('bk-app').hidden = true;
      $('bk-done').hidden = false;
      $('bk-done-text').textContent = `${selected.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} is requested. You'll hear back at ${email} once it's confirmed.`;
    } catch (err) {
      console.error(err);
      msg.textContent = 'The booking service is not reachable right now. Please try again shortly.';
      btn.disabled = false;
    }
  }

  $('bk-form')?.addEventListener('submit', submit);
  init();
})();
