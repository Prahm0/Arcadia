const PASSWORD_ITERATIONS = 600_000;
const SESSION_DAYS = 30;
const SESSION_ROTATE_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const THEMES = ["light", "dawn", "rose", "ocean", "sage", "lavender", "dusk", "dark", "midnight", "vanta"];

export async function handleAuthRoute(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;
  if (method === "POST" && path === "/api/auth/register") return register(request, env, url);
  if (method === "GET" && path === "/api/auth/verify") return verifyRegistration(request, env, url);
  if (method === "POST" && path === "/api/auth/login") return login(request, env, url);
  if (method === "POST" && path === "/api/auth/forgot-password") return forgotPassword(request, env, url);
  if (method === "POST" && path === "/api/auth/reset-password") return resetPassword(request, env, url);
  return null;
}

export async function authenticateRequest(request, env) {
  const raw = readCookie(request.headers.get("cookie") || "", cookieName(new URL(request.url)));
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const row = await env.DB.prepare(`
    SELECT s.token_hash AS tokenHash, s.user_id AS userId, s.csrf_token AS csrfToken,
      s.expires_at AS expiresAt, s.rotated_at AS rotatedAt, a.email, p.display_name AS name
    FROM auth_sessions s JOIN accounts a ON a.user_id = s.user_id
    JOIN profiles p ON p.user_id = s.user_id WHERE s.token_hash = ?
  `).bind(tokenHash).first();
  if (!row || Date.parse(row.expiresAt) <= Date.now()) {
    if (row) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  const now = new Date().toISOString();
  let nextCookie = null;
  if (Date.now() - Date.parse(row.rotatedAt) >= SESSION_ROTATE_MS) {
    const nextRaw = randomToken(32); const nextHash = await sha256(nextRaw);
    await env.DB.prepare("UPDATE auth_sessions SET token_hash = ?, rotated_at = ?, last_seen_at = ? WHERE token_hash = ?")
      .bind(nextHash, now, now, tokenHash).run();
    nextCookie = sessionCookie(nextRaw, new URL(request.url));
  } else {
    await env.DB.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(now, tokenHash).run();
  }
  return { user: { id: row.userId, email: row.email, name: row.name || row.email.split("@")[0] }, csrfToken: row.csrfToken, tokenHash, setCookie: nextCookie };
}

export function attachSession(response, auth) {
  if (!auth?.setCookie || response.headers.has("set-cookie")) return response;
  const headers = new Headers(response.headers); headers.append("set-cookie", auth.setCookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function requireCsrf(request, auth) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw httpError(403, "This request could not be verified. Refresh Arcadia and try again.");
  if (!auth?.csrfToken || !safeEqual(request.headers.get("x-csrf-token") || "", auth.csrfToken)) {
    throw httpError(403, "This request could not be verified. Refresh Arcadia and try again.");
  }
}

export async function handleSessionRoute(request, env, url, auth) {
  const method = request.method.toUpperCase(); const path = url.pathname;
  if (method === "POST" && path === "/api/auth/logout") {
    requireCsrf(request, auth);
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(auth.tokenHash).run();
    return apiJson({ ok: true }, 200, { "set-cookie": clearSessionCookie(url) });
  }
  if (method === "POST" && path === "/api/auth/logout-all") {
    requireCsrf(request, auth);
    await env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(auth.user.id).run();
    return apiJson({ ok: true }, 200, { "set-cookie": clearSessionCookie(url) });
  }
  return null;
}

export async function handleAccountRoute(request, env, url, auth) {
  const method = request.method.toUpperCase(); const path = url.pathname; const userId = auth.user.id;
  if (method === "GET" && path === "/api/account") return apiJson({ account: await accountView(env, userId), csrfToken: auth.csrfToken });
  if (method === "PATCH" && path === "/api/account") {
    requireCsrf(request, auth); const body = await readJson(request);
    const name = cleanText(body.name, 80); const theme = cleanText(body.theme, 20);
    if (body.name !== undefined && !name) throw httpError(400, "Add a name for your account.");
    if (body.theme !== undefined && !THEMES.includes(theme)) throw httpError(400, "Choose a valid theme.");
    const now = new Date().toISOString(); const statements = [];
    if (body.name !== undefined) statements.push(env.DB.prepare("UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?").bind(name, now, userId));
    if (body.theme !== undefined) statements.push(env.DB.prepare("UPDATE user_preferences SET theme = ?, updated_at = ? WHERE user_id = ?").bind(theme, now, userId));
    if (statements.length) await env.DB.batch(statements);
    return apiJson({ account: await accountView(env, userId) });
  }
  if (method === "POST" && path === "/api/account/change-password") {
    requireCsrf(request, auth); const body = await readJson(request); validatePassword(body.newPassword);
    const account = await getAccount(env, userId);
    if (!await verifyPassword(body.currentPassword || "", account)) throw httpError(400, "Current password is incorrect.");
    const next = await passwordRecord(body.newPassword, env); const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, password_version = 1, updated_at = ? WHERE user_id = ?")
        .bind(next.hash, next.salt, next.iterations, now, userId),
      env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId)
    ]);
    const session = await createSession(env, userId, url);
    return apiJson({ ok: true, csrfToken: session.csrfToken }, 200, { "set-cookie": session.cookie });
  }
  if (method === "POST" && path === "/api/account/change-email") {
    requireCsrf(request, auth); const body = await readJson(request); const email = validateEmail(body.email);
    const account = await getAccount(env, userId);
    if (!await verifyPassword(body.currentPassword || "", account)) throw httpError(400, "Current password is incorrect.");
    if (email.normalized === account.emailNormalized) throw httpError(400, "That is already your account email.");
    if (await env.DB.prepare("SELECT user_id FROM accounts WHERE email_normalized = ?").bind(email.normalized).first()) throw httpError(409, "That email is already in use.");
    const token = await createAuthToken(env, { kind: "change_email", userId, email: email.value, emailNormalized: email.normalized }, 30 * 60 * 1000);
    const link = `${appOrigin(env, url)}/api/account/verify-email-change?token=${encodeURIComponent(token.raw)}`;
    await sendEmail(env, email.value, "Confirm your new Arcadia email", emailTemplate("Confirm your new email", "Use this link within 30 minutes to change the email on your Arcadia account.", link), request);
    return apiJson({ message: "Check your new email to confirm the change.", ...(developmentLinks(env, request) ? { verificationUrl: link } : {}) });
  }
  if (method === "DELETE" && path === "/api/account") {
    requireCsrf(request, auth); const body = await readJson(request); const account = await getAccount(env, userId);
    if (body.confirmation !== "DELETE") throw httpError(400, "Type DELETE to confirm permanent account deletion.");
    if (!await verifyPassword(body.password || "", account)) throw httpError(400, "Current password is incorrect.");
    await deleteAccountData(env, userId);
    return apiJson({ ok: true }, 200, { "set-cookie": clearSessionCookie(url) });
  }
  return null;
}

export async function verifyEmailChange(request, env, url) {
  const token = await consumeToken(env, url.searchParams.get("token"), "change_email");
  if (!token?.userId) return Response.redirect(`${url.origin}/login?email=invalid`, 302);
  const now = new Date().toISOString();
  const collision = await env.DB.prepare("SELECT user_id FROM accounts WHERE email_normalized = ? AND user_id != ?").bind(token.emailNormalized, token.userId).first();
  if (collision) return Response.redirect(`${url.origin}/login?email=taken`, 302);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET email = ?, email_normalized = ?, updated_at = ? WHERE user_id = ?").bind(token.email, token.emailNormalized, now, token.userId),
    env.DB.prepare("UPDATE profiles SET email = ?, updated_at = ? WHERE user_id = ?").bind(token.email, now, token.userId),
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(token.userId)
  ]);
  return Response.redirect(`${url.origin}/login?email=changed`, 302);
}

async function register(request, env, url) {
  const body = await readJson(request); const email = validateEmail(body.email); const name = cleanText(body.name, 80);
  if (!name) throw httpError(400, "Add your name."); validatePassword(body.password);
  await rateLimit(env, request, "register", email.normalized, 3, 60 * 60 * 1000);
  const existing = await env.DB.prepare("SELECT user_id FROM accounts WHERE email_normalized = ?").bind(email.normalized).first();
  let link = null;
  if (!existing) {
    const password = await passwordRecord(body.password, env);
    const token = await createAuthToken(env, { kind: "register", email: email.value, emailNormalized: email.normalized, displayName: name, ...password }, 24 * 60 * 60 * 1000);
    link = `${appOrigin(env, url)}/verify-email?token=${encodeURIComponent(token.raw)}`;
    await sendEmail(env, email.value, "Verify your Arcadia account", emailTemplate("Verify your email", "Activate your Arcadia account and keep your plan safely in sync.", link), request);
  }
  return apiJson({ message: "If that email can be registered, a verification link is on its way.", ...(link && developmentLinks(env, request) ? { verificationUrl: link } : {}) }, 202);
}

async function verifyRegistration(request, env, url) {
  const token = await consumeToken(env, url.searchParams.get("token"), "register");
  if (!token) throw httpError(400, "This verification link is invalid or has expired.");
  if (await env.DB.prepare("SELECT user_id FROM accounts WHERE email_normalized = ?").bind(token.emailNormalized).first()) return apiJson({ redirect: "/login?verified=1" });
  const matches = await env.DB.prepare("SELECT user_id AS userId FROM profiles WHERE lower(email) = ? ORDER BY created_at").bind(token.emailNormalized).all();
  if ((matches.results || []).length > 1) { console.error("Ambiguous Arcadia legacy account claim", { emailHash: await sha256(token.emailNormalized) }); throw httpError(409, "This account needs help from the Arcadia site owner before it can be claimed."); }
  const userId = matches.results?.[0]?.userId || crypto.randomUUID(); const now = new Date().toISOString(); const statements = [];
  if (!matches.results?.length) statements.push(env.DB.prepare("INSERT INTO profiles (user_id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(userId, token.email, token.displayName, now, now));
  else statements.push(env.DB.prepare("UPDATE profiles SET email = ?, display_name = COALESCE(display_name, ?), updated_at = ? WHERE user_id = ?").bind(token.email, token.displayName, now, userId));
  statements.push(env.DB.prepare(`INSERT INTO accounts (user_id, email, email_normalized, password_hash, password_salt, password_iterations, password_version, email_verified_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .bind(userId, token.email, token.emailNormalized, token.passwordHash, token.passwordSalt, token.passwordIterations, now, now, now));
  statements.push(env.DB.prepare("INSERT INTO user_preferences (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING").bind(userId, now));
  await env.DB.batch(statements);
  return apiJson({ redirect: "/login?verified=1" });
}

async function login(request, env, url) {
  const body = await readJson(request); const email = validateEmail(body.email);
  await rateLimit(env, request, "login", email.normalized, 5, 15 * 60 * 1000);
  const account = await env.DB.prepare(`SELECT user_id AS userId, email, email_normalized AS emailNormalized, password_hash AS passwordHash,
    password_salt AS passwordSalt, password_iterations AS passwordIterations FROM accounts WHERE email_normalized = ?`).bind(email.normalized).first();
  if (!account || !await verifyPassword(body.password || "", account)) throw httpError(401, "Email or password is incorrect.");
  await clearRateLimit(env, request, "login", email.normalized);
  const session = await createSession(env, account.userId, url);
  return apiJson({ redirect: "/", csrfToken: session.csrfToken }, 200, { "set-cookie": session.cookie });
}

async function forgotPassword(request, env, url) {
  const body = await readJson(request); const email = validateEmail(body.email);
  await rateLimit(env, request, "recovery", email.normalized, 3, 60 * 60 * 1000);
  const account = await env.DB.prepare("SELECT user_id AS userId FROM accounts WHERE email_normalized = ?").bind(email.normalized).first(); let link = null;
  if (account) {
    const token = await createAuthToken(env, { kind: "reset_password", userId: account.userId, email: email.value, emailNormalized: email.normalized }, 30 * 60 * 1000);
    link = `${appOrigin(env, url)}/reset-password?token=${encodeURIComponent(token.raw)}`;
    await sendEmail(env, email.value, "Reset your Arcadia password", emailTemplate("Reset your password", "Use this link within 30 minutes. If you did not request it, you can ignore this email.", link), request);
  }
  return apiJson({ message: "If an account exists for that email, a reset link is on its way.", ...(link && developmentLinks(env, request) ? { resetUrl: link } : {}) });
}

async function resetPassword(request, env, url) {
  const body = await readJson(request); validatePassword(body.password); const token = await consumeToken(env, body.token, "reset_password");
  if (!token?.userId) throw httpError(400, "This reset link is invalid or has expired.");
  const next = await passwordRecord(body.password, env); const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?, password_version = 1, updated_at = ? WHERE user_id = ?").bind(next.hash, next.salt, next.iterations, now, token.userId),
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(token.userId)
  ]);
  const session = await createSession(env, token.userId, url);
  return apiJson({ redirect: "/", csrfToken: session.csrfToken }, 200, { "set-cookie": session.cookie });
}

async function createAuthToken(env, data, ttlMs) {
  const raw = randomToken(32); const tokenHash = await sha256(raw); const now = new Date(); const expires = new Date(now.getTime() + ttlMs).toISOString();
  await env.DB.prepare("DELETE FROM auth_tokens WHERE kind = ? AND email_normalized = ? AND consumed_at IS NULL").bind(data.kind, data.emailNormalized).run();
  await env.DB.prepare(`INSERT INTO auth_tokens (token_hash, kind, user_id, email, email_normalized, display_name, password_hash, password_salt, password_iterations, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(tokenHash, data.kind, data.userId || null, data.email, data.emailNormalized, data.displayName || null, data.hash || null, data.salt || null, data.iterations || null, expires, now.toISOString()).run();
  return { raw };
}

async function consumeToken(env, raw, kind) {
  if (!raw || raw.length > 200) return null; const tokenHash = await sha256(raw);
  const row = await env.DB.prepare(`SELECT token_hash AS tokenHash, user_id AS userId, email, email_normalized AS emailNormalized,
    display_name AS displayName, password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations,
    expires_at AS expiresAt, consumed_at AS consumedAt FROM auth_tokens WHERE token_hash = ? AND kind = ?`).bind(tokenHash, kind).first();
  if (!row || row.consumedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
  const result = await env.DB.prepare("UPDATE auth_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL").bind(new Date().toISOString(), tokenHash).run();
  return Number(result.meta?.changes || 0) ? row : null;
}

async function createSession(env, userId, url) {
  const raw = randomToken(32); const tokenHash = await sha256(raw); const csrfToken = randomToken(24); const now = new Date(); const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await env.DB.prepare("INSERT INTO auth_sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, rotated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(tokenHash, userId, csrfToken, now.toISOString(), now.toISOString(), now.toISOString(), expires.toISOString()).run();
  return { csrfToken, cookie: sessionCookie(raw, url, expires) };
}

async function passwordRecord(password, env) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16)); const salt = base64url(saltBytes);
  const iterations = Math.max(1, Number(env.AUTH_PBKDF2_ITERATIONS) || PASSWORD_ITERATIONS);
  return { salt, iterations, hash: await derivePassword(password, saltBytes, iterations) };
}

async function verifyPassword(password, account) {
  if (!account?.passwordHash || typeof password !== "string") return false;
  const actual = await derivePassword(password, fromBase64url(account.passwordSalt), Number(account.passwordIterations));
  return safeEqual(actual, account.passwordHash);
}

async function derivePassword(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return base64url(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)));
}

async function getAccount(env, userId) {
  return env.DB.prepare(`SELECT user_id AS userId, email, email_normalized AS emailNormalized, password_hash AS passwordHash,
    password_salt AS passwordSalt, password_iterations AS passwordIterations FROM accounts WHERE user_id = ?`).bind(userId).first();
}

async function accountView(env, userId) {
  return env.DB.prepare(`SELECT a.email, p.display_name AS name, p.grade, p.timezone, up.theme,
    a.email_verified_at AS emailVerifiedAt, a.created_at AS createdAt
    FROM accounts a JOIN profiles p ON p.user_id = a.user_id LEFT JOIN user_preferences up ON up.user_id = a.user_id WHERE a.user_id = ?`).bind(userId).first();
}

async function deleteAccountData(env, userId) {
  const account = await getAccount(env, userId); const identityHash = account?.emailNormalized ? await sha256(account.emailNormalized) : null;
  if (env.FILES) {
    const stored = await env.DB.prepare("SELECT storage_key AS storageKey FROM subject_files WHERE user_id = ?").bind(userId).all();
    await Promise.all((stored.results || []).map((file) => env.FILES.delete(file.storageKey)));
  }
  const tables = ["oauth_states", "google_calendars", "google_connections", "proposals", "chat_messages", "subject_files", "subject_contexts", "activity", "study_sessions", "events", "tasks", "commitments", "subjects", "user_preferences", "auth_tokens", "auth_sessions", "accounts", "profiles"];
  const statements = tables.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId));
  if (identityHash) statements.unshift(env.DB.prepare("DELETE FROM auth_rate_limits WHERE identity_hash = ?").bind(identityHash));
  await env.DB.batch(statements);
}

async function rateLimit(env, request, action, identity, limit, windowMs) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const keyHash = await sha256(`${identity}|${ip}`); const identityHash = await sha256(identity); const now = Date.now(); const row = await env.DB.prepare("SELECT attempt_count AS count, window_started_at AS startedAt, blocked_until AS blockedUntil FROM auth_rate_limits WHERE key_hash = ? AND action = ?").bind(keyHash, action).first();
  if (row?.blockedUntil && Date.parse(row.blockedUntil) > now) throw httpError(429, "Too many attempts. Please wait and try again.");
  const inWindow = row && now - Date.parse(row.startedAt) < windowMs; const count = inWindow ? Number(row.count) + 1 : 1; const startedAt = inWindow ? row.startedAt : new Date(now).toISOString();
  const blockedUntil = count > limit ? new Date(now + windowMs).toISOString() : null;
  await env.DB.prepare(`INSERT INTO auth_rate_limits (key_hash, identity_hash, action, attempt_count, window_started_at, blocked_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_hash, action) DO UPDATE SET identity_hash = excluded.identity_hash, attempt_count = excluded.attempt_count, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at`)
    .bind(keyHash, identityHash, action, count, startedAt, blockedUntil, new Date(now).toISOString()).run();
  if (blockedUntil) throw httpError(429, "Too many attempts. Please wait and try again.");
}

async function clearRateLimit(env, request, action, identity) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key_hash = ? AND action = ?").bind(await sha256(`${identity}|${ip}`), action).run();
}

async function sendEmail(env, to, subject, html, request) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    if (developmentLinks(env, request)) return;
    throw httpError(503, "Account email is temporarily unavailable. Please try again later.");
  }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], subject, html }) });
  if (!response.ok) { console.error("Resend account email failed", { status: response.status }); throw httpError(503, "Account email is temporarily unavailable. Please try again later."); }
}

function emailTemplate(title, copy, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17182b"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#6670d8;color:#fff;text-decoration:none;font-weight:700">Continue to Arcadia</a></p><p style="color:#6c6f84;font-size:12px">If the button does not work, copy this link: ${escapeHtml(link)}</p></div>`;
}

function validateEmail(value) {
  const email = cleanText(value, 254); const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Enter a valid email address.");
  return { value: email, normalized };
}

function validatePassword(value) {
  const length = typeof value === "string" ? Array.from(value).length : 0;
  if (length < 12 || length > 128) throw httpError(400, "Use a password between 12 and 128 characters.");
}

function appOrigin(env, url) { try { return new URL(env.APP_ORIGIN || url.origin).origin; } catch { return url.origin; } }
function developmentLinks(env, request) { const host = new URL(request.url).hostname; return env.AUTH_TEST_MODE === "true" || host === "localhost" || host === "127.0.0.1"; }
function cookieName(url) { return url.protocol === "https:" ? "__Host-arcadia_session" : "arcadia_session"; }
function sessionCookie(raw, url, expires = new Date(Date.now() + SESSION_DAYS * 86400000)) { return `${cookieName(url)}=${raw}; Path=/; HttpOnly; SameSite=Strict; ${url.protocol === "https:" ? "Secure; " : ""}Expires=${expires.toUTCString()}`; }
function clearSessionCookie(url) { return `${cookieName(url)}=; Path=/; HttpOnly; SameSite=Strict; ${url.protocol === "https:" ? "Secure; " : ""}Expires=Thu, 01 Jan 1970 00:00:00 GMT`; }
function readCookie(header, name) { for (const part of header.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return rest.join("="); } return null; }
function randomToken(bytes) { return base64url(crypto.getRandomValues(new Uint8Array(bytes))); }
async function sha256(value) { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))); }
function base64url(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function fromBase64url(value) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); const binary = atob(padded); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
function safeEqual(left, right) { if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index); return difference === 0; }
function cleanText(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
async function readJson(request) { try { return await request.json(); } catch { throw httpError(400, "Send a valid JSON request."); } }
function apiJson(value, status = 200, extra = {}) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } }); }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
