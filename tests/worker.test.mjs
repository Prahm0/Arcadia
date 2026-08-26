import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../dist/server/index.js";
import {
  completeEvent, createEvent, createProposal, deleteEvent, ensureDatabase, getAnalytics, getEvent,
  getPlannerData, listEvents, listTasks, updateEvent, upsertProfile, weekRange
} from "../worker/db.js";
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

const authHeaders = (id = "owner") => ({
  "oai-authenticated-user-id": id,
  "oai-authenticated-user-email": `${id}@example.com`
});
const jsonHeaders = (id = "owner") => ({ ...authHeaders(id), "content-type": "application/json" });

test("serves Today as the private Arcadia home without hardcoded demo work", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/", { headers: authHeaders() }), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const html = await response.text();
  assert.match(html, /Today’s plan/);
  assert.match(html, /Your focus today/);
  assert.match(html, /Arcadia Mentor/);
  assert.doesNotMatch(html, /Economics lecture|Calculus problem set|Easy run/);
});

test("uses all six Arcadia destinations in the intended navigation order", async () => {
  const response = await worker.fetch(new Request("https://arcadia.test/", { headers: authHeaders() }), {}, {});
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
  assert.match(script, /\['light', 'dark', 'midnight'\]/);
});

test("includes subject-aware focus, stopwatch, rest, and custom tracker tools", async () => {
  const page = await worker.fetch(new Request("https://arcadia.test/", { headers: authHeaders() }), {}, {});
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

test("offers a persisted Midnight theme with black, purple, and blue styling", async () => {
  const page = await worker.fetch(new Request("https://arcadia.test/", { headers: authHeaders() }), {}, {});
  const html = await page.text();
  assert.match(html, /:root\[data-theme="midnight"\]/);
  assert.match(html, /--canvas:\s*#020309/);
  assert.match(html, /--line:\s*#452a7d/);
  assert.match(html, /--accent:\s*#358cff/);
  assert.doesNotMatch(html, /id="theme-toggle"/);
  assert.match(html, /<select id="theme-select">[\s\S]*value="light"[\s\S]*value="dark"[\s\S]*value="midnight"/);
});

test("loads the focused Lucide subset without module-only browser imports", async () => {
  const page = await worker.fetch(new Request("https://arcadia.test/", { headers: authHeaders() }), {}, {});
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
  const page = await worker.fetch(new Request("https://arcadia.test/"), {}, {});
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "https://arcadia.test/signin-with-chatgpt?return_to=%2F");
  const api = await worker.fetch(new Request("https://arcadia.test/api/dashboard"), {}, {});
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: "Authentication required." });
  const alias = await worker.fetch(new Request("https://arcadia.test/dashboard"), {}, {});
  assert.equal(alias.status, 308);
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
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "planner", email: "planner@example.com", name: "Planner" });
  await createEvent(env, "planner", { title: "Existing block", kind: "study", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  const body = { title: "Overlapping block", kind: "task", startAt: "2026-08-25T02:30:00.000Z", endAt: "2026-08-25T03:30:00.000Z", allowOverlap: true };
  const response = await worker.fetch(new Request("https://arcadia.test/api/events", { method: "POST", headers: jsonHeaders("planner"), body: JSON.stringify(body) }), env, {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).conflicts.length, 1);
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
  const env = { DB: new TestD1() };
  await ensureDatabase(env);
  await upsertProfile(env, { id: "periods", email: "periods@example.com", name: "Periods" });
  const event = await createEvent(env, "periods", { title: "Biology review", kind: "study", subject: "Biology", startAt: "2026-08-25T02:00:00.000Z", endAt: "2026-08-25T03:00:00.000Z" });
  await completeEvent(env, "periods", event.id);

  const dayResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=day&date=2026-08-25T02:00:00.000Z", { headers: authHeaders("periods") }), env, {});
  assert.equal(dayResponse.status, 200);
  const day = await dayResponse.json();
  assert.equal(day.period, "day");
  assert.deepEqual(day.range, { start: "2026-08-24T14:00:00.000Z", end: "2026-08-25T14:00:00.000Z" });
  assert.equal(day.analytics.focusedMinutes, 60);
  assert.equal(day.analytics.capacityMinutes, 120);

  const weekResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=week&date=2026-08-25T02:00:00.000Z", { headers: authHeaders("periods") }), env, {});
  const week = await weekResponse.json();
  assert.equal(week.period, "week");
  assert.deepEqual(week.range, { start: "2026-08-23T14:00:00.000Z", end: "2026-08-30T14:00:00.000Z" });
  assert.equal(week.analytics.capacityMinutes, 1200);

  const monthResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=month&date=2026-10-15T00:00:00.000Z", { headers: authHeaders("periods") }), env, {});
  const month = await monthResponse.json();
  assert.equal(month.period, "month");
  assert.deepEqual(month.range, { start: "2026-09-30T14:00:00.000Z", end: "2026-10-31T13:00:00.000Z" });
  assert.equal(month.analytics.capacityMinutes, 31 * 180);
});

test("keeps weekly analytics as the API default and rejects invalid filters", async () => {
  const env = { DB: new TestD1() };
  const defaultResponse = await worker.fetch(new Request("https://arcadia.test/api/analytics?date=2026-08-25T02:00:00.000Z", { headers: authHeaders("defaults") }), env, {});
  assert.equal(defaultResponse.status, 200);
  assert.equal((await defaultResponse.json()).period, "week");

  const badPeriod = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=term", { headers: authHeaders("defaults") }), env, {});
  assert.equal(badPeriod.status, 400);
  assert.match((await badPeriod.json()).error, /day, week, or month/);

  const badDate = await worker.fetch(new Request("https://arcadia.test/api/analytics?period=day&date=not-a-date", { headers: authHeaders("defaults") }), env, {});
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
  const env = { DB: new TestD1() };
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
  const saved = await worker.fetch(new Request("https://arcadia.test/api/onboarding", { method: "POST", headers: jsonHeaders(userId), body: JSON.stringify(onboarding) }), env, {});
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
  const completed = await worker.fetch(new Request(`https://arcadia.test/api/events/${first.id}/outcome`, { method: "POST", headers: jsonHeaders(userId), body: JSON.stringify({ outcome: "completed" }) }), env, {});
  assert.equal(completed.status, 200);
  assert.equal((await getEvent(env, userId, first.id)).outcome, "completed");
  const taskAfterCompletion = (await listTasks(env, userId)).find((task) => task.id === first.taskId);
  assert.ok(taskAfterCompletion.remainingMinutes < taskAfterCompletion.estimatedMinutes);

  events = await listEvents(env, userId, horizonStart, horizonEnd);
  const missedTarget = events.find((event) => event.category === "study" && event.outcome === "planned");
  const missed = await worker.fetch(new Request(`https://arcadia.test/api/events/${missedTarget.id}/outcome`, { method: "POST", headers: jsonHeaders(userId), body: JSON.stringify({ outcome: "missed" }) }), env, {});
  assert.equal(missed.status, 200);
  const missedPayload = await missed.json();
  assert.match(missedPayload.message, /missed|moved|safe opening/i);
  assert.equal((await getEvent(env, userId, missedTarget.id)).outcome, "missed");
  const replanned = await listEvents(env, userId, new Date().toISOString(), horizonEnd);
  assert.ok(replanned.some((event) => event.taskId === missedTarget.taskId && event.id !== missedTarget.id && event.outcome === "planned"));
  assertNoOverlaps(replanned);

  const mentor = await worker.fetch(new Request("https://arcadia.test/api/chat", {
    method: "POST", headers: jsonHeaders(userId),
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
    method: "POST", headers: jsonHeaders(userId), body: JSON.stringify({ message: "Training has been moved to 6 PM." })
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
