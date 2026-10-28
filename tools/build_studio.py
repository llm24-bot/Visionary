import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_common import head, topbar, footer
html = head('Studio — Visionary', 'Edit the Visionary website.', '/studio', robots='noindex, nofollow', page='') + topbar() + '''  <main class="studio" id="main">
    <div class="studio-gate" id="studio-gate">
      <p class="eyebrow">Studio</p>
      <h1 class="studio-gate-title" id="studio-gate-title">Checking access…</h1>
      <p id="studio-gate-text">One moment.</p>
      <div id="studio-gate-actions"></div>
    </div>
    <div id="studio-app" hidden>
      <header class="studio-head">
        <div>
          <p class="eyebrow">Studio</p>
          <h1>Edit your site</h1>
          <p>Open a page, click any text and type. Drag blocks to reorder them, add or delete them, then publish. Every version is kept, so you can always go back.</p>
        </div>
        <div class="studio-head-actions"><a class="btn btn-ghost btn-sm" href="/studio-notes">Engineering notes</a><span class="studio-who" id="studio-who"></span></div>
      </header>
      <section class="studio-grid" id="studio-pages" aria-label="Pages"></section>
      <section class="studio-panel" aria-labelledby="studio-activity-h">
        <h2 id="studio-activity-h">Recent changes</h2>
        <ol class="studio-activity" id="studio-activity"><li><span>Loading…</span></li></ol>
      </section>
      <section class="studio-panel" aria-labelledby="studio-tips-h">
        <h2 id="studio-tips-h">How editing works</h2>
        <ul class="studio-tips">
          <li>Click text to edit it. Use the toolbar for bold, italic, links, headings and bullet lists.</li>
          <li>Hover a block to move it (drag the handle or use the arrows), add a new one below, duplicate it or delete it.</li>
          <li>Press Ctrl+S (Cmd+S on Mac) or Publish to make changes live. Discard throws away unpublished edits.</li>
          <li>Restore original brings back the text that ships with the code. Your edits stay in History.</li>
          <li>Pasted text arrives as plain text, and anything unsafe (scripts, embeds, images) is removed automatically.</li>
        </ul>
      </section>
    </div>
  </main>
  <script src="/vendor/supabase-2.117.2.min.js"></script>
  <script src="/js/env.js"></script>
  <script src="/js/config.js"></script>
  <script src="/js/studio.js"></script>
''' + footer().replace('  <script src="/js/env.js"></script>\n', '')
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'studio.html'), 'w').write(html)
