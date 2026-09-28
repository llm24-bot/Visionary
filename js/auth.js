// ============================================================================
// Visionary — authentication
//
// Modes: signin · signup · forgot · reset (after following a recovery link)
//
// Protections implemented here (the server enforces its own as well):
//   * Inline form validation with accessible error messages
//   * Honeypot field + minimum fill time to filter simple bots
//   * Optional Cloudflare Turnstile CAPTCHA (enable in config.js + Supabase)
//   * Generic responses that don't reveal whether an email is registered
//   * Progressive lockout after repeated failed sign-ins
//   * Cooldown between password-reset emails
//   * Other sessions are revoked after a password change
//   * Expired / invalid reset links are detected and explained
// ============================================================================

(function () {
  const listify = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
  const cfg = window.VISIONARY_CONFIG;
  const $ = (id) => document.getElementById(id);

  const els = {
    screen: $('auth-screen'),
    shell: $('app-shell'),
    form: $('auth-form'),
    title: $('auth-title'),
    subtitle: $('auth-subtitle'),
    email: $('auth-email'),
    emailField: $('field-email'),
    password: $('auth-password'),
    passwordField: $('field-password'),
    passwordToggle: $('auth-password-toggle'),
    confirm: $('auth-confirm'),
    confirmField: $('field-confirm'),
    hint: $('password-hint'),
    honeypot: $('auth-website'),
    submit: $('btn-auth-submit'),
    status: $('auth-status'),
    forgotLink: $('auth-forgot-link'),
    toggleText: $('auth-toggle-text'),
    toggleLink: $('auth-toggle-link'),
    google: $('btn-google'),
    social: $('auth-social'),
    captcha: $('auth-captcha'),
    legal: $('auth-legal')
  };

  const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
  const MIN_FILL_MS = 1200;
  const COPY = {
    signin: { title: 'Welcome back', subtitle: 'Sign in to pick up where you left off.', submit: 'Sign in', toggleText: 'New to Visionary?', toggleLink: 'Create an account' },
    signup: { title: 'Create your free account', subtitle: 'Plan your first day in under a minute.', submit: 'Create free account', toggleText: 'Already have an account?', toggleLink: 'Sign in' },
    forgot: { title: 'Reset your password', subtitle: "Enter your email and we'll send you a secure link. It expires after one hour.", submit: 'Send reset link', toggleText: 'Remembered it?', toggleLink: 'Back to sign in' },
    reset: { title: 'Choose a new password', subtitle: 'For your security, this signs you out on every other device.', submit: 'Update password', toggleText: '', toggleLink: '' }
  };

  let mode = 'signin';
  let formShownAt = Date.now();
  let lastBootstrappedUserId = null;
  let captchaToken = null;
  let captchaWidgetId = null;
  let resetTimer = null;

  // A recovery link lands with #...type=recovery (or an error). Read it before
  // the Supabase client clears the hash.
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search);
  let recoveryPending = hashParams.get('type') === 'recovery';
  const linkError = hashParams.get('error_code') || queryParams.get('error_code');
  const linkErrorDescription = hashParams.get('error_description') || queryParams.get('error_description');

  // ------------------------------------------------------------------ views
  function finishBoot() { document.body.classList.remove('booting'); }
  function showApp() { finishBoot(); els.screen.style.display = 'none'; els.shell.style.display = 'block'; }
  function showAuth() { finishBoot(); els.screen.style.display = 'grid'; els.shell.style.display = 'none'; }
  window.finishBoot = finishBoot;
  window.showApp = showApp;
  window.showAuth = showAuth;

  function setMode(next) {
    mode = next;
    const c = COPY[mode];
    els.title.textContent = c.title;
    els.subtitle.textContent = c.subtitle;
    els.submit.textContent = c.submit;
    els.toggleText.textContent = c.toggleText;
    els.toggleLink.textContent = c.toggleLink;
    els.toggleLink.parentElement.hidden = mode === 'reset';

    els.emailField.hidden = mode === 'reset';
    els.passwordField.hidden = mode === 'forgot';
    els.confirmField.hidden = mode !== 'reset';
    els.hint.hidden = !(mode === 'signup' || mode === 'reset');
    els.forgotLink.hidden = mode !== 'signin';
    els.social.hidden = mode === 'forgot' || mode === 'reset';
    els.legal.hidden = mode !== 'signup';
    els.password.autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
    els.passwordField.querySelector('.field-label').textContent = mode === 'reset' ? 'New password' : 'Password';

    clearErrors();
    setStatus('');
    formShownAt = Date.now();
    resetCaptcha();
    applyLockoutState();
    applyResetCooldown();
  }

  // ------------------------------------------------------------ validation
  function fieldError(input, message) {
    const field = input.closest('.field');
    const slot = field.querySelector('.field-error');
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    field.classList.toggle('invalid', !!message);
    slot.textContent = message || '';
  }
  function clearErrors() { [els.email, els.password, els.confirm].forEach((i) => fieldError(i, '')); }

  function passwordProblems(pw) {
    const problems = [];
    if (pw.length < 8) problems.push('at least 8 characters');
    if (!/[A-Za-z]/.test(pw)) problems.push('a letter');
    if (!/\d/.test(pw)) problems.push('a number');
    if (pw.length > 72) problems.push('no more than 72 characters');
    return problems;
  }

  function validate() {
    clearErrors();
    let ok = true;
    const email = els.email.value.trim();
    if (mode !== 'reset') {
      if (!email) { fieldError(els.email, 'Enter your email address.'); ok = false; }
      else if (!EMAIL_RE.test(email)) { fieldError(els.email, 'That email address looks incomplete.'); ok = false; }
    }
    if (mode === 'signin' && !els.password.value) { fieldError(els.password, 'Enter your password.'); ok = false; }
    if (mode === 'signup' || mode === 'reset') {
      const problems = passwordProblems(els.password.value);
      if (problems.length) { fieldError(els.password, `Use ${listify(problems)}.`); ok = false; }
    }
    if (mode === 'reset' && els.confirm.value !== els.password.value) { fieldError(els.confirm, "Passwords don't match."); ok = false; }
    if (!ok) els.form.querySelector('[aria-invalid="true"]')?.focus();
    return ok;
  }

  function updateHint() {
    if (els.hint.hidden) return;
    const pw = els.password.value;
    const rules = els.hint.querySelectorAll('[data-rule]');
    rules.forEach((li) => {
      const rule = li.dataset.rule;
      const met = rule === 'len' ? pw.length >= 8 : rule === 'letter' ? /[A-Za-z]/.test(pw) : /\d/.test(pw);
      li.classList.toggle('met', met);
    });
  }

  function setStatus(message, tone = 'error') {
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function busy(on, label) {
    els.submit.disabled = on;
    els.submit.textContent = on ? label : COPY[mode].submit;
    els.form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ------------------------------------------------------------- lockout
  const lockKey = (email) => `vn-auth-attempts:${email.toLowerCase()}`;
  function readAttempts(email) {
    try { return JSON.parse(localStorage.getItem(lockKey(email))) || { count: 0, until: 0 }; } catch { return { count: 0, until: 0 }; }
  }
  function writeAttempts(email, value) { try { localStorage.setItem(lockKey(email), JSON.stringify(value)); } catch { /* storage blocked */ } }
  function recordFailure(email) {
    const a = readAttempts(email);
    a.count += 1;
    if (a.count >= cfg.maxLoginAttempts) {
      // 15 min, then 30, then 60 … for repeated lockouts
      const multiplier = 2 ** Math.max(0, Math.floor(a.count / cfg.maxLoginAttempts) - 1);
      a.until = Date.now() + cfg.lockoutMinutes * 60000 * Math.min(multiplier, 8);
    }
    writeAttempts(email, a);
    return a;
  }
  function clearFailures(email) { try { localStorage.removeItem(lockKey(email)); } catch { /* ignore */ } }
  function lockedFor(email) {
    if (!email) return 0;
    const a = readAttempts(email);
    return Math.max(0, a.until - Date.now());
  }
  function applyLockoutState() {
    if (mode !== 'signin') return;
    const ms = lockedFor(els.email.value.trim());
    if (ms > 0) {
      setStatus(`Too many attempts. For your security, sign-in is paused for ${Math.ceil(ms / 60000)} min. You can reset your password instead.`);
    }
  }

  // ------------------------------------------------------ reset cooldown
  const resetKey = 'vn-reset-sent-at';
  function applyResetCooldown() {
    clearInterval(resetTimer);
    if (mode !== 'forgot') return;
    const tick = () => {
      let sentAt = 0;
      try { sentAt = Number(localStorage.getItem(resetKey)) || 0; } catch { /* ignore */ }
      const left = Math.ceil((sentAt + cfg.resetCooldownSeconds * 1000 - Date.now()) / 1000);
      if (left > 0) { els.submit.disabled = true; els.submit.textContent = `Resend in ${left}s`; }
      else { els.submit.disabled = false; els.submit.textContent = COPY.forgot.submit; clearInterval(resetTimer); }
    };
    tick();
    resetTimer = setInterval(tick, 1000);
  }

  // ------------------------------------------------------------- captcha
  function loadCaptcha() {
    if (!cfg.turnstileSiteKey) return;
    window.onVisionaryTurnstile = () => {
      captchaWidgetId = window.turnstile.render(els.captcha, {
        sitekey: cfg.turnstileSiteKey,
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        callback: (token) => { captchaToken = token; },
        'expired-callback': () => { captchaToken = null; }
      });
    };
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onVisionaryTurnstile&render=explicit';
    s.async = true;
    document.head.appendChild(s);
    els.captcha.hidden = false;
  }
  function resetCaptcha() {
    captchaToken = null;
    if (window.turnstile && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
  }
  function captchaOptions() { return cfg.turnstileSiteKey ? { captchaToken } : {}; }

  // --------------------------------------------------------------- submit
  const redirectTo = () => location.origin + location.pathname;

  async function onSubmit(e) {
    e.preventDefault();
    setStatus('');
    if (!validate()) return;

    // Bots fill hidden fields and submit instantly. Pretend success, do nothing.
    if (els.honeypot.value || Date.now() - formShownAt < MIN_FILL_MS) {
      if (mode === 'signup' || mode === 'forgot') setStatus(genericSent(), 'ok');
      else setStatus('Incorrect email or password.');
      return;
    }
    if (cfg.turnstileSiteKey && !captchaToken && mode !== 'reset') {
      setStatus('Please complete the verification check.');
      return;
    }

    const email = els.email.value.trim().toLowerCase();
    const password = els.password.value;
    try {
      if (mode === 'signin') await doSignIn(email, password);
      else if (mode === 'signup') await doSignUp(email, password);
      else if (mode === 'forgot') await doForgot(email);
      else if (mode === 'reset') await doReset(password);
    } catch (err) {
      console.error('Auth error', err);
      setStatus('Something went wrong. Check your connection and try again.');
      busy(false);
    } finally {
      resetCaptcha();
    }
  }

  function genericSent() {
    return mode === 'signup'
      ? 'Check your inbox for a confirmation link. If you already have an account, sign in or reset your password instead.'
      : "If an account exists for that email, a reset link is on its way. It expires after one hour.";
  }

  async function doSignIn(email, password) {
    const wait = lockedFor(email);
    if (wait > 0) { applyLockoutState(); return; }
    busy(true, 'Signing in…');
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password, options: captchaOptions() });
    busy(false);
    if (!error) {
      clearFailures(email);
      markReturning();
      supabaseClient.rpc('log_security_event', { p_event: 'login_succeeded' }).then(() => {}, () => {});
      return;
    }
    if (error.status === 429) { setStatus('Too many attempts from this network. Please wait a few minutes.'); return; }
    if (/captcha/i.test(error.message)) { setStatus('Verification failed. Please try again.'); return; }
    // Same message for wrong password, unknown email and unconfirmed email.
    const a = recordFailure(email);
    const left = cfg.maxLoginAttempts - (a.count % cfg.maxLoginAttempts);
    if (a.until > Date.now()) applyLockoutState();
    else setStatus(left <= 2 ? `Incorrect email or password. ${left} attempt${left === 1 ? '' : 's'} left before a temporary lock.` : 'Incorrect email or password.');
    els.password.value = '';
    els.password.focus();
  }

  async function doSignUp(email, password) {
    busy(true, 'Creating account…');
    const { data, error } = await supabaseClient.auth.signUp({
      email, password, options: { emailRedirectTo: redirectTo(), ...captchaOptions() }
    });
    busy(false);
    if (error) {
      if (error.status === 429) { setStatus('Too many sign-ups from this network. Please try again later.'); return; }
      if (/password/i.test(error.message) && !/already/i.test(error.message)) { fieldError(els.password, 'Choose a stronger password — avoid common or leaked passwords.'); return; }
      if (/captcha/i.test(error.message)) { setStatus('Verification failed. Please try again.'); return; }
      // "User already registered" and similar: respond generically.
      setStatus(genericSent(), 'ok');
      return;
    }
    markReturning();
    if (!data.session) { setStatus(genericSent(), 'ok'); els.password.value = ''; }
  }

  async function doForgot(email) {
    busy(true, 'Sending…');
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectTo(), ...captchaOptions() });
    try { localStorage.setItem(resetKey, String(Date.now())); } catch { /* ignore */ }
    busy(false);
    if (error && /captcha/i.test(error.message)) { setStatus('Verification failed. Please try again.'); return; }
    // Always the same answer, whether or not the address exists or was rate limited.
    setStatus(genericSent(), 'ok');
    applyResetCooldown();
  }

  async function doReset(password) {
    busy(true, 'Updating…');
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
      busy(false);
      if (/different from the old/i.test(error.message)) fieldError(els.password, 'Choose a password you haven’t used here before.');
      else if (/session|expired|jwt/i.test(error.message)) { setMode('forgot'); setStatus('That reset link has expired. Request a new one below.'); }
      else fieldError(els.password, 'Choose a stronger password — avoid common or leaked passwords.');
      return;
    }
    await window.visionaryAfterPasswordChange?.();
    busy(false);
    recoveryPending = false;
    history.replaceState(null, '', location.pathname);
    const { data } = await supabaseClient.auth.getSession();
    await handleSession(data.session);
    window.visionaryToast?.('Password updated. Other devices have been signed out.');
  }

  function markReturning() { try { localStorage.setItem('vn-returning', '1'); } catch { /* ignore */ } }

  // --------------------------------------------------------------- session
  async function handleSession(session) {
    if (recoveryPending && session?.user) {
      showAuth();
      setMode('reset');
      els.password.focus();
      return;
    }
    if (session?.user) {
      showApp();
      if (window.visionaryOnSignedIn && session.user.id !== lastBootstrappedUserId) {
        lastBootstrappedUserId = session.user.id;
        await window.visionaryOnSignedIn(session.user);
      }
    } else {
      lastBootstrappedUserId = null;
      showAuth();
      window.visionaryOnSignedOut?.();
    }
  }

  async function logout(scope = 'local') {
    lastBootstrappedUserId = null;
    if (window.visionaryIsDemo?.()) { window.visionaryExitDemo(); showAuth(); return; }
    const { error } = await supabaseClient.auth.signOut({ scope });
    if (error) console.error('Sign-out failed:', error);
  }
  window.logout = () => logout('local');
  window.visionaryLogoutEverywhere = () => logout('global');

  // ------------------------------------------------------------------ init
  function init() {
    let returning = false;
    try { returning = localStorage.getItem('vn-returning') === '1'; } catch { /* ignore */ }
    setMode(returning ? 'signin' : 'signup');
    loadCaptcha();

    setTimeout(finishBoot, 4000); // never leave the splash up on a slow network

    if (linkError) {
      history.replaceState(null, '', location.pathname);
      setMode('forgot');
      setStatus(linkError === 'otp_expired'
        ? 'That link has expired or was already used. Request a new one below.'
        : (linkErrorDescription ? 'That link is no longer valid. Request a new one below.' : 'Something went wrong with that link.'));
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (window.visionaryIsDemo?.()) return;
      if (event === 'PASSWORD_RECOVERY') recoveryPending = true;
      if (event === 'SIGNED_OUT') {
        lastBootstrappedUserId = null;
        recoveryPending = false;
        showAuth();
        window.visionaryOnSignedOut?.();
        return;
      }
      // Defer so Supabase finishes its own bookkeeping before we query.
      setTimeout(() => handleSession(session), 0);
    });

    els.form.addEventListener('submit', onSubmit);
    els.toggleLink.addEventListener('click', (e) => { e.preventDefault(); setMode(mode === 'signin' ? 'signup' : 'signin'); els.email.focus(); });
    els.forgotLink.addEventListener('click', (e) => { e.preventDefault(); setMode('forgot'); els.email.focus(); });
    els.password.addEventListener('input', () => { updateHint(); if (els.password.getAttribute('aria-invalid') === 'true') fieldError(els.password, ''); });
    els.email.addEventListener('input', () => { if (els.email.getAttribute('aria-invalid') === 'true') fieldError(els.email, ''); });
    els.email.addEventListener('blur', applyLockoutState);
    els.passwordToggle.addEventListener('click', () => {
      const show = els.password.type === 'password';
      els.password.type = show ? 'text' : 'password';
      els.confirm.type = els.password.type;
      els.passwordToggle.setAttribute('aria-pressed', String(show));
      els.passwordToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      els.passwordToggle.textContent = show ? 'Hide' : 'Show';
    });

    $('btn-demo')?.addEventListener('click', () => window.visionaryStartDemo?.());

    els.google.addEventListener('click', async () => {
      setStatus('');
      const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
      if (error) setStatus("Couldn't reach Google. Please try again.");
    });
  }

  init();
})();
