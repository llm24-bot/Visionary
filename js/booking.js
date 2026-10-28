// @ts-check
/**
 * Booking links (owner side).
 *
 * Lets a signed-in user create one private booking page, copy its link, and
 * accept or decline incoming requests. Accepting a request writes a `booking`
 * block onto the owner's horizon for that day; the public page (/book) only
 * ever sees free/busy, never task titles.
 *
 * Depends on globals from app.js: visionaryDb(), visionaryCurrentUser(),
 * visionaryToast(), visionaryIsDemo(), visionaryReloadTasks().
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toast = (msg, kind) => window.visionaryToast?.(msg, kind);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = (n) => String(n).padStart(2, '0');

  /** @type {any} */ let page = null;
  /** @type {any[]} */ let requests = [];

  const modal = $('booking-modal');
  if (!modal) return;

  function slugify(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }
  function randomSlug() {
    const user = window.visionaryCurrentUser?.();
    const base = slugify((user?.email || 'me').split('@')[0]) || 'me';
    return `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function linkFor(slug) { return `${location.origin}/book?u=${encodeURIComponent(slug)}`; }
  function hourLabel(h) { return h === 24 ? '12 AM' : h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`; }

  async function open() {
    const user = window.visionaryCurrentUser?.();
    if (!user) return;
    modal.classList.add('open');
    $('booking-body').innerHTML = '<p class="subtitle">Loading…</p>';
    await load();
    render();
  }
  function close() { modal.classList.remove('open'); }

  async function load() {
    const db = window.visionaryDb();
    const user = window.visionaryCurrentUser?.();
    const { data, error } = await db.from('booking_pages').select('*').eq('user_id', user.id).limit(1).maybeSingle();
    if (error) {
      if (/relation|schema cache|does not exist/i.test(error.message || '')) { page = undefined; return; }
      console.error(error); toast("Couldn't load your booking link.", 'error'); page = null; return;
    }
    page = data || null;
    if (page) {
      const r = await db.from('booking_requests').select('*').eq('page_id', page.id).order('starts_at', { ascending: true }).limit(100);
      requests = r.data || [];
    } else {
      requests = [];
    }
  }

  function render() {
    const body = $('booking-body');
    if (page === undefined) {
      body.innerHTML = '<p class="subtitle">Booking links need the 5.0 database update. Run <code>supabase/migrations/20261027000000_visionary_os.sql</code> in the Supabase SQL editor, then reopen this panel.</p>';
      return;
    }
    const p = page || {
      title: 'Book time with me', slug: randomSlug(), duration_min: 30, buffer_min: 10, start_hour: 9, end_hour: 17,
      days: [1, 2, 3, 4, 5], horizon_days: 14, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', active: true
    };
    const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
    const pending = requests.filter(r => r.status === 'pending');
    const decided = requests.filter(r => r.status !== 'pending').slice(-10).reverse();
    body.innerHTML = `
      <form id="booking-form" class="acct-form booking-form" novalidate>
        <label class="field"><span class="field-label">Page title</span><input type="text" id="bk-title" maxlength="80" value="${esc(p.title)}" required></label>
        <label class="field"><span class="field-label">Link</span>
          <div class="booking-link-row"><span class="mono booking-origin">${esc(location.host)}/book?u=</span><input type="text" id="bk-slug" maxlength="40" value="${esc(p.slug)}" pattern="[a-z0-9][a-z0-9-]{2,39}" spellcheck="false" required></div>
        </label>
        <div class="booking-grid">
          <label class="field"><span class="field-label">Meeting length</span><select id="bk-duration">${[15, 20, 30, 45, 60, 90].map(v => `<option value="${v}" ${v === p.duration_min ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Buffer around meetings</span><select id="bk-buffer">${[0, 5, 10, 15, 30].map(v => `<option value="${v}" ${v === p.buffer_min ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">From</span><select id="bk-start">${hourOpts(p.start_hour, 0, 23)}</select></label>
          <label class="field"><span class="field-label">Until</span><select id="bk-end">${hourOpts(p.end_hour, 1, 24)}</select></label>
          <label class="field"><span class="field-label">How far ahead</span><select id="bk-horizon">${[7, 14, 30, 60].map(v => `<option value="${v}" ${v === p.horizon_days ? 'selected' : ''}>${v} days</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">Time zone</span><input type="text" id="bk-tz" maxlength="64" value="${esc(p.timezone)}" spellcheck="false"></label>
        </div>
        <fieldset class="booking-days"><legend class="field-label">Days</legend>
          ${DAYS.map((d, i) => `<label class="chip ${p.days.includes(i) ? 'active' : ''}"><input type="checkbox" value="${i}" ${p.days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}
        </fieldset>
        <label class="toggle"><input type="checkbox" id="bk-active" ${p.active ? 'checked' : ''}><span>Link is live</span></label>
        <p class="form-msg" id="bk-msg" role="status" aria-live="polite"></p>
        <div class="acct-actions">
          <button class="btn btn-primary btn-sm" type="submit">${page ? 'Save changes' : 'Create link'}</button>
          ${page ? `<button class="btn btn-ghost btn-sm" type="button" id="bk-copy"><svg class="i" aria-hidden="true"><use href="#i-copy"/></svg><span>Copy link</span></button><a class="btn btn-ghost btn-sm" href="${esc(linkFor(p.slug))}" target="_blank" rel="noopener">Preview</a>` : ''}
        </div>
      </form>
      ${page ? `
      <section class="booking-requests">
        <h3>Requests <span class="pill-new">${pending.length} pending</span></h3>
        ${pending.length ? `<ul class="booking-list">${pending.map(r => requestRow(r, true)).join('')}</ul>` : '<p class="subtitle">Nothing pending. Share your link and requests will show up here.</p>'}
        ${decided.length ? `<details class="booking-past"><summary>Earlier requests</summary><ul class="booking-list">${decided.map(r => requestRow(r, false)).join('')}</ul></details>` : ''}
      </section>` : ''}
    `;

    $('booking-form')?.addEventListener('submit', save);
    $('bk-title')?.addEventListener('input', () => { if (!page) /** @type {HTMLInputElement} */ ($('bk-slug')).value = slugify(/** @type {HTMLInputElement} */ ($('bk-title')).value) || randomSlug(); });
    $('bk-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(linkFor(page.slug)); toast('Link copied.'); }
      catch { toast(linkFor(page.slug)); }
    });
    body.querySelectorAll('.booking-days input').forEach(cb => cb.addEventListener('change', () => cb.closest('.chip')?.classList.toggle('active', /** @type {HTMLInputElement} */ (cb).checked)));
    body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => decide(/** @type {HTMLElement} */ (b).dataset.accept || '', 'accepted')));
    body.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => decide(/** @type {HTMLElement} */ (b).dataset.decline || '', 'declined')));
  }

  function requestRow(r, actionable) {
    const when = new Date(r.starts_at);
    const whenText = when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<li class="booking-row status-${esc(r.status)}">
      <div class="booking-row-main"><strong>${esc(r.requester_name)}</strong> <span class="subtitle">${esc(r.requester_email)}</span><div class="mono">${esc(whenText)} · ${r.duration_min} min</div>${r.note ? `<p class="subtitle">${esc(r.note)}</p>` : ''}</div>
      ${actionable ? `<div class="booking-row-actions"><button class="btn btn-primary btn-sm" type="button" data-accept="${esc(r.id)}">Accept</button><button class="btn btn-ghost btn-sm" type="button" data-decline="${esc(r.id)}">Decline</button></div>` : `<span class="pill-new">${esc(r.status)}</span>`}
    </li>`;
  }

  async function save(e) {
    e.preventDefault();
    const db = window.visionaryDb();
    const user = window.visionaryCurrentUser?.();
    const msg = $('bk-msg');
    const slug = /** @type {HTMLInputElement} */ ($('bk-slug')).value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) { msg.textContent = 'Links use 3–40 lowercase letters, numbers or dashes.'; return; }
    const days = Array.from(document.querySelectorAll('.booking-days input:checked')).map(cb => Number(/** @type {HTMLInputElement} */ (cb).value));
    if (!days.length) { msg.textContent = 'Pick at least one day.'; return; }
    const start = Number(/** @type {HTMLSelectElement} */ ($('bk-start')).value), end = Number(/** @type {HTMLSelectElement} */ ($('bk-end')).value);
    if (end <= start) { msg.textContent = 'The end hour has to be after the start hour.'; return; }
    const row = {
      user_id: user.id,
      title: /** @type {HTMLInputElement} */ ($('bk-title')).value.trim().slice(0, 80) || 'Book time with me',
      slug,
      duration_min: Number(/** @type {HTMLSelectElement} */ ($('bk-duration')).value),
      buffer_min: Number(/** @type {HTMLSelectElement} */ ($('bk-buffer')).value),
      start_hour: start, end_hour: end, days,
      horizon_days: Number(/** @type {HTMLSelectElement} */ ($('bk-horizon')).value),
      timezone: /** @type {HTMLInputElement} */ ($('bk-tz')).value.trim().slice(0, 64) || 'UTC',
      active: /** @type {HTMLInputElement} */ ($('bk-active')).checked,
      updated_at: new Date().toISOString()
    };
    msg.textContent = 'Saving…';
    const q = page ? db.from('booking_pages').update(row).eq('id', page.id) : db.from('booking_pages').insert(row);
    const { error } = await q;
    if (error) {
      msg.textContent = /unique|duplicate/i.test(error.message || '') ? 'That link is taken. Try another.' : (error.message || 'Could not save.');
      return;
    }
    toast(page ? 'Booking link updated.' : 'Booking link created.');
    await load();
    render();
  }

  async function decide(id, status) {
    const db = window.visionaryDb();
    const user = window.visionaryCurrentUser?.();
    const r = requests.find(x => x.id === id);
    if (!r) return;
    if (status === 'accepted') {
      const when = new Date(r.starts_at);
      const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
      const task = { user_id: user.id, text: `${r.requester_name} · ${page.title}`, category: 'focus', completed: false, date, scheduled_hour: when.getHours(), scheduled_minute: when.getMinutes(), duration_min: r.duration_min, kind: 'booking', people: r.requester_name, note: r.note || null };
      const { error } = await db.from('tasks').insert(task);
      if (error) { console.error(error); toast("Couldn't add the booking to your day.", 'error'); return; }
    }
    const { error } = await db.from('booking_requests').update({ status }).eq('id', id);
    if (error) { console.error(error); toast('Could not update that request.', 'error'); return; }
    toast(status === 'accepted' ? 'Accepted and added to your horizon.' : 'Declined.');
    await load();
    render();
    window.visionaryReloadTasks?.();
  }

  $('booking-open')?.addEventListener('click', open);
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
  window.visionaryOpenBooking = open;
})();
