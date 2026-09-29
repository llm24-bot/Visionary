// ============================================================================
// Visionary — Studio: the site editor dashboard (/studio)
// Lists editable pages, shows which ones have published edits, and recent
// changes. Access is decided by the database (site_admins + RLS), not here.
// ============================================================================

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const CFG = window.VISIONARY_CONFIG;
  const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);

  const PAGES = [
    { page: 'home', regions: ['landing-hero'], title: 'Landing page', desc: 'Headline, intro and highlights on the sign-in screen.', edit: '/?edit', view: '/' },
    { page: 'home', regions: ['whats-new-head', 'whats-new-list'], title: "What's new", desc: 'Release notes shown to people after an update.', edit: '/?edit=whats-new', view: null },
    { page: 'privacy', regions: ['head', 'body'], title: 'Privacy Policy', desc: 'How you collect, use and protect data.', edit: '/privacy?edit', view: '/privacy' },
    { page: 'terms', regions: ['head', 'body'], title: 'Terms of Service', desc: 'The rules for using Visionary.', edit: '/terms?edit', view: '/terms' },
    { page: 'not-found', regions: ['content'], title: 'Not-found page', desc: 'What people see on a broken or old link.', edit: '/404?edit', view: '/404' }
  ];
  const REGION_LABELS = {
    'landing-hero': 'Landing page', 'whats-new-head': "What's new heading", 'whats-new-list': "What's new list",
    head: 'heading', body: 'content', content: 'content'
  };
  const PAGE_LABELS = { home: '', privacy: 'Privacy Policy', terms: 'Terms of Service', 'not-found': 'Not-found page' };

  const rest = (path, token) => fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
    method: path.startsWith('rpc/') ? 'POST' : 'GET',
    body: path.startsWith('rpc/') ? '{}' : undefined,
    headers: { apikey: CFG.supabasePublishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  });

  function gate(title, text, actions = []) {
    $('studio-gate').hidden = false;
    $('studio-app').hidden = true;
    $('studio-gate-title').textContent = title;
    $('studio-gate-text').textContent = text;
    const box = $('studio-gate-actions');
    box.replaceChildren();
    actions.forEach(([label, href, primary]) => {
      const a = document.createElement('a');
      a.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'}`;
      a.href = href; a.textContent = label;
      box.appendChild(a);
    });
  }

  const fmt = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function renderPages(content) {
    const grid = $('studio-pages');
    grid.replaceChildren();
    for (const p of PAGES) {
      const rows = content.filter((r) => r.page === p.page && p.regions.includes(r.region));
      const card = document.createElement('article');
      card.className = 'studio-card';
      const h = document.createElement('h2'); h.textContent = p.title;
      const d = document.createElement('p'); d.textContent = p.desc;
      const st = document.createElement('span'); st.className = 'studio-state';
      if (rows.length) {
        const last = rows.map((r) => r.updated_at).sort().pop();
        st.textContent = `Edited · ${fmt(last)}`; st.dataset.custom = '';
      } else st.textContent = 'Original text';
      const actions = document.createElement('div'); actions.className = 'studio-actions';
      const edit = document.createElement('a'); edit.className = 'btn btn-primary btn-sm'; edit.href = p.edit; edit.textContent = 'Edit';
      actions.appendChild(edit);
      if (p.view) { const v = document.createElement('a'); v.className = 'btn btn-ghost btn-sm'; v.href = p.view; v.textContent = 'View'; actions.appendChild(v); }
      card.append(h, d, st, actions);
      grid.appendChild(card);
    }
  }

  function renderActivity(rows) {
    const list = $('studio-activity');
    list.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li'); const s = document.createElement('span');
      s.textContent = 'No edits yet. Changes you publish will show up here.';
      li.appendChild(s); list.appendChild(li); return;
    }
    rows.forEach((r) => {
      const li = document.createElement('li');
      const what = document.createElement('strong');
      const page = PAGE_LABELS[r.page];
      const region = REGION_LABELS[r.region] || r.region;
      what.textContent = `${page ? `${page} ${region}` : region} ${r.action === 'reset' ? 'restored to original' : 'published'}`;
      const when = document.createElement('span'); when.textContent = fmt(r.saved_at);
      li.append(what, when);
      list.appendChild(li);
    });
  }

  async function init() {
    const { data } = await supabaseClient.auth.getSession();
    const session = data?.session;
    if (!session) {
      const acts = [['Sign in', '/', true]];
      if (IS_LOCALHOST) acts.push(['Try a local preview', '/privacy?edit&local=1', false]);
      return gate('Sign in to use Studio', 'Studio is for site admins. Sign in to Visionary with your admin account, then come back to this page.', acts);
    }
    let admin = false;
    try {
      const res = await rest('rpc/is_site_admin', session.access_token);
      admin = res.ok && (await res.json()) === true;
      if (res.status === 404) return gate('Studio needs one setup step', 'Run the site editor migration in Supabase (supabase/migrations/20260928010000_site_editor.sql), then reload this page.', [['Back to Visionary', '/', true]]);
    } catch {
      return gate("Couldn't reach the server", 'Check your connection and reload the page.', [['Reload', location.pathname, true]]);
    }
    try { admin ? localStorage.setItem('vn-site-admin', '1') : localStorage.removeItem('vn-site-admin'); } catch { /* ignore */ }
    if (!admin) return gate('No editing access', `You're signed in as ${session.user.email}, which isn't a site admin.`, [['Back to Visionary', '/', true]]);

    $('studio-gate').hidden = true;
    $('studio-app').hidden = false;
    $('studio-who').textContent = `Admin · ${session.user.email}`;
    const [content, history] = await Promise.all([
      rest('site_content?select=page,region,updated_at', session.access_token).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      rest('site_content_history?select=page,region,action,saved_at&order=saved_at.desc,id.desc&limit=15', session.access_token).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    ]);
    renderPages(content);
    renderActivity(history);
  }

  init();
})();
