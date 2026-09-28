// ============================================================================
// Visionary — cookie & analytics consent
//
// * Essential storage (sign-in session, theme, focus log) is always on; it is
//   required for the app to work and never used for tracking.
// * Analytics (Vercel Web Analytics + Speed Insights, both cookie-free) load
//   ONLY after the visitor chooses "Allow analytics".
// * Browsers sending Global Privacy Control are treated as "Essential only".
// * The choice is stored in a first-party cookie: Secure; SameSite=Lax; 180 days.
// ============================================================================

(function () {
  const COOKIE = 'vn_consent';
  const MAX_AGE = 60 * 60 * 24 * 180;
  const banner = document.getElementById('consent-banner');
  let analyticsLoaded = false;

  function readChoice() {
    const m = document.cookie.match(/(?:^|;\s*)vn_consent=(granted|denied)/);
    return m ? m[1] : null;
  }

  function writeChoice(value) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  }

  function loadAnalytics() {
    if (analyticsLoaded) return;
    // Vercel serves these paths only on deployed sites with Analytics enabled.
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    analyticsLoaded = true;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    for (const src of ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js']) {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      document.head.appendChild(s);
    }
  }

  function show() { if (banner) { banner.hidden = false; requestAnimationFrame(() => banner.classList.add('show')); } }
  function hide() { if (banner) { banner.classList.remove('show'); setTimeout(() => { banner.hidden = true; }, 200); } }

  function choose(value) {
    const previous = readChoice();
    writeChoice(value);
    hide();
    if (value === 'granted') loadAnalytics();
    // Withdrawing consent after scripts loaded: reload so they're gone.
    else if (previous === 'granted' && analyticsLoaded) location.reload();
  }

  document.getElementById('consent-accept')?.addEventListener('click', () => choose('granted'));
  document.getElementById('consent-decline')?.addEventListener('click', () => choose('denied'));
  document.querySelectorAll('[data-cookie-settings]').forEach((b) => b.addEventListener('click', show));
  window.visionaryCookieSettings = show;

  const choice = readChoice();
  if (choice === 'granted') loadAnalytics();
  else if (!choice) {
    if (navigator.globalPrivacyControl) writeChoice('denied');
    else setTimeout(show, 800);
  }
})();
