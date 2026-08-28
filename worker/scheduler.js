import { getPlannerData, listEvents } from "./db.js";

const DAY_MS = 86_400_000;
const SLOT_MINUTES = 15;

export async function rebuildSchedule(env, userId, { from = new Date(), horizonDays = 21 } = {}) {
  const planner = await getPlannerData(env, userId);
  if (!planner.profile?.onboardingComplete) return { created: [], unscheduled: [], planner };

  const timezone = safeTimezone(planner.profile.timezone);
  const now = new Date(from);
  const startKey = dateKeyInZone(now, timezone);
  const endKey = addDaysKey(startKey, Math.min(42, Math.max(7, horizonDays)));
  const rangeStart = zonedDateTime(startKey, "00:00", timezone).toISOString();
  const rangeEnd = zonedDateTime(addDaysKey(endKey, 1), "00:00", timezone).toISOString();

  await env.DB.prepare(`
    DELETE FROM events WHERE user_id = ? AND source = 'arcadia' AND event_category = 'study'
      AND task_id IS NOT NULL AND outcome = 'planned' AND pinned = 0 AND start_at >= ?
  `).bind(userId, now.toISOString()).run();
  await materializeCommitments(env, userId, planner.commitments, timezone, startKey, endKey);

  const busy = await listEvents(env, userId, rangeStart, rangeEnd);
  const occupied = busy.map((event) => ({
    start: Date.parse(event.startAt), end: Date.parse(event.endAt), category: event.category,
    taskId: event.taskId || null
  })).filter((block) => Number.isFinite(block.start) && Number.isFinite(block.end));
  const dailyStudy = new Map();
  const pinnedByTask = new Map();
  for (const event of busy.filter((item) => item.category === "study" && item.outcome !== "missed")) {
    const key = dateKeyInZone(event.startAt, timezone);
    const duration = minutesBetween(event.startAt, event.endAt);
    dailyStudy.set(key, (dailyStudy.get(key) || 0) + duration);
    if (event.pinned && event.taskId && event.outcome === "planned") pinnedByTask.set(event.taskId, (pinnedByTask.get(event.taskId) || 0) + duration);
  }

  const tasks = planner.tasks.filter((task) => task.status === "pending" && task.remainingMinutes > 0)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || b.priority - a.priority || b.remainingMinutes - a.remainingMinutes);
  const created = [];
  const unscheduled = [];
  const statements = [];
  const preferences = planner.preferences;
  const preferredSession = clamp(Number(preferences.preferredSessionMinutes) || 60, 30, 75);
  const breakMinutes = clamp(Number(preferences.breakMinutes) || 15, 5, 45);
  const maxDaily = clamp(Number(preferences.maxDailyStudyMinutes) || 180, 60, 360);

  for (const task of tasks) {
    let remaining = Math.max(0, Number(task.remainingMinutes) - (pinnedByTask.get(task.id) || 0));
    let sequence = 1;
    while (remaining > 0) {
      const requested = sessionLength(remaining, preferredSession);
      let slot = findBestSlot({
        task, duration: requested, now, timezone, startKey, endKey, occupied, dailyStudy,
        preferences, maxDaily, breakMinutes, commitments: busy
      });
      let duration = requested;
      if (!slot && requested > 30) {
        duration = Math.min(remaining, 30);
        slot = findBestSlot({
          task, duration, now, timezone, startKey, endKey, occupied, dailyStudy,
          preferences, maxDaily, breakMinutes, commitments: busy
        });
      }
      if (!slot) break;

      const id = crypto.randomUUID();
      const startAt = new Date(slot.start).toISOString();
      const endAt = new Date(slot.end).toISOString();
      const title = task.title;
      const nowIso = new Date().toISOString();
      created.push({
        id, title, subject: task.subject, taskId: task.id, category: "study", kind: "study",
        startAt, endAt, status: "planned", outcome: "planned", source: "arcadia", editable: true, pinned: false,
        sequence
      });
      statements.push(env.DB.prepare(`
        INSERT INTO events (id, user_id, source, title, description, kind, subject, start_at, end_at,
          all_day, status, editable, sync_status, task_id, event_category, outcome, created_at, updated_at)
        VALUES (?, ?, 'arcadia', ?, ?, 'study', ?, ?, ?, 0, 'planned', 1, 'local', ?, 'study', 'planned', ?, ?)
      `).bind(id, userId, title, `Session ${sequence} · ${duration} minutes planned before ${task.dueAt}`,
        task.subject || null, startAt, endAt, task.id, nowIso, nowIso));
      occupied.push({ start: slot.start, end: slot.end, category: "study", taskId: task.id });
      dailyStudy.set(slot.dateKey, (dailyStudy.get(slot.dateKey) || 0) + duration);
      remaining -= duration;
      sequence += 1;
    }
    if (remaining > 0) unscheduled.push({ taskId: task.id, title: task.title, minutes: remaining, dueAt: task.dueAt });
  }

  if (statements.length) await env.DB.batch(statements);
  const generatedEvents = created.length
    ? await listEvents(env, userId, rangeStart, rangeEnd)
    : busy;
  return { created, events: generatedEvents, unscheduled, planner, range: { start: rangeStart, end: rangeEnd } };
}

export async function materializeCommitments(env, userId, commitments, timezone, startKey, endKey) {
  const statements = [];
  const now = new Date().toISOString();
  for (const commitment of commitments.filter((item) => item.active)) {
    for (let key = startKey; key <= endKey; key = addDaysKey(key, 1)) {
      const weekday = weekdayForKey(key);
      const occurs = commitment.recurrence === "weekdays"
        ? weekday >= 1 && weekday <= 5
        : commitment.recurrence === "weekly"
          ? weekday === Number(commitment.weekday)
          : commitment.startDate === key;
      if (!occurs) continue;
      const start = zonedDateTime(key, commitment.startTime, timezone);
      let end = zonedDateTime(key, commitment.endTime, timezone);
      if (end <= start) end = new Date(end.getTime() + DAY_MS);
      const kind = commitment.category === "sport" ? "training" : "general";
      const id = crypto.randomUUID();
      statements.push(env.DB.prepare(`
        INSERT INTO events (id, user_id, source, title, description, kind, subject, start_at, end_at, all_day,
          status, editable, recurrence, sync_status, commitment_id, event_category, outcome, occurrence_key,
          created_at, updated_at)
        VALUES (?, ?, 'arcadia', ?, ?, ?, ?, ?, ?, 0, 'planned', 0, ?, 'local', ?, ?, 'planned', ?, ?, ?)
        ON CONFLICT(user_id, commitment_id, occurrence_key) WHERE commitment_id IS NOT NULL DO UPDATE SET title = excluded.title,
          description = excluded.description, kind = excluded.kind, subject = excluded.subject,
          start_at = excluded.start_at, end_at = excluded.end_at, event_category = excluded.event_category,
          status = 'planned', outcome = 'planned', updated_at = excluded.updated_at
      `).bind(id, userId, commitment.title, commitment.notes || "", kind, commitment.subject || null,
        start.toISOString(), end.toISOString(), commitment.recurrence, commitment.id,
        commitment.category, key, now, now));
    }
  }
  if (statements.length) await env.DB.batch(statements);
}

export function buildBriefing({ profile, tasks, events, preferences, now = new Date() }) {
  const timezone = safeTimezone(profile?.timezone);
  const todayKey = dateKeyInZone(now, timezone);
  const today = events.filter((event) => dateKeyInZone(event.startAt, timezone) === todayKey && event.status !== "cancelled")
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const study = today.filter((event) => event.category === "study" && event.outcome === "planned");
  const fixed = today.filter((event) => ["school", "sport", "extracurricular", "other"].includes(event.category));
  const focus = tasks.filter((task) => task.status === "pending").sort((a, b) => {
    const deadline = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    return deadline || b.priority - a.priority || b.remainingMinutes - a.remainingMinutes;
  }).slice(0, 2);

  if (!study.length) {
    if (!focus.length) return "";
    return `You have no study block scheduled today. ${focus[0].title} is the next deadline, with ${formatMinutes(focus[0].remainingMinutes)} still to place before ${formatDue(focus[0].dueAt, timezone)}.`;
  }
  const pressure = fixed.find((event) => ["sport", "extracurricular"].includes(event.category));
  if (pressure) {
    const before = study.find((event) => Date.parse(event.endAt) <= Date.parse(pressure.startAt));
    const after = study.find((event) => Date.parse(event.startAt) >= Date.parse(pressure.endAt));
    if (before) return `${pressure.title} narrows your afternoon at ${formatClock(pressure.startAt, timezone)}. Finish ${before.title} beforehand${after ? ` and leave ${after.title} for afterwards` : ""}; your ${preferences.bedtime} bedtime remains protected.`;
  }
  const first = study[0];
  const second = study[1];
  return `Start with ${first.title} at ${formatClock(first.startAt, timezone)}${second ? `, then move to ${second.title}` : ""}. This order follows the nearest deadlines and keeps work inside your ${preferences.wakeTime}–${preferences.bedtime} day.`;
}

export function focusTasks(tasks, limit = 2) {
  return tasks.filter((task) => task.status === "pending").sort((a, b) => {
    const due = Date.parse(a.dueAt) - Date.parse(b.dueAt);
    return due || b.priority - a.priority || b.remainingMinutes - a.remainingMinutes;
  }).slice(0, limit);
}

export function parseDuePhrase(phrase, { now = new Date(), timezone = "Australia/Sydney" } = {}) {
  const clean = String(phrase || "").trim().toLowerCase();
  const todayKey = dateKeyInZone(now, timezone);
  let key = todayKey;
  if (clean === "tomorrow") key = addDaysKey(todayKey, 1);
  else if (clean !== "today") {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = names.findIndex((name) => clean.startsWith(name));
    if (target >= 0) {
      let delta = (target - weekdayForKey(todayKey) + 7) % 7;
      if (delta === 0) delta = 7;
      key = addDaysKey(todayKey, delta);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) key = clean;
    else return null;
  }
  return zonedDateTime(key, "23:59", timezone).toISOString();
}

export function dateKeyInZone(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function zonedDateTime(dateKey, time, timezone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - represented;
  }
  return new Date(guess);
}

function findBestSlot({ task, duration, now, timezone, startKey, endKey, occupied, dailyStudy, preferences, maxDaily, breakMinutes, commitments }) {
  const deadline = Date.parse(task.dueAt);
  const candidates = [];
  for (let key = startKey, dayIndex = 0; key <= endKey; key = addDaysKey(key, 1), dayIndex += 1) {
    const dayStart = zonedDateTime(key, "00:00", timezone).getTime();
    if (dayStart > deadline) break;
    const weekday = weekdayForKey(key);
    const dayFixed = commitments.filter((event) => dateKeyInZone(event.startAt, timezone) === key && event.category !== "study");
    const schoolEnd = dayFixed.filter((event) => event.category === "school")
      .reduce((latest, event) => Math.max(latest, Date.parse(event.endAt)), 0);
    const wakeMinutes = timeMinutes(preferences.wakeTime || "06:30");
    const bedMinutes = timeMinutes(preferences.bedtime || "22:30");
    let earliestMinutes = weekday >= 1 && weekday <= 5 ? (schoolEnd ? minutesInZone(schoolEnd, timezone) + 30 : 9 * 60) : 9 * 60 + 30;
    earliestMinutes = Math.max(wakeMinutes + 45, earliestMinutes);
    const latestMinutes = Math.max(earliestMinutes, bedMinutes - 30);
    if ((dailyStudy.get(key) || 0) + duration > maxDaily) continue;

    let cursor = zonedDateTime(key, minutesTime(roundUp(earliestMinutes, SLOT_MINUTES)), timezone).getTime();
    const latest = zonedDateTime(key, minutesTime(latestMinutes), timezone).getTime();
    const minimumStart = now.getTime() + 10 * 60 * 1000;
    if (key === dateKeyInZone(now, timezone)) cursor = Math.max(cursor, roundTimestamp(minimumStart, SLOT_MINUTES));
    for (; cursor + duration * 60000 <= latest && cursor + duration * 60000 <= deadline; cursor += SLOT_MINUTES * 60000) {
      const end = cursor + duration * 60000;
      if (occupied.some((block) => overlaps(cursor, end, block, block.category === "study" ? breakMinutes : 0))) continue;
      const sameTaskToday = occupied.filter((block) => block.category === "study" && block.taskId === task.id && dateKeyInZone(block.start, timezone) === key).length;
      const clock = minutesInZone(cursor, timezone);
      const latePenalty = clock >= 20 * 60 ? 180 : clock >= 18 * 60 ? 30 : 0;
      const score = (dailyStudy.get(key) || 0) * 2 + sameTaskToday * 100 + dayIndex * 4 + latePenalty + Math.max(0, clock - 16 * 60) / 30;
      candidates.push({ start: cursor, end, dateKey: key, score });
    }
  }
  return candidates.sort((a, b) => a.score - b.score || a.start - b.start)[0] || null;
}

function sessionLength(remaining, preferred) {
  if (remaining <= preferred) return remaining;
  const sessions = Math.ceil(remaining / preferred);
  return Math.min(75, Math.max(30, Math.ceil(remaining / sessions / 5) * 5));
}
function overlaps(start, end, block, paddingMinutes) {
  const padding = paddingMinutes * 60000;
  return start < block.end + padding && end > block.start - padding;
}
function weekdayForKey(key) { return new Date(`${key}T12:00:00.000Z`).getUTCDay(); }
function addDaysKey(key, days) {
  const value = new Date(`${key}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function timeMinutes(value) { const [hours, minutes] = String(value).split(":").map(Number); return hours * 60 + minutes; }
function minutesTime(value) { const safe = Math.max(0, Math.min(23 * 60 + 59, value)); return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`; }
function minutesInZone(value, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function roundUp(value, step) { return Math.ceil(value / step) * step; }
function roundTimestamp(value, stepMinutes) { const step = stepMinutes * 60000; return Math.ceil(value / step) * step; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function minutesBetween(start, end) { return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000)); }
function safeTimezone(value) { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value || "Australia/Sydney"; } catch { return "Australia/Sydney"; } }
function formatMinutes(minutes) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minutes` : ""}` : `${rest} minutes`; }
function formatClock(value, timezone) { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatDue(value, timezone) { return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "long", day: "numeric", month: "short" }).format(new Date(value)); }
