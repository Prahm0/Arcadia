import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";
import { completeEvent, createEvent, createProposal, deleteEvent, ensureDatabase, getAnalytics, getEvent, listEvents, updateEvent, upsertProfile, weekRange } from "../worker/db.js";
import { applyProposal } from "../worker/openai.js";

class D1Statement {
  constructor(statement) { this.statement = statement; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.statement.run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  async all() { return { results: this.statement.all(...this.values) }; }
  async first() { return this.statement.get(...this.values) || null; }
}

class TestD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) { return new D1Statement(this.sqlite.prepare(sql)); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

test("serves the dashboard at the private root", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/", { headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.com" } }), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Your week, in balance/);
});

test("serves Dashboard first with three hash-addressable widget previews", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/", { headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.com" } }), {}, {});
  const html = await response.text();
  const navigation = html.slice(html.indexOf('<nav class="rail-nav"'), html.indexOf('</nav>'));
  const dashboard = navigation.indexOf('data-view="dashboard"');
  const calendar = navigation.indexOf('data-view="calendar"');
  const pulse = navigation.indexOf('data-view="weekly-pulse"');
  const assistant = navigation.indexOf('data-view="assistant"');
  assert.ok(dashboard >= 0 && calendar > dashboard && pulse > calendar && assistant > pulse);
  assert.match(html, /data-widget-view="dashboard"/);
  assert.match(html, /data-preview-view="calendar"/);
  assert.match(html, /data-preview-view="weekly-pulse"/);
  assert.match(html, /data-preview-view="assistant"/);
  assert.match(html, /<article class="preview-card calendar-preview-card">/);
  assert.match(html, /class="preview-title-link" href="#calendar"/);
  assert.match(html, /id="dashboard-week-strip"/);
  assert.match(html, /id="dashboard-composer"/);
  assert.match(html, /data-widget-view="calendar"[^>]*hidden/);
  assert.match(html, /data-widget-view="weekly-pulse"[^>]*hidden/);
  assert.match(html, /data-widget-view="assistant"[^>]*hidden/);
});

test("defaults client navigation to the Dashboard hash", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/dashboard.js"), {}, {});
  assert.equal(response.status, 200);
  const script = await response.text();
  assert.match(script, /\['dashboard', 'calendar', 'weekly-pulse', 'assistant'\]/);
  assert.match(script, /#dashboard/);
});

test("links Arcadia branding to the canonical calendar dashboard", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/", { headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.com" } }), {}, {});
  const html = await response.text();
  assert.equal((html.match(/href="\/#calendar" aria-label="Arcadia dashboard"/g) || []).length, 2);
  assert.match(html, /id="rail-toggle"[^>]*aria-label="Expand navigation"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>A</);
  assert.equal((html.match(/src="\/arcadia-mark-transparent\.png"/g) || []).length, 2);
  assert.match(html, /:root\[data-theme="dark"\] \.brand-mark/);
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

test("redirects unauthenticated page requests to platform sign-in", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/"), {}, {});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://arcadia.test/signin-with-chatgpt?return_to=%2F");
});

test("redirects the dashboard alias to root", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/dashboard"), {}, {});
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://arcadia.test/");
});

test("rejects unauthenticated API access", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/api/dashboard"), {}, {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required." });
});

test("does not expose the removed marketing route", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/arcadia.html"), {}, {});
  assert.equal(response.status, 404);
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
  assert.equal((await getEvent(env, "user-a", event.id)).recurrence, "RRULE:FREQ=WEEKLY");
  assert.equal(await getEvent(env, "user-b", event.id), null);
  assert.equal(await updateEvent(env, "user-b", event.id, { ...event, title: "Hijacked" }), null);
  assert.equal(await deleteEvent(env, "user-b", event.id), null);
  assert.equal((await getEvent(env, "user-a", event.id)).title, "Calculus focus");
});

test("requires explicit permission before saving an overlapping event", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "planner", email: "planner@example.com", name: "Planner" });
  await createEvent(env, "planner", {
    title: "Existing block", kind: "study",
    startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z"
  });
  const headers = { "content-type": "application/json", "oai-authenticated-user-id": "planner", "oai-authenticated-user-email": "planner@example.com" };
  const body = { title: "Overlapping block", kind: "task", startAt: "2026-08-25T02:30:00.000Z", endAt: "2026-08-25T03:30:00.000Z" };
  const blocked = await worker.fetch(new Request("https://arcadia.test/api/events", { method: "POST", headers, body: JSON.stringify(body) }), env, {});
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).conflicts.length, 1);
  const allowed = await worker.fetch(new Request("https://arcadia.test/api/events", { method: "POST", headers, body: JSON.stringify({ ...body, allowOverlap: true }) }), env, {});
  assert.equal(allowed.status, 201);
});

test("derives weekly analytics from completed study sessions", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "student", email: "student@example.com", name: "Student" });
  const event = await createEvent(env, "student", {
    title: "Economics draft", kind: "study", subject: "Economics",
    startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:30:00.000Z"
  });
  await completeEvent(env, "student", event.id);
  const range = weekRange("2026-08-25T00:00:00.000Z");
  const analytics = await getAnalytics(env, "student", range.start, range.end);
  assert.equal(analytics.focusedMinutes, 90);
  assert.equal(analytics.completionRate, 100);
  assert.deepEqual(analytics.subjectDistribution, [{ subject: "Economics", minutes: 90 }]);
});

test("applies an approved assistant proposal exactly once", async () => {
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "planner", email: "planner@example.com", name: "Planner" });
  const start = new Date(Date.now() + 48 * 60 * 60 * 1000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 45 * 60 * 1000);
  const proposal = await createProposal(env, "planner", "Add a review block", [{
    action: "create", eventId: null, title: "Economics review", kind: "study", subject: "Economics",
    startAt: start.toISOString(), endAt: end.toISOString()
  }]);
  assert.equal((await applyProposal(env, "planner", proposal.id)).status, "applied");
  assert.equal(await applyProposal(env, "planner", proposal.id), null);
  const events = await listEvents(env, "planner", new Date(start.getTime() - 86400000).toISOString(), new Date(end.getTime() + 86400000).toISOString());
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Economics review");
});
