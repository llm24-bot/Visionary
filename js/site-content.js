// ============================================================================
// Visionary — editable site content + in-page visual editor
//
// Public visitors: loads any published edits for this page from Supabase
// (table site_content, readable by everyone) and swaps them into the matching
// [data-edit-region] elements. Every piece of HTML goes through a strict
// allowlist sanitiser before it touches the page.
//
// Admins: open any page with ?edit to edit it in place — type directly on the
// page, format text, drag blocks to reorder, add, duplicate or delete them,
// then Publish. Only accounts in site_admins can save (enforced by RLS).
//
// Local development: on localhost, ?edit&local=1 edits without an account and
// keeps changes in this browser only.
// ============================================================================

(function () {
  'use strict';

  const CFG = window.VISIONARY_CONFIG || {};
  const PAGE = document.body.dataset.page || '';
  const params = new URLSearchParams(location.search);
  const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);
  const LOCAL_MODE = IS_LOCALHOST && params.get('local') === '1';
  const LOCAL_KEY = `vn-local-content:${PAGE}`;
  const ADMIN_FLAG = 'vn-site-admin';
  const MAX_BYTES = 200000;
  const PAGE_NAMES = { home: 'Landing page', privacy: 'Privacy Policy', terms: 'Terms of Service', 'not-found': 'Not-found page' };

  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const regions = () => $$('[data-edit-region]');
  const regionEl = (name) => document.querySelector(`[data-edit-region="${CSS.escape(name)}"]`);

  // --------------------------------------------------------------------------
  // Sanitiser — rebuilds content from scratch using an allowlist
  // --------------------------------------------------------------------------
  const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's',
    'a', 'br', 'span', 'div', 'section', 'blockquote', 'hr', 'code', 'kbd', 'small',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button']);
  const DROP = new Set(['script', 'style', 'iframe', 'frame', 'object', 'embed', 'template', 'noscript', 'link',
    'meta', 'base', 'form', 'input', 'textarea', 'select', 'option', 'img', 'picture', 'video', 'audio',
    'source', 'canvas', 'math', 'title', 'head']);
  const ID_RE = /^[a-z][a-z0-9-]{0,60}$/;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const cleanClass = (v) => String(v || '').split(/\s+/).filter((t) => /^[a-z][a-z0-9-]{0,39}$/.test(t) && !t.startsWith('se-')).slice(0, 6).join(' ');
  function safeHref(v) {
    const href = String(v || '').trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(href)) return href;
    if (/^mailto:[^\s"'<>]+$/i.test(href)) return href;
    if (/^\/(?!\/)[^\s"'<>]*$/.test(href)) return href;
    if (/^#[a-z0-9-]*$/i.test(href)) return href;
    return null;
  }

  function copyNode(src, parent) {
    for (const node of Array.from(src.childNodes)) {
      if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.data)); continue; }
      if (node.nodeType !== 1) continue;
      const tag = node.localName.toLowerCase();
      if (DROP.has(tag)) continue;

      // Icons: only <svg class="i"><use href="#i-name"/></svg> from the built-in sprite
      if (tag === 'svg') {
        const use = node.querySelector('use');
        const ref = use && (use.getAttribute('href') || use.getAttribute('xlink:href'));
        if (ref && /^#i-[a-z0-9-]{1,30}$/.test(ref)) {
          const svg = document.createElementNS(SVG_NS, 'svg');
          svg.setAttribute('class', cleanClass(node.getAttribute('class')) || 'i');
          svg.setAttribute('aria-hidden', 'true');
          const u = document.createElementNS(SVG_NS, 'use');
          u.setAttribute('href', ref);
          svg.appendChild(u);
          parent.appendChild(svg);
        }
        continue;
      }
      if (!ALLOWED.has(tag)) { copyNode(node, parent); continue; } // unwrap unknown wrappers

      const el = document.createElement(tag);
      const cls = cleanClass(node.getAttribute('class'));
      if (cls) el.setAttribute('class', cls);
      const id = node.getAttribute('id');
      if (id && ID_RE.test(id) && ['section', 'div', 'h2', 'h3', 'h4', 'p'].includes(tag)) el.id = id;
      if (tag === 'section') {
        const lab = node.getAttribute('aria-labelledby');
        if (lab && ID_RE.test(lab)) el.setAttribute('aria-labelledby', lab);
      }
      if (tag === 'a') {
        const href = safeHref(node.getAttribute('href'));
        if (href) {
          el.setAttribute('href', href);
          if (href.startsWith('https://')) el.setAttribute('rel', 'noopener noreferrer');
        }
      }
      if (tag === 'th' || tag === 'td') {
        for (const a of ['colspan', 'rowspan']) {
          const v = node.getAttribute(a);
          if (v && /^[1-9]$/.test(v)) el.setAttribute(a, v);
        }
        const scope = node.getAttribute('scope');
        if (scope === 'row' || scope === 'col') el.setAttribute('scope', scope);
      }
      if (tag === 'button') {
        // The only button allowed in content is "Cookie settings".
        if (!node.hasAttribute('data-cookie-settings')) { copyNode(node, parent); continue; }
        el.type = 'button';
        el.setAttribute('data-cookie-settings', '');
      }
      copyNode(node, el);
      parent.appendChild(el);
    }
  }

  function sanitize(html) {
    const inert = new DOMParser().parseFromString(`<!doctype html><body>${String(html || '')}`, 'text/html');
    const frag = document.createDocumentFragment();
    copyNode(inert.body, frag);
    return frag;
  }
  function sanitizedHTML(html) {
    const box = document.createElement('div');
    box.appendChild(sanitize(html));
    return box.innerHTML.replace(/\u200b/g, '').trim();
  }
  window.visionarySanitize = sanitizedHTML;

  // --------------------------------------------------------------------------
  // Loading published content
  // --------------------------------------------------------------------------
  const original = {};
  regions().forEach((el) => { original[el.dataset.editRegion] = sanitizedHTML(el.innerHTML); });
  let published = {};

  function applyRegion(name, html) {
    const el = regionEl(name);
    if (!el) return;
    el.replaceChildren(sanitize(html));
  }

  function refreshToc() {
    const toc = document.querySelector('.doc-toc');
    if (!toc) return;
    const title = toc.querySelector('p');
    // Keep section numbers in order after moving, adding or deleting sections
    $$('.doc-content > section h2 .num').forEach((n, i) => {
      const want = String(i + 1).padStart(2, '0');
      if (n.textContent !== want) n.textContent = want;
    });
    const links = $$('.doc-content section[id]').map((sec) => {
      const h = sec.querySelector('h2');
      if (!h) return null;
      const a = document.createElement('a');
      a.href = `#${sec.id}`;
      a.textContent = Array.from(h.childNodes).filter((n) => !(n.nodeType === 1 && n.classList.contains('num'))).map((n) => n.textContent).join('').trim();
      return a;
    }).filter(Boolean);
    toc.replaceChildren(...(title ? [title] : []), ...links);
  }

  const rest = (path, init = {}) => fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: CFG.supabasePublishableKey, 'Content-Type': 'application/json', ...(init.headers || {}) }
  });

  async function loadPublished() {
    if (!PAGE) return;
    let rows = [];
    if (LOCAL_MODE || (IS_LOCALHOST && localStorage.getItem(LOCAL_KEY))) {
      try { rows = Object.entries(JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')).map(([region, html]) => ({ region, html })); } catch { rows = []; }
    } else if (CFG.supabaseUrl) {
      try {
        const res = await rest(`site_content?select=region,html,updated_at&page=eq.${encodeURIComponent(PAGE)}`);
        if (res.ok) rows = await res.json();
      } catch { /* offline or table not created yet: keep the built-in copy */ }
    }
    published = {};
    for (const row of rows) {
      if (!regionEl(row.region)) continue;
      published[row.region] = sanitizedHTML(row.html);
      applyRegion(row.region, published[row.region]);
    }
    refreshToc();
  }

  // --------------------------------------------------------------------------
  // Auth helpers (admin only)
  // --------------------------------------------------------------------------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`) && (src.includes('supabase') ? window.supabase : window.supabaseClient)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Couldn't load ${src}`));
      document.head.appendChild(s);
    });
  }
  async function getClient() {
    if (!window.supabaseClient) {
      if (!window.supabase) await loadScript('/vendor/supabase-2.117.2.min.js');
      await loadScript('/js/config.js');
    }
    return window.supabaseClient;
  }
  async function getToken() {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  }
  async function checkAdmin(token) {
    const res = await rest('rpc/is_site_admin', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    return (await res.json()) === true;
  }
  window.visionaryCheckSiteAdmin = async function () {
    try {
      const token = await getToken();
      const ok = !!token && await checkAdmin(token);
      try { ok ? localStorage.setItem(ADMIN_FLAG, '1') : localStorage.removeItem(ADMIN_FLAG); } catch { /* ignore */ }
      return ok;
    } catch { return false; }
  };

  // --------------------------------------------------------------------------
  // Storage for the editor (Supabase or, on localhost, this browser)
  // --------------------------------------------------------------------------
  const store = {
    token: null,
    async save(region, html) {
      if (LOCAL_MODE) {
        const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        all[region] = html; localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); return;
      }
      const res = await rest('site_content?on_conflict=page,region', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ page: PAGE, region, html }])
      });
      if (!res.ok) throw new Error(await errorText(res));
    },
    async reset(region) {
      if (LOCAL_MODE) {
        const all = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        delete all[region]; localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); return;
      }
      const res = await rest(`site_content?page=eq.${encodeURIComponent(PAGE)}&region=eq.${encodeURIComponent(region)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${this.token}`, Prefer: 'return=minimal' }
      });
      if (!res.ok) throw new Error(await errorText(res));
    },
    async history() {
      if (LOCAL_MODE) return null;
      const res = await rest(`site_content_history?select=id,region,html,action,saved_at&page=eq.${encodeURIComponent(PAGE)}&order=saved_at.desc,id.desc&limit=40`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      if (!res.ok) throw new Error(await errorText(res));
      return res.json();
    }
  };
  async function errorText(res) {
    if (res.status === 401) return 'Your sign-in expired. Open Visionary, sign in again, then come back.';
    if (res.status === 403) return "This account isn't allowed to edit the site.";
    if (res.status === 404) return 'The site editor database table is missing. Run the site editor migration in Supabase.';
    try { const j = await res.json(); return j.message || `Save failed (${res.status}).`; } catch { return `Save failed (${res.status}).`; }
  }

  // --------------------------------------------------------------------------
  // Editor UI
  // --------------------------------------------------------------------------
  const ICON = {
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>'
  };
  const svg = (name, fill = false) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

  function el(tag, attrs = {}, html = '') {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    if (html) node.innerHTML = html; // only ever called with the static markup above
    return node;
  }

  const BLOCK_PARENTS = new Set(['UL', 'OL', 'TBODY', 'THEAD']);
  const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);

  function blockOf(node, region) {
    let n = node && node.nodeType === 3 ? node.parentElement : node;
    while (n && n !== region) {
      const p = n.parentElement;
      if (!p) return null;
      if (p === region) return n;
      if (BLOCK_PARENTS.has(p.tagName) && region.contains(p)) return n;
      if (p.tagName === 'SECTION' && p.parentElement === region) {
        // A section's heading stands for the whole section (move/delete it together).
        return /^H[1-3]$/.test(n.tagName) && n === p.firstElementChild ? p : n;
      }
      n = p;
    }
    return null;
  }

  function startEditor(opts) {
    const state = { dirty: false, busy: false, block: null, drag: null };
    document.body.classList.add('site-editing');
    document.body.classList.remove('booting');
    const pageName = PAGE_NAMES[PAGE] || 'Page';

    // ---- Top bar ----
    const bar = el('div', { class: 'se-bar', role: 'toolbar', 'aria-label': 'Page editor' });
    bar.innerHTML = `
      <div class="se-title"><span class="se-dot" aria-hidden="true"></span><strong>Editing</strong><span class="se-page"></span>${LOCAL_MODE ? '<span class="se-chip">Local preview</span>' : ''}</div>
      <div class="se-group" aria-label="Formatting">
        <button type="button" class="se-btn" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold">${svg('bold')}</button>
        <button type="button" class="se-btn" data-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic">${svg('italic')}</button>
        <button type="button" class="se-btn" data-cmd="link" title="Add or remove a link" aria-label="Link">${svg('link')}</button>
        <select class="se-select" data-cmd="block" aria-label="Text style">
          <option value="">Text style</option><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option>
        </select>
        <button type="button" class="se-btn" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">${svg('list')}</button>
        <span class="se-sep" aria-hidden="true"></span>
        <button type="button" class="se-btn" data-cmd="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${svg('undo')}</button>
        <button type="button" class="se-btn" data-cmd="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${svg('redo')}</button>
      </div>
      <div class="se-group se-actions">
        <span class="se-status" role="status" aria-live="polite">All changes published</span>
        ${opts.switcher ? '<button type="button" class="se-link" data-act="switch"></button>' : ''}
        <button type="button" class="se-link" data-act="history">${svg('history')}<span>History</span></button>
        <button type="button" class="se-link" data-act="reset">Restore original</button>
        <button type="button" class="se-link" data-act="discard">Discard</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="save">Publish</button>
        <a class="se-link" href="/studio" data-act="exit">Done</a>
      </div>`;
    bar.querySelector('.se-page').textContent = pageName;
    document.body.prepend(bar);
    const syncBarHeight = () => document.body.style.setProperty('--se-bar-h', `${bar.offsetHeight}px`);
    syncBarHeight();
    if (window.ResizeObserver) new ResizeObserver(syncBarHeight).observe(bar);
    const statusEl = bar.querySelector('.se-status');
    const setStatus = (text, tone = '') => { statusEl.textContent = text; statusEl.dataset.tone = tone; };

    // ---- Block tools (float beside the hovered block, outside editable content) ----
    const tools = el('div', { class: 'se-tools', role: 'toolbar', 'aria-label': 'Block tools' });
    tools.innerHTML = `
      <button type="button" class="se-tool se-grip" data-blk="drag" title="Drag to move" aria-label="Drag to move">${svg('grip', true)}</button>
      <button type="button" class="se-tool" data-blk="up" title="Move up" aria-label="Move up">${svg('up')}</button>
      <button type="button" class="se-tool" data-blk="down" title="Move down" aria-label="Move down">${svg('down')}</button>
      <button type="button" class="se-tool" data-blk="add" title="Add below" aria-label="Add a block below">${svg('plus')}</button>
      <button type="button" class="se-tool" data-blk="copy" title="Duplicate" aria-label="Duplicate">${svg('copy')}</button>
      <button type="button" class="se-tool se-danger" data-blk="delete" title="Delete" aria-label="Delete">${svg('trash')}</button>`;
    tools.hidden = true;
    document.body.appendChild(tools);
    const dropLine = el('div', { class: 'se-drop', 'aria-hidden': 'true' });
    dropLine.hidden = true;
    document.body.appendChild(dropLine);

    // ---- Regions become editable ----
    const editable = () => regions().filter((r) => !opts.only || opts.only.includes(r.dataset.editRegion));
    function enable() {
      regions().forEach((r) => { r.removeAttribute('contenteditable'); r.classList.remove('se-region'); });
      editable().forEach((r) => {
        r.setAttribute('contenteditable', 'true');
        r.setAttribute('spellcheck', 'true');
        r.classList.add('se-region');
        r.dataset.label = r.dataset.editLabel || 'Editable area';
      });
    }
    enable();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* ignore */ }

    const markDirty = () => {
      if (!state.dirty) { state.dirty = true; }
      setStatus('Unsaved changes', 'warn');
    };
    const observer = new MutationObserver((list) => {
      if (list.some((m) => m.target.closest?.('[data-edit-region]') || m.target.parentElement?.closest('[data-edit-region]'))) markDirty();
    });
    regions().forEach((r) => observer.observe(r, { subtree: true, childList: true, characterData: true, attributes: false }));
    const quiet = (fn) => { fn(); observer.takeRecords(); };

    // Paste plain text only
    document.addEventListener('paste', (e) => {
      if (!e.target.closest?.('.se-region')) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    // Don't follow links or trigger buttons inside editable content
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('.se-region') && e.target.closest('a,button')) e.preventDefault();
    }, true);
    // Keep the auth form and other controls from doing anything while editing
    if (opts.inert) opts.inert.forEach((n) => n && n.setAttribute('inert', ''));

    // ---- Formatting ----
    bar.addEventListener('mousedown', (e) => { if (e.target.closest('.se-btn')) e.preventDefault(); });
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn && btn.tagName === 'BUTTON') {
        const cmd = btn.dataset.cmd;
        if (cmd === 'link') return makeLink();
        document.execCommand(cmd, false, null);
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'save') { e.preventDefault(); publish(); }
      if (act === 'discard') { e.preventDefault(); discard(); }
      if (act === 'reset') { e.preventDefault(); resetAll(); }
      if (act === 'history') { e.preventDefault(); openHistory(); }
      if (act === 'switch') { e.preventDefault(); opts.switcher.toggle(); }
      if (act === 'exit' && state.dirty && !confirm('You have unpublished changes. Leave without publishing?')) e.preventDefault();
    });
    bar.querySelector('[data-cmd="block"]').addEventListener('change', (e) => {
      const tag = e.target.value; e.target.value = '';
      if (!tag) return;
      document.execCommand('formatBlock', false, tag);
    });
    function makeLink() {
      const sel = window.getSelection();
      const inLink = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode).closest('a');
      if (inLink && inLink.closest('.se-region')) { document.execCommand('unlink'); return; }
      if (!sel.rangeCount || sel.isCollapsed) { setStatus('Select some text first, then add a link.', 'warn'); return; }
      const range = sel.getRangeAt(0);
      const url = prompt('Link address (https://…, /page, #section or mailto:)', 'https://');
      if (!url) return;
      const href = safeHref(url);
      if (!href) { setStatus('That link isn\'t allowed. Use https://, a /page path, #section or mailto:.', 'error'); return; }
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('createLink', false, href);
    }

    // ---- Block tools positioning ----
    function showTools(block) {
      state.block = block;
      if (!block) { tools.hidden = true; return; }
      const r = block.getBoundingClientRect();
      tools.hidden = false;
      const w = tools.offsetWidth;
      const left = r.left - w - 8 > 4 ? r.left - w - 8 : Math.max(4, r.right - w);
      const top = r.left - w - 8 > 4 ? r.top : r.top - tools.offsetHeight - 4;
      tools.style.transform = `translate(${Math.round(left + window.scrollX)}px, ${Math.round(Math.max(top, 56) + window.scrollY)}px)`;
      $$('.se-hover').forEach((n) => n !== block && n.classList.remove('se-hover'));
      block.classList.add('se-hover');
    }
    const regionOf = (n) => n?.closest?.('.se-region');
    document.addEventListener('mouseover', (e) => {
      if (state.drag || e.target.closest?.('.se-tools')) return;
      const region = regionOf(e.target);
      if (!region) return;
      const block = blockOf(e.target, region);
      if (block) showTools(block);
    });
    document.addEventListener('selectionchange', () => {
      const n = window.getSelection()?.anchorNode;
      const region = regionOf(n?.nodeType === 3 ? n.parentElement : n);
      if (region) { const b = blockOf(n, region); if (b) showTools(b); }
    });
    window.addEventListener('scroll', () => state.block && showTools(state.block), { passive: true });
    window.addEventListener('resize', () => state.block && showTools(state.block));

    const siblingsOf = (b) => Array.from(b.parentElement.children).filter((c) => !c.classList.contains('se-drop'));
    function focusBlock(b) {
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode();
      const range = document.createRange();
      if (t && t.data === 'New item') range.selectNodeContents(t);          // typing replaces the placeholder
      else if (t) { range.setStart(t, t.length); } else { range.selectNodeContents(b); range.collapse(true); }
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      b.closest('.se-region')?.focus({ preventScroll: true });
      b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      showTools(b);
    }
    function blankCopy(b) {
      if (TEXT_BLOCKS.has(b.tagName)) { const p = document.createElement('p'); p.appendChild(document.createElement('br')); return p; }
      const c = b.cloneNode(true);
      c.removeAttribute('id'); c.classList.remove('se-hover');
      $$('[id]', c).forEach((n) => n.removeAttribute('id'));
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      const texts = []; let t; while ((t = walker.nextNode())) texts.push(t);
      let first = true;
      texts.forEach((n) => {
        if (n.parentElement.closest('.num')) return;
        if (!n.data.trim()) return;
        n.data = first ? 'New item' : ''; first = false;
      });
      return c;
    }
    function giveSectionId(n) {
      if (n.tagName !== 'SECTION') return n;
      const id = `section-${Math.random().toString(36).slice(2, 8)}`;
      n.id = id;
      const h = n.querySelector('h2');
      if (h) { h.id = `${id}-h`; n.setAttribute('aria-labelledby', h.id); }
      return n;
    }
    tools.addEventListener('mousedown', (e) => e.preventDefault());
    tools.addEventListener('click', (e) => {
      const act = e.target.closest('[data-blk]')?.dataset.blk;
      const b = state.block;
      if (!act || !b || !b.isConnected) return;
      if (act === 'up' && b.previousElementSibling) { b.parentElement.insertBefore(b, b.previousElementSibling); showTools(b); refreshToc(); }
      if (act === 'down' && b.nextElementSibling) { b.parentElement.insertBefore(b.nextElementSibling, b); showTools(b); refreshToc(); }
      if (act === 'add') { const n = giveSectionId(blankCopy(b)); b.after(n); focusBlock(n); refreshToc(); }
      if (act === 'copy') {
        const n = b.cloneNode(true);
        n.classList.remove('se-hover'); n.removeAttribute('id'); $$('[id]', n).forEach((x) => x.removeAttribute('id'));
        giveSectionId(n); b.after(n); showTools(n); refreshToc();
      }
      if (act === 'delete') {
        const parent = b.parentElement;
        const next = b.nextElementSibling || b.previousElementSibling;
        b.remove();
        if (BLOCK_PARENTS.has(parent.tagName) && !parent.children.length) parent.remove();
        next && next.isConnected ? showTools(next) : showTools(null);
        refreshToc();
      }
      markDirty();
    });

    // ---- Drag to reorder ----
    tools.querySelector('[data-blk="drag"]').addEventListener('pointerdown', (e) => {
      const b = state.block;
      if (!b) return;
      e.preventDefault();
      state.drag = { block: b, target: null, before: true };
      b.classList.add('se-dragging');
      document.body.classList.add('se-is-dragging');
      tools.setPointerCapture?.(e.pointerId);
    });
    window.addEventListener('pointermove', (e) => {
      const d = state.drag;
      if (!d) return;
      const sibs = siblingsOf(d.block).filter((s) => s !== d.block);
      let best = null;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        const dist = Math.min(Math.abs(e.clientY - r.top), Math.abs(e.clientY - r.bottom));
        if (!best || dist < best.dist) best = { s, before, dist, r };
      }
      if (!best) return;
      d.target = best.s; d.before = best.before;
      const y = best.before ? best.r.top - 3 : best.r.bottom + 1;
      dropLine.hidden = false;
      dropLine.style.transform = `translate(${Math.round(best.r.left + window.scrollX)}px, ${Math.round(y + window.scrollY)}px)`;
      dropLine.style.width = `${Math.round(best.r.width)}px`;
    });
    window.addEventListener('pointerup', () => {
      const d = state.drag;
      if (!d) return;
      state.drag = null;
      dropLine.hidden = true;
      d.block.classList.remove('se-dragging');
      document.body.classList.remove('se-is-dragging');
      if (d.target) {
        d.before ? d.target.before(d.block) : d.target.after(d.block);
        markDirty(); refreshToc();
      }
      showTools(d.block);
    });

    // ---- Publish / discard / reset ----
    function currentHTML(r) { return sanitizedHTML(Array.from(r.childNodes).map((n) => (n.nodeType === 1 ? (n.classList.remove('se-hover', 'se-dragging'), n.outerHTML) : n.nodeType === 3 ? escapeText(n.data) : '')).join('')); }
    function escapeText(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    async function publish() {
      if (state.busy) return;
      state.busy = true;
      setStatus('Publishing…');
      try {
        let changed = 0;
        for (const r of regions()) {
          const name = r.dataset.editRegion;
          const html = currentHTML(r);
          if (new Blob([html]).size > MAX_BYTES) throw new Error(`"${r.dataset.editLabel || name}" is too long to save.`);
          const before = published[name] ?? original[name];
          if (html === before) continue;
          if (html === original[name]) { await store.reset(name); delete published[name]; }
          else { await store.save(name, html); published[name] = html; }
          changed++;
        }
        state.dirty = false;
        refreshToc();
        setStatus(changed ? (LOCAL_MODE ? 'Saved in this browser' : 'Published — live for everyone') : 'No changes to publish', 'ok');
      } catch (err) {
        setStatus(err.message || 'Publishing failed.', 'error');
      } finally { state.busy = false; }
    }
    function discard() {
      if (state.dirty && !confirm('Discard all unpublished changes on this page?')) return;
      quiet(() => editable().forEach((r) => applyRegion(r.dataset.editRegion, published[r.dataset.editRegion] ?? original[r.dataset.editRegion])));
      state.dirty = false; showTools(null); refreshToc();
      setStatus('Changes discarded');
    }
    async function resetAll() {
      if (!confirm('Restore the original text for this page? Your published edits will be removed (they stay in History).')) return;
      state.busy = true;
      try {
        for (const r of editable()) {
          const name = r.dataset.editRegion;
          if (published[name] != null) { await store.reset(name); delete published[name]; }
          quiet(() => applyRegion(name, original[name]));
        }
        state.dirty = false; showTools(null); refreshToc();
        setStatus('Original restored', 'ok');
      } catch (err) { setStatus(err.message, 'error'); } finally { state.busy = false; }
    }

    // ---- History drawer ----
    const drawer = el('aside', { class: 'se-drawer', 'aria-label': 'Version history' });
    drawer.hidden = true;
    document.body.appendChild(drawer);
    async function openHistory() {
      drawer.hidden = false;
      drawer.innerHTML = `<header><h2>History</h2><button type="button" class="se-tool" data-close aria-label="Close history">${svg('x')}</button></header><p class="se-muted">Loading…</p>`;
      try {
        const rows = await store.history();
        const list = el('ol', { class: 'se-history' });
        if (!rows) {
          drawer.querySelector('.se-muted').textContent = 'History is kept once you edit on the live site. Local previews only keep the latest version.';
          return;
        }
        if (!rows.length) { drawer.querySelector('.se-muted').textContent = 'No edits yet. Published versions will appear here.'; return; }
        drawer.querySelector('.se-muted').textContent = 'Restore puts a past version back on the page. Publish to make it live.';
        rows.forEach((row) => {
          const region = regionEl(row.region);
          const li = el('li');
          const when = new Date(row.saved_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          li.appendChild(el('strong', { text: region?.dataset.editLabel || row.region }));
          li.appendChild(el('span', { class: 'se-muted', text: `${row.action === 'reset' ? 'Restored to original' : 'Published'} · ${when}` }));
          const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Restore' });
          btn.addEventListener('click', () => {
            if (!region) return;
            applyRegion(row.region, row.html == null ? original[row.region] : row.html);
            markDirty(); refreshToc();
            setStatus('Version restored — publish to make it live', 'warn');
          });
          if (region) li.appendChild(btn);
          list.appendChild(li);
        });
        drawer.appendChild(list);
      } catch (err) { drawer.querySelector('.se-muted').textContent = err.message; }
    }
    drawer.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) drawer.hidden = true; });

    // ---- Keyboard + leaving ----
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); publish(); }
      if (e.key === 'Escape') { showTools(null); drawer.hidden = true; }
    });
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

    setStatus(Object.keys(published).length ? 'Showing published edits' : 'Showing the original text');
    return { enable };
  }

  function notice(title, body, action) {
    const box = el('div', { class: 'se-notice', role: 'alertdialog', 'aria-labelledby': 'se-notice-title' });
    box.appendChild(el('strong', { id: 'se-notice-title', text: title }));
    box.appendChild(el('p', { text: body }));
    const row = el('div', { class: 'se-notice-actions' });
    if (action) row.appendChild(el('a', { class: 'btn btn-primary btn-sm', href: action.href, text: action.label }));
    const close = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Close' });
    close.addEventListener('click', () => box.remove());
    row.appendChild(close);
    box.appendChild(row);
    document.body.appendChild(box);
  }

  // Floating "Edit this page" button for admins browsing the site
  function offerEditButton() {
    let flag = null;
    try { flag = localStorage.getItem(ADMIN_FLAG); } catch { /* ignore */ }
    if (flag !== '1' || !regions().length || PAGE === 'home') return;
    const a = el('a', { class: 'se-fab', href: `${location.pathname}?edit` });
    a.innerHTML = `${svg('pen')}<span>Edit this page</span>`;
    document.body.appendChild(a);
  }

  async function initEditor() {
    if (!params.has('edit') || !regions().length) return;
    const opts = {};
    if (PAGE === 'home') {
      const wn = document.getElementById('whatsnew-modal');
      const showWhatsNew = params.get('edit') === 'whats-new';
      opts.inert = [document.querySelector('.auth-panel'), document.getElementById('whatsnew-close'), document.getElementById('whatsnew-ok')];
      let onWN = showWhatsNew;
      let api = null;
      const sync = () => {
        wn?.classList.toggle('open', onWN);
        document.body.classList.toggle('se-editing-modal', onWN);
        opts.only = onWN ? ['whats-new-head', 'whats-new-list'] : ['landing-hero'];
        const btn = document.querySelector('.se-bar [data-act="switch"]');
        if (btn) btn.textContent = onWN ? 'Edit landing page' : "Edit What's new";
        const page = document.querySelector('.se-bar .se-page');
        if (page) page.textContent = onWN ? "What's new" : 'Landing page';
        api?.enable();
      };
      opts.switcher = { toggle() { onWN = !onWN; sync(); } };
      opts.only = showWhatsNew ? ['whats-new-head', 'whats-new-list'] : ['landing-hero'];
      if (!LOCAL_MODE && !(await verify())) return;
      api = startEditor(opts); sync();
      return;
    }
    if (LOCAL_MODE) { startEditor(opts); return; }
    if (await verify()) startEditor(opts);

    async function verify() {
      let token = null;
      try { token = await getToken(); } catch { /* ignore */ }
      if (!token) {
        notice('Sign in to edit', 'Sign in to Visionary with an admin account, then open this page again.', { href: '/', label: 'Sign in' });
        return false;
      }
      if (!(await checkAdmin(token))) {
        notice("You can't edit this site", 'This account is not a site admin. Ask the site owner to add you in Supabase (see SECURITY.md).', { href: location.pathname, label: 'View page' });
        return false;
      }
      store.token = token;
      try { localStorage.setItem(ADMIN_FLAG, '1'); } catch { /* ignore */ }
      return true;
    }
  }

  window.visionarySiteContent = { ready: loadPublished().then(() => initEditor()).then(() => { if (!params.has('edit')) offerEditButton(); }) };
})();
