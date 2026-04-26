// ============================================
// VISIONARY — Authentication
// ============================================

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('btn-auth-submit');
const authError = document.getElementById('auth-error');
const authToggleText = document.getElementById('auth-toggle-text');
const authToggleLink = document.getElementById('auth-toggle-link');
const btnGoogle = document.getElementById('btn-google');

let isSignupMode = false;

// --- Initial check: is someone already logged in? ---
checkAuthState();

async function checkAuthState() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showAuth();
  }
}

// Listen for auth changes (login, logout, etc.)
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    showApp(session.user);
  } else if (event === 'SIGNED_OUT') {
    showAuth();
  }
});

// --- Toggle between signup and login ---
authToggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  isSignupMode = !isSignupMode;
  if (isSignupMode) {
    authTitle.textContent = 'Create your account';
    authSubtitle.textContent = 'Start showing up — every day.';
    authSubmit.textContent = 'Sign up';
    authToggleText.textContent = 'Already have an account?';
    authToggleLink.textContent = 'Sign in';
  } else {
    authTitle.textContent = 'Welcome back';
    authSubtitle.textContent = 'Sign in to continue building your routine.';
    authSubmit.textContent = 'Sign in';
    authToggleText.textContent = "Don't have an account?";
    authToggleLink.textContent = 'Sign up';
  }
  authError.textContent = '';
});

// --- Email/password submit ---
authSubmit.addEventListener('click', handleEmailAuth);
authPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleEmailAuth();
});

async function handleEmailAuth() {
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.textContent = '';

  if (!email || !password) {
    authError.textContent = 'Please fill in both fields.';
    return;
  }

  if (isSignupMode && password.length < 6) {
    authError.textContent = 'Password must be at least 6 characters.';
    return;
  }

  authSubmit.disabled = true;
  authSubmit.textContent = isSignupMode ? 'Creating account...' : 'Signing in...';

  try {
    let result;
    if (isSignupMode) {
      result = await supabaseClient.auth.signUp({ email, password });
    } else {
      result = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (result.error) {
      authError.textContent = result.error.message;
    } else if (isSignupMode && !result.data.session) {
      authError.textContent = 'Check your email to confirm your account.';
      authError.style.color = 'var(--accent-3)';
    }
  } catch (err) {
    authError.textContent = 'Something went wrong. Try again.';
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = isSignupMode ? 'Sign up' : 'Sign in';
  }
}

// --- Google OAuth ---
btnGoogle.addEventListener('click', async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) authError.textContent = error.message;
});

// --- Show/hide ---
function showApp(user) {
  authScreen.style.display = 'none';
  appShell.style.display = '';

  // Wipe any leftover localStorage from pre-auth testing (one-time)
  if (!localStorage.getItem('v-wiped-once')) {
    localStorage.removeItem('v-tasks');
    localStorage.removeItem('v-streak');
    localStorage.removeItem('v-longest-streak');
    localStorage.removeItem('v-last-date');
    localStorage.removeItem('v-history');
    localStorage.removeItem('v-last-seen');
    localStorage.setItem('v-wiped-once', 'true');
    location.reload();
  }
}

function showAuth() {
  authScreen.style.display = '';
  appShell.style.display = 'none';
}

// --- Logout (called from logout button) ---
async function logout() {
  await supabaseClient.auth.signOut();
}