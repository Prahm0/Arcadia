import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";
import { schemaStatements } from "../db/schema.ts";
import {
  completeEvent, createEvent, createProposal, deleteEvent, ensureDatabase, getAnalytics, getEvent,
  getPlannerData, listEvents, listTasks, updateEvent, upsertProfile, weekRange
} from "../worker/db.js";
import { applyProposal } from "../worker/openai.js";

class D1Statement {
  constructor(sqlite, sql) { this.sqlite = sqlite; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.values) }; }
  async first() { return this.sqlite.prepare(this.sql).get(...this.values) || null; }
}

class TestD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const sessionCache = new WeakMap();
const testEnv = () => ({ DB: new TestD1(), AUTH_TEST_MODE: "true", AUTH_PBKDF2_ITERATIONS: "1" });
async function authHeaders(env, id = "owner", json = false) {
  let users = sessionCache.get(env); if (!users) { users = new Map(); sessionCache.set(env, users); }
  if (!users.has(id)) {
    await ensureDatabase(env);
    const email = `${id}@example.com`; const password = `correct horse battery ${id}`;
    await upsertProfile(env, { id, email, name: id });
    const registration = await worker.fetch(new Request("https://arcadia.test/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: id, email, password }) }), env, {});
    const registered = await registration.json();
    if (registered.verificationUrl) {
      const verification = new URL(registered.verificationUrl);
      const verified = await worker.fetch(new Request(`https://arcadia.test/api/auth/verify?token=${encodeURIComponent(verification.searchParams.get("token"))}`), env, {});
      assert.equal(verified.status, 200, await verified.text());
    }
    const login = await worker.fetch(new Request("https://arcadia.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), env, {});
    const payload = await login.json(); assert.equal(login.status, 200, JSON.stringify(payload));
    users.set(id, { cookie: login.headers.get("set-cookie").split(";")[0], csrf: payload.csrfToken });
  }
  const session = users.get(id); return { cookie: session.cookie, "x-csrf-token": session.csrf, ...(json ? { "content-type": "application/json" } : {}) };
}

test("serves Today as the private Arcadia home without hardcoded demo work", async () => {
  const env = testEnv(); const response = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env) }), env, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /Today’s plan/);
  assert.match(html, /Your focus today/);
  assert.match(html, /Arcadia Mentor/);
  assert.doesNotMatch(html, /Economics lecture|Calculus problem set|Easy run/);
});

test("uses all six Arcadia destinations in the intended navigation order", async () => {
  const env = testEnv(); const response = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env) }), env, {});
  const html = await response.text();
  const navigation = html.slice(html.indexOf('<nav class="rail-nav"'), html.indexOf('</nav>'));
  assert.ok(navigation.indexOf('data-view="mentor"') < navigation.indexOf('data-view="today"'));
  assert.ok(navigation.indexOf('data-view="today"') < navigation.indexOf('data-view="schedule"'));
  assert.ok(navigation.indexOf('data-view="schedule"') < navigation.indexOf('data-view="study-tracker"'));
  assert.ok(navigation.indexOf('data-view="study-tracker"') < navigation.indexOf('data-view="analytics"'));
  assert.ok(navigation.indexOf('data-view="analytics"') < navigation.indexOf('data-view="study-group"'));
  assert.doesNotMatch(navigation, /settings-button/);
  assert.match(html, /id="account-menu"[^>]*role="menu"[^>]*hidden/);
  assert.match(html, /id="account-settings-button"/);
  assert.match(html, /data-view-panel="today"/);
  assert.match(html, /data-view-panel="schedule"[^>]*hidden/);
  assert.match(html, /data-view-panel="study-tracker"[^>]*hidden/);
  assert.match(html, /data-view-panel="analytics"[^>]*hidden/);
  assert.match(html, /data-view-panel="study-group"[^>]*hidden/);
  assert.match(html, /data-view-panel="mentor"[^>]*hidden/);
  assert.match(html, /Create group · Coming soon/);
  assert.match(html, /Join group · Coming soon/);
  assert.match(html, /id="onboarding-dialog"/);
});

test("defaults client navigation to Today and uses persisted dashboard data", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/dashboard.js"), {}, {});
  assert.equal(response.status, 200);
  const script = await response.text();
  assert.match(script, /\['today', 'schedule', 'study-tracker', 'analytics', 'study-group', 'mentor'\]/);
  assert.match(script, /#today/);
  assert.match(script, /\/api\/dashboard/);
  assert.match(script, /\/api\/analytics\?period=/);
  assert.doesNotMatch(script, /Economics lecture|Calculus problem set/);
  assert.match(script, /\['light', 'dawn', 'rose', 'ocean', 'sage', 'lavender', 'dusk', 'dark', 'midnight'\]/);
});

test("ships responsive day, week, and month calendar controls", async () => {
  const env = testEnv(); const page = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env, "calendar-ui") }), env, {}); const html = await page.text();
  for (const view of ["day", "week", "month"]) assert.match(html, new RegExp(`data-calendar-view="${view}"`));
  for (const filter of ["school", "study", "sport", "extracurricular", "other", "assessment"]) assert.match(html, new RegExp(`data-filter="${filter}"`));
  for (const id of ["calendar-add-event", "calendar-add-task", "event-dialog", "event-form", "assessment-dialog"]) assert.match(html, new RegExp(`id="${id}"`));
  const response = await worker.fetch(new Request("https://arcadia.test/dashboard.js"), {}, {}); const script = await response.text();
  assert.match(script, /\/api\/calendar\?start=/); assert.match(script, /beginEventDrag/); assert.match(script, /moveMonthEvent/); assert.match(script, /arcadia-calendar:/);
});

test("includes subject-aware focus, stopwatch, rest, and custom tracker tools", async () => {
  const env = testEnv(); const page = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env) }), env, {});
  const html = await page.text();
  for (const id of ["tracker-subject", "tracker-goal", "tracker-clock", "tracker-start", "tracker-preset", "tracker-focus-minutes", "tracker-rest-minutes", "tracker-cycles", "tracker-auto-rest", "tracker-distraction", "tracker-history"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Pomodoro · 25 \/ 5 × 4/);
  assert.match(html, /Deep work · 50 \/ 10 × 3/);
  assert.match(html, /Long focus · 90 \/ 20 × 2/);
  assert.match(html, /data-tracker-mode="stopwatch"/);
  assert.match(html, /data-tracker-mode="rest"/);

  const response = await worker.fetch(new Request("https://arcadia.test/dashboard.js"), {}, {});
  const script = await response.text();
  assert.match(script, /arcadia-study-tracker:/);
  assert.match(script, /setInterval\(tickTracker, 250\)/);
});

test("offers nine persisted themes with restrained light and dark palettes", async () => {
  const env = testEnv(); const page = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env) }), env, {});
  const html = await page.text();
  const palettes = {
    dawn: ["#fbf5ef", "#fffaf6", "#c9826d", "#a86150"],
    rose: ["#faf4f6", "#fffafb", "#bd8296", "#996276"],
    ocean: ["#f2f7fa", "#fbfdfe", "#6f9fb9", "#4f7e99"],
    sage: ["#f4f7f1", "#fbfcf9", "#7f9b78", "#5e7a59"],
    lavender: ["#f7f5fa", "#fdfcff", "#9385b5", "#72639a"],
    dusk: ["#282633", "#322f3e", "#b89acb", "#d0b6df"]
  };
  for (const [theme, colours] of Object.entries(palettes)) {
    assert.match(html, new RegExp(`:root\\[data-theme="${theme}"\\]`));
    for (const colour of colours) assert.ok(html.includes(colour), `${theme} should include ${colour}`);
  }
  assert.match(html, /:root\[data-theme="midnight"\]/);
  assert.doesNotMatch(html, /id="theme-toggle"/);
  assert.match(html, /<select id="theme-select">[\s\S]*value="light"[\s\S]*value="dawn"[\s\S]*value="rose"[\s\S]*value="ocean"[\s\S]*value="sage"[\s\S]*value="lavender"[\s\S]*value="dusk"[\s\S]*value="dark"[\s\S]*value="midnight"/);

  const script = await (await worker.fetch(new Request("https://arcadia.test/dashboard.js"), {}, {})).text();
  for (const [theme, [canvas]] of Object.entries(palettes)) assert.match(script, new RegExp(`${theme}: '${canvas}'`));
});

test("upgrades the legacy theme constraint without losing preferences", async () => {
  const env = testEnv();
  const profileSchema = schemaStatements.find((statement) => /CREATE TABLE IF NOT EXISTS profiles/.test(statement));
  await env.DB.prepare(profileSchema).run();
  await env.DB.prepare(`CREATE TABLE user_preferences (
    user_id TEXT PRIMARY KEY,
    bedtime TEXT NOT NULL DEFAULT '22:30', wake_time TEXT NOT NULL DEFAULT '06:30',
    minimum_sleep_minutes INTEGER NOT NULL DEFAULT 480, max_daily_study_minutes INTEGER NOT NULL DEFAULT 180,
    preferred_session_minutes INTEGER NOT NULL DEFAULT 60, break_minutes INTEGER NOT NULL DEFAULT 15,
    theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'midnight')),
    updated_at TEXT NOT NULL
  )`).run();
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO profiles (user_id, email, display_name, timezone, onboarding_complete, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)")
    .bind("legacy-theme", "legacy@example.com", "Legacy", "Australia/Sydney", now, now).run();
  await env.DB.prepare("INSERT INTO user_preferences (user_id, bedtime, wake_time, theme, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("legacy-theme", "21:45", "06:15", "midnight", now).run();

  await ensureDatabase(env);
  const preserved = await env.DB.prepare("SELECT bedtime, wake_time AS wakeTime, theme FROM user_preferences WHERE user_id = ?").bind("legacy-theme").first();
  assert.equal(preserved.bedtime, "21:45"); assert.equal(preserved.wakeTime, "06:15"); assert.equal(preserved.theme, "midnight");
  await env.DB.prepare("UPDATE user_preferences SET theme = 'ocean' WHERE user_id = 'legacy-theme'").run();
  assert.equal((await env.DB.prepare("SELECT theme FROM user_preferences WHERE user_id = 'legacy-theme'").first()).theme, "ocean");
  const table = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'user_preferences'").first();
  assert.match(table.sql, /length\s*\(\s*theme\s*\)/i);
});

test("loads the focused Lucide subset without module-only browser imports", async () => {
  const env = testEnv(); const page = await worker.fetch(new Request("https://arcadia.test/", { headers: await authHeaders(env) }), env, {});
  const html = await page.text();
  assert.match(html, /<script defer src="\.\/lucide-icons\.js"><\/script>\s*<script defer src="\.\/dashboard\.js"><\/script>/);
  assert.doesNotMatch(html, /type="module"/);

  const response = await worker.fetch(new Request("https://arcadia.test/lucide-icons.js"), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/javascript/);
  const script = await response.text();
  assert.match(script, /window\.ArcadiaLucide/);
  assert.doesNotMatch(script, /\bexport\s+(?:const|function)/);
});

test("serves Arcadia brand and sharing images", async () => {
  for (const path of ["/arcadia-logo.png", "/arcadia-mark.png", "/arcadia-mark-transparent.png", "/favicon.png", "/apple-touch-icon.png", "/og-v3.png"]) {
    const response = await worker.fetch(new Request(`https://arcadia.test${path}`), {}, {});
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "image/png", path);
    assert.ok((await response.arrayBuffer()).byteLength > 100, path);
  }
});

test("serves the theme-aware Arcadia mark with transparency", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/arcadia-mark-transparent.png"), {}, {});
  const png = new Uint8Array(await response.arrayBuffer());
  assert.equal(png[25], 6, "PNG should use RGBA color data");
});

test("preserves private authentication and API ownership", async () => {
  const env = testEnv(); const page = await worker.fetch(new Request("https://arcadia.test/"), env, {});
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "https://arcadia.test/login");
  const api = await worker.fetch(new Request("https://arcadia.test/api/dashboard"), env, {});
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: "Authentication required.", loginUrl: "/login" });
  const alias = await worker.fetch(new Request("https://arcadia.test/dashboard"), env, {});
  assert.equal(alias.status, 308);
});

test("registers, verifies, claims legacy data, and enforces secure sessions and CSRF", async () => {
  const env = testEnv(); await ensureDatabase(env);
  await upsertProfile(env, { id: "legacy-student", email: "Student@Example.com", name: "Legacy Student" });
  const password = "a long memorable password";
  const registration = await worker.fetch(new Request("https://arcadia.test/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New Student", email: "Student@Example.com", password }) }), env, {});
  assert.equal(registration.status, 202); const registered = await registration.json();
  const rawToken = new URL(registered.verificationUrl).searchParams.get("token");
  assert.ok(rawToken); assert.equal(await env.DB.prepare("SELECT user_id FROM accounts").first(), null);
  assert.equal(await env.DB.prepare("SELECT token_hash FROM auth_tokens WHERE token_hash = ?").bind(rawToken).first(), null, "raw verification tokens must not be stored");

  const verification = await worker.fetch(new Request(`https://arcadia.test/api/auth/verify?token=${encodeURIComponent(rawToken)}`), env, {});
  assert.equal(verification.status, 200);
  const account = await env.DB.prepare("SELECT user_id AS userId, password_hash AS passwordHash, email_normalized AS email FROM accounts").first();
  assert.equal(account.userId, "legacy-student"); assert.equal(account.email, "student@example.com"); assert.notEqual(account.passwordHash, password);

  const login = await worker.fetch(new Request("https://arcadia.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "student@example.com", password }) }), env, {});
  assert.equal(login.status, 200); const loginBody = await login.json(); const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /__Host-arcadia_session=/); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";")[0];
  const rejected = await worker.fetch(new Request("https://arcadia.test/api/account", { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ theme: "midnight" }) }), env, {});
  assert.equal(rejected.status, 403);
  const updated = await worker.fetch(new Request("https://arcadia.test/api/account", { method: "PATCH", headers: { cookie, "content-type": "application/json", "x-csrf-token": loginBody.csrfToken }, body: JSON.stringify({ theme: "midnight", name: "Arcadia Student" }) }), env, {});
  assert.equal(updated.status, 200); assert.equal((await updated.json()).account.theme, "midnight");
  for (const theme of ["dawn", "rose", "ocean", "sage", "lavender", "dusk"]) {
    const themed = await worker.fetch(new Request("https://arcadia.test/api/account", { method: "PATCH", headers: { cookie, "content-type": "application/json", "x-csrf-token": loginBody.csrfToken }, body: JSON.stringify({ theme }) }), env, {});
    assert.equal(themed.status, 200, theme); assert.equal((await themed.json()).account.theme, theme);
  }
  const invalidTheme = await worker.fetch(new Request("https://arcadia.test/api/account", { method: "PATCH", headers: { cookie, "content-type": "application/json", "x-csrf-token": loginBody.csrfToken }, body: JSON.stringify({ theme: "neon" }) }), env, {});
  assert.equal(invalidTheme.status, 400); assert.deepEqual(await invalidTheme.json(), { error: "Choose a valid theme." });
});

test("persists tracker data across sessions, recovers credentials, changes email, and deletes the account", async () => {
  const env = testEnv(); const first = await authHeaders(env, "account-owner", true); const password = "correct horse battery account-owner";
  const entry = { id: "legacy-session-1", type: "focus", seconds: 1500, subject: "Physics", goal: "Finish questions", distractions: 2, endedAt: new Date().toISOString() };
  const saved = await worker.fetch(new Request("https://arcadia.test/api/study-sessions", { method: "POST", headers: first, body: JSON.stringify({ sessions: [entry, entry] }) }), env, {});
  assert.equal(saved.status, 201); assert.equal((await saved.json()).sessions.length, 1);
  await worker.fetch(new Request("https://arcadia.test/api/account", { method: "PATCH", headers: first, body: JSON.stringify({ theme: "dark" }) }), env, {});

  const forgot = await worker.fetch(new Request("https://arcadia.test/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "account-owner@example.com" }) }), env, {});
  const resetToken = new URL((await forgot.json()).resetUrl).searchParams.get("token"); const newPassword = "an even better password";
  const reset = await worker.fetch(new Request("https://arcadia.test/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: resetToken, password: newPassword }) }), env, {});
  assert.equal(reset.status, 200); const resetBody = await reset.json(); const resetCookie = reset.headers.get("set-cookie").split(";")[0];
  const stale = await worker.fetch(new Request("https://arcadia.test/api/dashboard", { headers: first }), env, {}); assert.equal(stale.status, 401);
  const dashboard = await worker.fetch(new Request("https://arcadia.test/api/dashboard", { headers: { cookie: resetCookie } }), env, {}); const dashboardBody = await dashboard.json();
  assert.equal(dashboard.status, 200); assert.equal(dashboardBody.preferences.theme, "dark"); assert.equal(dashboardBody.studySessions[0].goal, "Finish questions");

  const change = await worker.fetch(new Request("https://arcadia.test/api/account/change-email", { method: "POST", headers: { cookie: resetCookie, "content-type": "application/json", "x-csrf-token": resetBody.csrfToken }, body: JSON.stringify({ email: "new-owner@example.com", currentPassword: newPassword }) }), env, {});
  const changeToken = new URL((await change.json()).verificationUrl).searchParams.get("token");
  const changed = await worker.fetch(new Request(`https://arcadia.test/api/account/verify-email-change?token=${encodeURIComponent(changeToken)}`), env, {}); assert.equal(changed.status, 302);
  const relogin = await worker.fetch(new Request("https://arcadia.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "new-owner@example.com", password: newPassword }) }), env, {});
  assert.equal(relogin.status, 200); const reloginBody = await relogin.json(); const reloginCookie = relogin.headers.get("set-cookie").split(";")[0];
  const deleted = await worker.fetch(new Request("https://arcadia.test/api/account", { method: "DELETE", headers: { cookie: reloginCookie, "content-type": "application/json", "x-csrf-token": reloginBody.csrfToken }, body: JSON.stringify({ password: newPassword, confirmation: "DELETE" }) }), env, {});
  assert.equal(deleted.status, 200); assert.equal(await env.DB.prepare("SELECT user_id FROM profiles WHERE user_id = 'account-owner'").first(), null); assert.equal(await env.DB.prepare("SELECT user_id FROM accounts").first(), null);
});

test("isolates events by authenticated owner and protects imported records", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "user-a", email: "a@example.com", name: "A" });
  await upsertProfile(env, { id: "user-b", email: "b@example.com", name: "B" });
  const event = await createEvent(env, "user-a", {
    title: "Calculus focus", kind: "study", subject: "Maths",
    startAt: "2026-08-25T00:00:00.000Z", endAt: "2026-08-25T01:00:00.000Z", recurrence: "RRULE:FREQ=WEEKLY"
  });
  assert.equal((await getEvent(env, "user-a", event.id)).title, "Calculus focus");
  assert.equal(await getEvent(env, "user-b", event.id), null);
  assert.equal(await updateEvent(env, "user-b", event.id, { ...event, title: "Hijacked" }), null);
  assert.equal(await deleteEvent(env, "user-b", event.id), null);
});

test("prevents overlapping events without a bypass", async () => {
  const env = testEnv();
  await ensureDatabase(env);
  await upsertProfile(env, { id: "planner", email: "planner@example.com", name: "Planner" });
  await createEvent(env, "planner", { title: "Existing block", kind: "study", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  const body = { title: "Overlapping block", kind: "task", startAt: "2026-08-25T02:30:00.000Z", endAt: "2026-08-25T03:30:00.000Z", allowOverlap: true };
  const response = await worker.fetch(new Request("https://arcadia.test/api/events", { method: "POST", headers: await authHeaders(env, "planner", true), body: JSON.stringify(body) }), env, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).conflicts.length, 1);
});

test("serves bounded owner-only calendar ranges", async () => {
  const env = testEnv(); const headers = await authHeaders(env, "calendar-owner");
  await createEvent(env, "calendar-owner", { title: "Visible event", kind: "study", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  await upsertProfile(env, { id: "calendar-other", email: "other@example.com", name: "Other" });
  await createEvent(env, "calendar-other", { title: "Private event", kind: "study", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  const response = await worker.fetch(new Request("https://arcadia.test/api/calendar?start=2026-08-01T00:00:00.000Z&end=2026-09-15T00:00:00.000Z", { headers }), env, {});
  assert.equal(response.status, 200); const calendar = await response.json(); assert.equal(calendar.events.length, 1); assert.equal(calendar.events[0].title, "Visible event"); assert.equal(calendar.events[0].pinned, false);
  const invalid = await worker.fetch(new Request("https://arcadia.test/api/calendar?start=nope&end=2026-09-15T00:00:00.000Z", { headers }), env, {}); assert.equal(invalid.status, 400);
  const oversized = await worker.fetch(new Request("https://arcadia.test/api/calendar?start=2026-01-01T00:00:00.000Z&end=2026-05-01T00:00:00.000Z", { headers }), env, {}); assert.equal(oversized.status, 400);
});

test("keeps pinned generated study blocks through replanning without duplicating task minutes", async () => {
  const env = testEnv(); const userId = "pinned-student"; const headers = await authHeaders(env, userId, true); const due = futureWeekday(5, 8);
  const onboarding = { name: "Pinned", grade: "Year 11", timezone: "Australia/Sydney", subjects: [{ name: "Maths", color: "#8389ca", priority: 2 }], tasks: [{ title: "Maths revision", subject: "Maths", taskType: "revision", dueAt: due.toISOString(), estimatedMinutes: 120, priority: 2, notes: "" }], commitments: [], preferences: { bedtime: "22:30", wakeTime: "06:30", minimumSleepMinutes: 480, maxDailyStudyMinutes: 180, preferredSessionMinutes: 60, breakMinutes: 15 } };
  const saved = await worker.fetch(new Request("https://arcadia.test/api/onboarding", { method: "POST", headers, body: JSON.stringify(onboarding) }), env, {}); assert.equal(saved.status, 201);
  let events = await listEvents(env, userId, new Date().toISOString(), new Date(due.getTime() + 86400000).toISOString()); const first = events.find((event) => event.category === "study"); assert.ok(first);
  const pinned = await worker.fetch(new Request(`https://arcadia.test/api/events/${first.id}`, { method: "PATCH", headers, body: JSON.stringify({ pinned: true }) }), env, {}); assert.equal(pinned.status, 200); assert.equal((await pinned.json()).event.pinned, true);
  const rebuilt = await worker.fetch(new Request("https://arcadia.test/api/schedule/generate", { method: "POST", headers, body: "{}" }), env, {}); assert.equal(rebuilt.status, 200);
  events = await listEvents(env, userId, new Date().toISOString(), new Date(due.getTime() + 86400000).toISOString()); const planned = events.filter((event) => event.category === "study" && event.outcome === "planned"); assert.ok(planned.some((event) => event.id === first.id && event.pinned)); assert.equal(planned.reduce((sum, event) => sum + (Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000, 0), 120); assertNoOverlaps(events);
});

test("derives persistent completion analytics from real study sessions", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "student", email: "student@example.com", name: "Student" });
  const event = await createEvent(env, "student", { title: "Economics draft", kind: "study", subject: "Economics", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:30:00.000Z" });
  await completeEvent(env, "student", event.id);
  const range = weekRange("2026-08-25T00:00:00.000Z");
  const analytics = await getAnalytics(env, "student", range.start, range.end);
  assert.equal(analytics.focusedMinutes, 90);
  assert.equal(analytics.completionRate, 100);
  assert.equal(analytics.completedCount, 1);
});

test("serves timezone-aware day, week, and month analytics ranges", async () => {
  const env = testEnv();
  await ensureDatabase(env);
  await upsertProfile(env, { id: "periods", email: "periods@example.com", name: "Periods" });
  const event = await createEvent(env, "periods", { title: "Biology review", kind: "study", subject: "Biology", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  await completeEvent(env, "periods", event.id);

  const headers = await authHeaders(env, "periods");
  const dayResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=day&date=2026-08-25T02:00:00.000Z", { headers }), env, {});
  assert.equal(dayResponse.status, 200);
  const day = await dayResponse.json();
  assert.equal(day.period, "day");
  assert.deepEqual(day.range, { start: "2026-08-24T14:00:00.000Z", end: "2026-08-25T14:00:00.000Z" });
  assert.equal(day.analytics.focusedMinutes, 60);
  assert.equal(day.analytics.capacityMinutes, 120);

  const weekResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=week&date=2026-08-25T02:00:00.000Z", { headers }), env, {});
  const week = await weekResponse.json();
  assert.equal(week.period, "week");
  assert.deepEqual(week.range, { start: "2026-08-23T14:00:00.000Z", end: "2026-08-30T14:00:00.000Z" });
  assert.equal(week.analytics.capacityMinutes, 1200);

  const monthResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=month&date=2026-10-15T00:00:00.000Z", { headers }), env, {});
  const month = await monthResponse.json();
  assert.equal(month.period, "month");
  assert.deepEqual(month.range, { start: "2026-09-30T14:00:00.000Z", end: "2026-10-31T13:00:00.000Z" });
  assert.equal(month.analytics.capacityMinutes, 31 * 180);
});

test("keeps weekly analytics as the API default and rejects invalid filters", async () => {
  const env = testEnv(); const headers = await authHeaders(env, "defaults");
  const defaultResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?date=2026-08-25T02:00:00.000Z", { headers }), env, {});
  assert.equal(defaultResponse.status, 200);
  assert.equal((await defaultResponse.json()).period, "week");

  const badPeriod = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=term", { headers }), env, {});
  assert.equal(badPeriod.status, 400);
  assert.match((await badPeriod.json()).error, /day, week, or month/);

  const badDate = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=day&date=not-a-date", { headers }), env, {});
  assert.equal(badDate.status, 400);
  assert.match((await badDate.json()).error, /valid analytics date/);
});

test("applies an approved Mentor move exactly once", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "planner", email: "planner@example.com", name: "Planner" });
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 45 * 60 * 1000);
  const proposal = await createProposal(env, "planner", "Add a review block", [{ action: "create", eventId: null, title: "Economics review", kind: "study", subject: "Economics", startAt: start.toISOString(), endAt: end.toISOString() }]);
  assert.equal((await applyProposal(env, "planner", proposal.id)).status, "applied");
  assert.equal(await applyProposal(env, "planner", proposal.id), null);
  const events = await listEvents(env, "planner", new Date(start.getTime() - 86400000).toISOString(), new Date(end.getTime() + 86400000).toISOString());
  assert.equal(events.length, 1);
  assert.equal(events[0].category, "study");
});

test("required student journey persists, schedules, completes, misses, adapts and accepts a Mentor task action", async () => {
  const env = testEnv();
  const userId = "journey-student";
  const englishDue = futureWeekday(4, 7);
  const mathsDue = futureWeekday(5, 8);
  const onboarding = {
    name: "Alex", grade: "Year 11", timezone: "Australia/Sydney",
    subjects: [
      { name: "Maths", color: "#8389ca", priority: 3 },
      { name: "English", color: "#83acce", priority: 3 },
      { name: "Physics", color: "#609480", priority: 2 }
    ],
    tasks: [
      { title: "Maths test", subject: "Maths", taskType: "exam", dueAt: mathsDue.toISOString(), estimatedMinutes: 120, priority: 3, notes: "Revision needed" },
      { title: "English assignment", subject: "English", taskType: "assignment", dueAt: englishDue.toISOString(), estimatedMinutes: 180, priority: 3, notes: "Three hours remaining" }
    ],
    commitments: [
      { title: "School", subject: null, category: "school", startDate: null, weekday: null, startTime: "08:45", endTime: "15:00", recurrence: "weekdays", notes: "" },
      { title: "Football", subject: null, category: "sport", startDate: null, weekday: 2, startTime: "17:00", endTime: "18:30", recurrence: "weekly", notes: "" },
      { title: "Football", subject: null, category: "sport", startDate: null, weekday: 4, startTime: "17:00", endTime: "18:30", recurrence: "weekly", notes: "" }
    ],
    preferences: { bedtime: "22:30", wakeTime: "06:30", minimumSleepMinutes: 480, maxDailyStudyMinutes: 180, preferredSessionMinutes: 60, breakMinutes: 15 }
  };
  const headers = await authHeaders(env, userId, true);
  const saved = await worker.fetch(new Request("https://arcadia.test/api/onboarding", { method: "POST", headers, body: JSON.stringify(onboarding) }), env, {});
  assert.equal(saved.status, 201, await saved.text());

  const planner = await getPlannerData(env, userId);
  assert.equal(planner.profile.onboardingComplete, true);
  assert.equal(planner.subjects.length, 3);
  assert.equal(planner.tasks.filter((task) => task.status === "pending").length, 2);
  assert.equal(planner.commitments.length, 3);
  assert.equal(planner.preferences.bedtime, "22:30");

  const horizonStart = new Date(Date.now() - 86_400_000).toISOString();
  const horizonEnd = new Date(mathsDue.getTime() + 86_400_000).toISOString();
  let events = await listEvents(env, userId, horizonStart, horizonEnd);
  const study = events.filter((event) => event.category === "study");
  assert.ok(study.length >= 5, "large tasks should be split into multiple sessions");
  assert.ok(events.some((event) => event.category === "school"));
  assert.ok(events.some((event) => event.category === "sport"));
  assertNoOverlaps(events);
  for (const session of study) {
    const task = planner.tasks.find((item) => item.id === session.taskId);
    assert.ok(task, "every generated study session should belong to one persisted task");
    assert.ok(Date.parse(session.endAt) <= Date.parse(task.dueAt), "study may not run after its deadline");
    const clock = localClockMinutes(session.startAt, "Australia/Sydney");
    const endClock = localClockMinutes(session.endAt, "Australia/Sydney");
    assert.ok(clock >= 6 * 60 + 30 && endClock <= 22 * 60 + 30, "study must remain outside sleep");
  }

  const first = study[0];
  const completed = await worker.fetch(new Request(`https://arcadia.test/api/events/${first.id}/outcome`, { method: "POST", headers, body: JSON.stringify({ outcome: "completed" }) }), env, {});
  assert.equal(completed.status, 200);
  assert.equal((await getEvent(env, userId, first.id)).outcome, "completed");
  const taskAfterCompletion = (await listTasks(env, userId)).find((task) => task.id === first.taskId);
  assert.ok(taskAfterCompletion.remainingMinutes < taskAfterCompletion.estimatedMinutes);

  events = await listEvents(env, userId, horizonStart, horizonEnd);
  const missedTarget = events.find((event) => event.category === "study" && event.outcome === "planned");
  const missed = await worker.fetch(new Request(`https://arcadia.test/api/events/${missedTarget.id}/outcome`, { method: "POST", headers, body: JSON.stringify({ outcome: "missed" }) }), env, {});
  assert.equal(missed.status, 200);
  const missedPayload = await missed.json();
  assert.match(missedPayload.message, /missed|moved|safe opening/i);
  assert.equal((await getEvent(env, userId, missedTarget.id)).outcome, "missed");
  const replanned = await listEvents(env, userId, new Date().toISOString(), horizonEnd);
  assert.ok(replanned.some((event) => event.taskId === missedTarget.taskId && event.id !== missedTarget.id && event.outcome === "planned"));
  assertNoOverlaps(replanned);

  const mentor = await worker.fetch(new Request("https://arcadia.test/api/chat", {
    method: "POST", headers,
    body: JSON.stringify({ message: "I just found out I have chemistry homework due Wednesday that will take about an hour." })
  }), env, {});
  assert.equal(mentor.status, 200);
  const payloads = (await mentor.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(payloads.some((payload) => payload.type === "message" && payload.action?.intent === "CREATE_TASK"));
  const tasks = await listTasks(env, userId);
  const chemistry = tasks.find((task) => /chemistry homework/i.test(task.title));
  assert.ok(chemistry, "Mentor should persist the structured task action");
  const updated = await listEvents(env, userId, new Date().toISOString(), new Date(Date.now() + 22 * 86_400_000).toISOString());
  assert.ok(updated.some((event) => event.taskId === chemistry.id), "Mentor-created work should be scheduled in the shared plan");
  assertNoOverlaps(updated);

  const movedTraining = await worker.fetch(new Request("https://arcadia.test/api/chat", {
    method: "POST", headers, body: JSON.stringify({ message: "Training has been moved to 6 PM." })
  }), env, {});
  const trainingPayloads = (await movedTraining.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(trainingPayloads.some((payload) => payload.action?.intent === "UPDATE_COMMITMENT_TIME"));
  const afterTraining = await getPlannerData(env, userId);
  assert.ok(afterTraining.commitments.filter((item) => item.category === "sport").every((item) => item.startTime === "18:00"));
});

function futureWeekday(weekday, minimumDays) {
  const date = new Date(); date.setUTCHours(12, 59, 0, 0);
  let delta = (weekday - date.getUTCDay() + 7) % 7;
  while (delta < minimumDays) delta += 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}
function assertNoOverlaps(events) {
  const active = events.filter((event) => event.status !== "cancelled").sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  for (let index = 1; index < active.length; index += 1) {
    assert.ok(Date.parse(active[index - 1].endAt) <= Date.parse(active[index].startAt), `${active[index - 1].title} overlaps ${active[index].title}`);
  }
}
function localClockMinutes(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
