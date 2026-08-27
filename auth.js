const path = location.pathname;
const form = document.querySelector('#auth-form');
const title = document.querySelector('#auth-title');
const intro = document.querySelector('#auth-intro');
const submit = document.querySelector('#auth-submit');
const error = document.querySelector('#auth-error');
const notice = document.querySelector('#auth-notice');
const swap = document.querySelector('#auth-swap');
const nameField = document.querySelector('#name-field');
const passwordField = document.querySelector('#password-field');
const confirmField = document.querySelector('#confirm-field');
const emailField = document.querySelector('#email-field');
const forgot = document.querySelector('#forgot-link');
const passwordNote = document.querySelector('#password-note');
const tokenInput = document.querySelector('#token');
const params = new URLSearchParams(location.search);

const modes = {
  '/login': { title: 'Welcome back', intro: 'Sign in to continue to your plan.', submit: 'Sign in', endpoint: '/api/auth/login', swap: 'New to Arcadia? <a class="text-link" href="/register">Create an account</a>' },
  '/register': { title: 'Create your account', intro: 'Your plan will be safely stored and ready on every device.', submit: 'Create account', endpoint: '/api/auth/register', name: true, confirm: true, note: true, swap: 'Already have an account? <a class="text-link" href="/login">Sign in</a>' },
  '/forgot-password': { title: 'Reset your password', intro: 'Enter your email and we’ll send a secure reset link.', submit: 'Send reset link', endpoint: '/api/auth/forgot-password', password: false, swap: '<a class="text-link" href="/login">Back to sign in</a>' },
  '/reset-password': { title: 'Choose a new password', intro: 'Set a new password for your Arcadia account.', submit: 'Save new password', endpoint: '/api/auth/reset-password', email: false, confirm: true, note: true, token: true, swap: '<a class="text-link" href="/login">Back to sign in</a>' },
  '/verify-email': { title: 'Verifying your email', intro: 'Please wait while Arcadia activates your account.', submit: 'Verify email', endpoint: '/api/auth/verify', email: false, password: false, token: true, auto: true, swap: '<a class="text-link" href="/login">Back to sign in</a>' }
};

const mode = modes[path] || modes['/login'];
title.textContent = mode.title;
intro.textContent = mode.intro;
submit.textContent = mode.submit;
swap.innerHTML = mode.swap;
nameField.hidden = !mode.name;
confirmField.hidden = !mode.confirm;
passwordField.hidden = mode.password === false;
emailField.hidden = mode.email === false;
forgot.hidden = path !== '/login';
passwordNote.hidden = !mode.note;
tokenInput.value = params.get('token') || '';
if (mode.confirm) document.querySelector('#password').autocomplete = 'new-password';
if (mode.auto) { submit.hidden = true; queueMicrotask(() => form.requestSubmit()); }

form.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = ''; notice.textContent = '';
  const values = Object.fromEntries(new FormData(form));
  if (mode.confirm && values.password !== values.confirmPassword) { error.textContent = 'Passwords do not match.'; return; }
  submit.disabled = true;
  try {
    const method = path === '/verify-email' ? 'GET' : 'POST';
    const url = method === 'GET' ? `${mode.endpoint}?token=${encodeURIComponent(values.token)}` : mode.endpoint;
    const response = await fetch(url, { method, headers: method === 'POST' ? { 'content-type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(values) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    if (data.redirect) { location.assign(data.redirect); return; }
    notice.textContent = data.message || 'Done.';
    const developmentUrl = data.verificationUrl || data.resetUrl;
    if (developmentUrl) { const link = document.createElement('a'); link.className = 'text-link'; link.href = developmentUrl; link.textContent = ' Open the local testing link.'; notice.append(link); }
    if (path === '/reset-password') setTimeout(() => location.assign('/login?reset=complete'), 900);
  } catch (caught) { error.textContent = caught.message; }
  finally { submit.disabled = false; }
});

if (params.get('verified') === '1') notice.textContent = 'Email verified. You can sign in now.';
if (params.get('reset') === 'complete') notice.textContent = 'Password updated. Sign in with your new password.';
if (params.get('email') === 'changed') notice.textContent = 'Email changed. Sign in with your new address.';
if (params.get('email') === 'invalid') error.textContent = 'That email-change link is invalid or expired.';
if (params.get('email') === 'taken') error.textContent = 'That email is already in use.';
