// ============================================================================
// Visionary — account & privacy controls
//   * Change password (then revoke every other session)
//   * Sign out of other devices / all devices
//   * Download a copy of your data (JSON)
//   * Permanently delete your account
// ============================================================================

(function () {
  const listify = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
  const $ = (id) => document.getElementById(id);
  const modal = $('account-modal');
  if (!modal) return;
  const toast = (m, t) => window.visionaryToast?.(m, t);
  const isDemo = () => window.visionaryIsDemo?.();

  function logEvent(event, detail = {}) {
    if (isDemo()) return;
    supabaseClient.rpc('log_security_event', { p_event: event, p_detail: detail }).then(() => {}, () => {});
  }

  // Called after any successful password change (settings or recovery link).
  window.visionaryAfterPasswordChange = async function () {
    logEvent('password_changed');
    const { error } = await supabaseClient.auth.signOut({ scope: 'others' });
    if (!error) logEvent('other_sessions_revoked', { reason: 'password_changed' });
  };

  let lastFocus = null;
  function open() {
    lastFocus = document.activeElement;
    const user = window.visionaryCurrentUser?.();
    $('account-email').textContent = isDemo() ? 'Demo mode (nothing is stored online)' : (user?.email || '');
    const provider = user?.app_metadata?.provider;
    $('account-password-section').hidden = isDemo() || (provider && provider !== 'email');
    $('account-danger').hidden = isDemo();
    $('account-sessions').hidden = isDemo();
    ['account-new-password', 'account-confirm-password', 'account-delete-confirm'].forEach((id) => { $(id).value = ''; });
    setMsg('account-password-msg', '');
    setMsg('account-delete-msg', '');
    $('account-delete-btn').disabled = true;
    modal.classList.add('open');
    modal.querySelector('.modal-close')?.focus();
  }
  function close() { modal.classList.remove('open'); lastFocus?.focus?.(); }
  function setMsg(id, text, tone = 'error') { const el = $(id); el.textContent = text; el.dataset.tone = tone; }

  async function changePassword(e) {
    e.preventDefault();
    const pw = $('account-new-password').value;
    const confirm = $('account-confirm-password').value;
    const problems = [];
    if (pw.length < 8) problems.push('at least 8 characters');
    if (!/[A-Za-z]/.test(pw)) problems.push('a letter');
    if (!/\d/.test(pw)) problems.push('a number');
    if (problems.length) return setMsg('account-password-msg', `Use ${listify(problems)}.`);
    if (pw !== confirm) return setMsg('account-password-msg', "Passwords don't match.");
    const btn = $('account-password-btn');
    btn.disabled = true; btn.textContent = 'Updating…';
    const { error } = await supabaseClient.auth.updateUser({ password: pw });
    btn.disabled = false; btn.textContent = 'Update password';
    if (error) {
      if (/reauthenticat|recent/i.test(error.message)) return setMsg('account-password-msg', 'For your security, sign out and back in, then try again.');
      if (/different from the old/i.test(error.message)) return setMsg('account-password-msg', "Choose a password you haven't used here before.");
      return setMsg('account-password-msg', 'Choose a stronger password — avoid common or leaked passwords.');
    }
    await window.visionaryAfterPasswordChange();
    $('account-new-password').value = ''; $('account-confirm-password').value = '';
    setMsg('account-password-msg', 'Password updated. Every other device has been signed out.', 'ok');
  }

  async function signOutOthers() {
    const { error } = await supabaseClient.auth.signOut({ scope: 'others' });
    if (error) return toast("Couldn't sign out other devices.", 'error');
    logEvent('other_sessions_revoked', { reason: 'user_request' });
    toast('Signed out of every other device.');
  }

  async function signOutAll() {
    logEvent('all_sessions_revoked', { reason: 'user_request' });
    close();
    await window.visionaryLogoutEverywhere?.();
  }

  async function exportData() {
    const user = window.visionaryCurrentUser?.();
    if (!user) return;
    const db = window.visionaryDb();
    const btn = $('account-export-btn');
    btn.disabled = true;
    try {
      const [tasks, reflections, profile] = await Promise.all([
        db.from('tasks').select('*').eq('user_id', user.id),
        db.from('reflections').select('*').eq('user_id', user.id),
        db.from('profiles').select('*').eq('id', user.id)
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        account: { id: user.id, email: user.email || null },
        profile: profile.data?.[0] || null,
        tasks: tasks.data || [],
        reflections: reflections.data || []
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `visionary-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      logEvent('data_exported');
      toast('Your data export has downloaded.');
    } catch (err) {
      console.error(err);
      toast("Couldn't export your data.", 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteAccount() {
    if ($('account-delete-confirm').value.trim() !== 'DELETE') return;
    const btn = $('account-delete-btn');
    btn.disabled = true; btn.textContent = 'Deleting…';
    const { data, error } = await supabaseClient.functions.invoke('account', { body: { mode: 'delete', confirm: 'DELETE' } });
    if (error || !data?.ok) {
      btn.disabled = false; btn.textContent = 'Delete my account';
      return setMsg('account-delete-msg', "We couldn't delete your account right now. Email louisl4764@gmail.com from your account address and we'll delete it within 30 days.");
    }
    try { Object.keys(localStorage).filter((k) => k.startsWith('visionary') || k.startsWith('vn-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    close();
    await supabaseClient.auth.signOut({ scope: 'local' });
    toast('Your account and data have been deleted.');
  }

  document.querySelectorAll('[data-open-account]').forEach((b) => b.addEventListener('click', open));
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('account-password-form').addEventListener('submit', changePassword);
  $('account-signout-others').addEventListener('click', signOutOthers);
  $('account-signout-all').addEventListener('click', signOutAll);
  $('account-export-btn').addEventListener('click', exportData);
  $('account-delete-confirm').addEventListener('input', (e) => { $('account-delete-btn').disabled = e.target.value.trim() !== 'DELETE'; });
  $('account-delete-btn').addEventListener('click', deleteAccount);
})();
