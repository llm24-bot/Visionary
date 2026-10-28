import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_common import head, topbar, footer
html = head('Page not found — Visionary', "This page doesn't exist. Head back to Visionary to keep planning your day.", '/404', robots='noindex, follow', page='not-found') + topbar() + '''  <main class="nf" id="main">
    <div class="nf-inner">
      <svg class="nf-art" viewBox="0 0 360 150" fill="none" role="img" aria-label="A sun setting below the horizon">
        <path d="M20 120 A160 110 0 0 1 340 120" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="3 7"/>
        <circle cx="180" cy="120" r="24" fill="currentColor" fill-opacity=".9"/>
        <rect x="0" y="120" width="360" height="30" fill="var(--bg)"/>
        <line x1="0" y1="120.5" x2="360" y2="120.5" stroke="currentColor" stroke-opacity=".5"/>
      </svg>
      <div class="nf-copy" data-edit-region="content" data-edit-label="Page content">
      <p class="nf-code">ERROR 404</p>
      <h1>Off the horizon.</h1>
      <p>The page you're looking for doesn't exist or has moved. Your plans are safe. Let's get you back to them.</p>
      <div class="nf-actions">
        <a class="btn btn-primary btn-lg" href="/">Back to Visionary</a>
      </div>
      </div>
    </div>
  </main>
''' + footer()
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '404.html'), 'w').write(html)
