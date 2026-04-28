// ============================================
// VISIONARY — Authentication
// ============================================

const authEls = {
  authScreen: document.getElementById('auth-screen'),
  appShell: document.getElementById('app-shell'),
  authTitle: document.getElementById('auth-title'),
  authSubtitle: document.getElementById('auth-subtitle'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authSubmit: document.getElementById('btn-auth-submit'),
  authError: document.getElementById('auth-error'),
  authToggleText: document.getElementById('auth-toggle-text'),
  authToggleLink: document.getElementById('auth-toggle-link'),
  btnGoogle: document.getElementById('btn-google')
};

let isSignupMode = false;

function showApp() {
  authEls.authScreen.style.display = 'none';
  authEls.appShell.style.display = 'block';
}

function showAuth() {
  authEls.authScreen.style.display = 'grid';
  authEls.appShell.style.display = 'none';
}

function setAuthMode(signup) {
  isSignupMode = signup;
  authEls.authTitle.textContent = signup ? 'Create your account' : 'Welcome back';
  authEls.authSubtitle.textContent = signup ? 'Start showing up — every day.' : 'Sign in to continue building your routine.';
  authEls.authSubmit.textContent = signup ? 'Sign up' : 'Sign in';
  authEls.authToggleText.textContent = signup ? 'Already have an account?' : "Don't have an account?";
  authEls.authToggleLink.textContent = signup ? 'Sign in' : 'Sign up';
  authEls.authPassword.autocomplete = signup ? 'new-password' : 'current-password';
  authEls.authError.textContent = '';
  authEls.authError.style.color = '';
}

async function handleSession(session) {
  if (session?.user) {
    showApp();
    if (window.visionaryOnSignedIn) {
      await window.visionaryOnSignedIn(session.user);
    }
  } else {
    showAuth();
    if (window.visionaryOnSignedOut) {
      window.visionaryOnSignedOut();
    }
  }
}

async function checkAuthState() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error('Session check failed:', error);
  }
  await handleSession(session);
}

async function handleEmailAuth() {
  const email = authEls.authEmail.value.trim();
  const password = authEls.authPassword.value;
  authEls.authError.textContent = '';
  authEls.authError.style.color = '';

  if (!email || !password) {
    authEls.authError.textContent = 'Please fill in both fields.';
    return;
  }

  if (isSignupMode && password.length < 6) {
    authEls.authError.textContent = 'Password must be at least 6 characters.';
    return;
  }

  authEls.authSubmit.disabled = true;
  authEls.authSubmit.textContent = isSignupMode ? 'Creating account...' : 'Signing in...';

  try {
    const result = isSignupMode
      ? await supabaseClient.auth.signUp({ email, password })
      : await supabaseClient.auth.signInWithPassword({ email, password });

    if (result.error) {
      authEls.authError.textContent = result.error.message;
    } else if (isSignupMode && !result.data.session) {
      authEls.authError.textContent = 'Check your email to confirm your account.';
      authEls.authError.style.color = 'var(--accent-3)';
    }
  } catch (error) {
    console.error(error);
    authEls.authError.textContent = 'Something went wrong. Try again.';
  } finally {
    authEls.authSubmit.disabled = false;
    authEls.authSubmit.textContent = isSignupMode ? 'Sign up' : 'Sign in';
  }
}

async function logout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error('Logout failed:', error);
  }
}
window.logout = logout;

function initAuth() {
  setAuthMode(false);
  checkAuthState();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    await handleSession(session);
  });

  authEls.authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(!isSignupMode);
  });

  authEls.authSubmit.addEventListener('click', handleEmailAuth);
  authEls.authPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEmailAuth();
  });

  authEls.btnGoogle.addEventListener('click', async () => {
    authEls.authError.textContent = '';
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) authEls.authError.textContent = error.message;
  });
}

initAuth();