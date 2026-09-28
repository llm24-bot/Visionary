// Applies the saved theme before first paint to avoid a light/dark flash.
(function () {
  try {
    var saved = localStorage.getItem('visionary-theme');
    var theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
    // No stored Supabase session → this visitor will see the sign-in screen,
    // so render it immediately instead of waiting for the auth check.
    var hasSession = false;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) { hasSession = true; break; }
    }
    document.documentElement.setAttribute('data-session', hasSession ? '1' : '0');
  } catch (e) { /* storage blocked: keep default */ }
})();
