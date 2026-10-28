"""Builds book.html — the public booking page (/book?u=slug)."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_common import head, topbar, footer

html = head('Book time — Visionary', 'Pick a time that works. Visionary shows only free slots, never private tasks.', '/book', robots='noindex, nofollow', page='book') + topbar() + '''  <main class="book" id="main">
    <div id="bk-loading" class="book-state"><p class="eyebrow">Booking</p><h1 class="book-title">Checking availability…</h1><p class="subtitle">One moment.</p></div>
    <div id="bk-error" class="book-state" hidden><p class="eyebrow">Booking</p><h1 class="book-title" id="bk-error-title">Not available</h1><p class="subtitle" id="bk-error-text"></p></div>
    <div id="bk-done" class="book-state" hidden><p class="eyebrow">Request sent</p><h1 class="book-title">You're on the list.</h1><p class="subtitle" id="bk-done-text"></p><a class="btn btn-ghost btn-sm" href="/">What is Visionary?</a></div>
    <div id="bk-app" hidden>
      <header class="book-head"><p class="eyebrow">Booking</p><h1 class="book-title" id="bk-title">Book time</h1><p class="subtitle" id="bk-meta"></p></header>
      <section class="book-days" id="bk-days" aria-label="Days with open slots"></section>
      <section class="book-slots-wrap">
        <h2 class="book-slots-head" id="bk-slots-head"></h2>
        <div class="book-slots" id="bk-slots" role="group" aria-label="Open times"></div>
      </section>
      <form class="book-form card" id="bk-form" hidden novalidate>
        <p class="subtitle">Requesting <strong id="bk-chosen"></strong></p>
        <label class="field"><span class="field-label">Your name</span><input type="text" id="bk-name" maxlength="80" autocomplete="name" required></label>
        <label class="field"><span class="field-label">Email</span><input type="email" id="bk-email" maxlength="254" autocomplete="email" required></label>
        <label class="field"><span class="field-label">What's it about? <span class="subtitle">(optional)</span></span><textarea id="bk-note" rows="2" maxlength="500"></textarea></label>
        <p class="form-msg" id="bk-msg" role="status" aria-live="polite"></p>
        <button class="btn btn-primary" id="bk-submit" type="submit">Request this time</button>
        <p class="subtitle book-fine">Your name and email go only to the person you're booking with. See the <a href="/privacy">Privacy Policy</a>.</p>
      </form>
    </div>
  </main>
  <script src="/js/env.js"></script>
  <script src="/js/book.js"></script>
''' + footer().replace('  <script src="/js/env.js"></script>\n', '')

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'book.html'), 'w') as f:
    f.write(html)
print('book.html written')
