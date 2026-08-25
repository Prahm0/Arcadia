import { schemaStatements } from "../db/schema.ts";

const schemaPromises = new WeakMap();

export function requireUser(request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!userId || !email) return null;

  let fullName = null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  if (encodedName && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { fullName = decodeURIComponent(encodedName); } catch { fullName = null; }
  }
  return { id: userId, email, name: fullName || email.split("@")[0] };
}

export async function ensureDatabase(env) {
  if (!env.DB) throw new Error("Arcadia database is not configured.");
  let schemaPromise = schemaPromises.get(env.DB);
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const sql of schemaStatements) await env.DB.prepare(sql).run();
    })().catch((error) => { schemaPromises.delete(env.DB); throw error; });
    schemaPromises.set(env.DB, schemaPromise);
  }
  await schemaPromise;
}

export async function upsertProfile(env, user) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO profiles (user_id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at
  `).bind(user.id, user.email, user.name, now, now).run();
}

export async function listEvents(env, userId, start, end) {
  const result = await env.DB.prepare(`
    SELECT id, source, external_id AS externalId, calendar_id AS calendarId, title, description, kind,
      subject, location, start_at AS startAt, end_at AS endAt, all_day AS allDay, status, editable,
      recurrence, sync_status AS syncStatus
    FROM events
    WHERE user_id = ? AND start_at < ? AND end_at > ? AND status != 'cancelled'
    ORDER BY start_at ASC
  `).bind(userId, end, start).all();
  return (result.results || []).map(normalizeEvent);
}

export async function getEvent(env, userId, id) {
  const row = await env.DB.prepare(`
    SELECT id, source, external_id AS externalId, calendar_id AS calendarId, title, description, kind,
      subject, location, start_at AS startAt, end_at AS endAt, all_day AS allDay, status, editable,
      recurrence, sync_status AS syncStatus
    FROM events WHERE id = ? AND user_id = ?
  `).bind(id, userId).first();
  return row ? normalizeEvent(row) : null;
}

export async function createEvent(env, userId, input) {
  const now = new Date().toISOString();
  const event = {
    id: crypto.randomUUID(), userId, source: "arcadia", externalId: null, calendarId: null,
    title: input.title, description: input.description || "", kind: input.kind || "general",
    subject: input.subject || null, location: input.location || null, startAt: input.startAt,
    endAt: input.endAt, allDay: Boolean(input.allDay), status: "planned", editable: true,
    recurrence: input.recurrence || null, syncStatus: "local"
  };
  await env.DB.prepare(`
    INSERT INTO events (id, user_id, source, title, description, kind, subject, location, start_at, end_at,
      all_day, status, editable, recurrence, sync_status, created_at, updated_at)
    VALUES (?, ?, 'arcadia', ?, ?, ?, ?, ?, ?, ?, ?, 'planned', 1, ?, 'local', ?, ?)
  `).bind(event.id, userId, event.title, event.description, event.kind, event.subject, event.location,
    event.startAt, event.endAt, event.allDay ? 1 : 0, event.recurrence, now, now).run();
  return event;
}

export async function updateEvent(env, userId, id, input) {
  const existing = await getEvent(env, userId, id);
  if (!existing || !existing.editable || existing.source !== "arcadia") return null;
  const next = { ...existing, ...input, id, source: "arcadia", editable: true };
  await env.DB.prepare(`
    UPDATE events SET title = ?, description = ?, kind = ?, subject = ?, location = ?, start_at = ?, end_at = ?,
      all_day = ?, recurrence = ?, sync_status = CASE WHEN external_id IS NULL THEN 'local' ELSE 'pending' END, updated_at = ?
    WHERE id = ? AND user_id = ? AND source = 'arcadia' AND editable = 1
  `).bind(next.title, next.description || "", next.kind, next.subject || null, next.location || null,
    next.startAt, next.endAt, next.allDay ? 1 : 0, next.recurrence || null, new Date().toISOString(), id, userId).run();
  return getEvent(env, userId, id);
}

export async function deleteEvent(env, userId, id) {
  const existing = await getEvent(env, userId, id);
  if (!existing || !existing.editable || existing.source !== "arcadia") return null;
  await env.DB.prepare("DELETE FROM events WHERE id = ? AND user_id = ? AND source = 'arcadia' AND editable = 1")
    .bind(id, userId).run();
  return existing;
}

export async function completeEvent(env, userId, id) {
  const event = await getEvent(env, userId, id);
  if (!event || event.source !== "arcadia") return null;
  const completed = event.status !== "completed";
  const now = new Date().toISOString();
  const statements = [env.DB.prepare("UPDATE events SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(completed ? "completed" : "planned", now, id, userId)];
  if (completed && event.kind === "study") {
    const duration = Math.max(0, Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000));
    statements.push(env.DB.prepare(`
      INSERT INTO study_sessions (id, user_id, event_id, subject, started_at, ended_at, duration_minutes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, id, event.subject, event.startAt, event.endAt, duration, now));
  } else if (!completed) {
    statements.push(env.DB.prepare("DELETE FROM study_sessions WHERE event_id = ? AND user_id = ?").bind(id, userId));
  }
  await env.DB.batch(statements);
  return getEvent(env, userId, id);
}

export async function getAnalytics(env, userId, start, end) {
  const rows = await listEvents(env, userId, start, end);
  const arcadia = rows.filter((event) => event.source === "arcadia");
  const completed = arcadia.filter((event) => event.status === "completed");
  const study = arcadia.filter((event) => event.kind === "study");
  const completedStudy = completed.filter((event) => event.kind === "study");
  const focusedMinutes = completedStudy.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const plannedMinutes = study.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const totalMinutes = arcadia.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const subjects = new Map();
  for (const event of study) {
    const subject = event.subject || "General";
    subjects.set(subject, (subjects.get(subject) || 0) + minutesBetween(event.startAt, event.endAt));
  }
  const subjectDistribution = [...subjects.entries()].map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  return {
    focusedMinutes,
    plannedMinutes,
    completionRate: arcadia.length ? Math.round((completed.length / arcadia.length) * 100) : 0,
    completedCount: completed.length,
    plannedCount: arcadia.length,
    capacityMinutes: Math.max(0, 20 * 60 - totalMinutes),
    subjectDistribution
  };
}

export async function listMessages(env, userId, limit = 20) {
  const result = await env.DB.prepare(`
    SELECT id, role, content, created_at AS createdAt FROM chat_messages
    WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, Math.min(50, Math.max(1, limit))).all();
  return (result.results || []).reverse();
}

export async function saveMessage(env, userId, role, content) {
  const message = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
  await env.DB.prepare("INSERT INTO chat_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(message.id, userId, role, content, message.createdAt).run();
  return message;
}

export async function listPendingProposals(env, userId) {
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE proposals SET status = 'expired' WHERE user_id = ? AND status = 'pending' AND expires_at < ?")
    .bind(userId, now).run();
  const result = await env.DB.prepare(`
    SELECT id, status, summary, operations_json AS operationsJson, created_at AS createdAt, expires_at AS expiresAt
    FROM proposals WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 5
  `).bind(userId).all();
  return (result.results || []).map(normalizeProposal);
}

export async function createProposal(env, userId, summary, operations) {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const proposal = { id: crypto.randomUUID(), status: "pending", summary, operations, createdAt, expiresAt };
  await env.DB.prepare(`
    INSERT INTO proposals (id, user_id, status, summary, operations_json, created_at, expires_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)
  `).bind(proposal.id, userId, summary, JSON.stringify(operations), createdAt, expiresAt).run();
  return proposal;
}

export async function setProposalStatus(env, userId, id, status) {
  const result = await env.DB.prepare(`
    UPDATE proposals SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END
    WHERE id = ? AND user_id = ? AND status = 'pending' AND expires_at >= ?
  `).bind(status, status, new Date().toISOString(), id, userId, new Date().toISOString()).run();
  return Number(result.meta?.changes || 0) > 0;
}

export async function getProposal(env, userId, id) {
  const row = await env.DB.prepare(`
    SELECT id, status, summary, operations_json AS operationsJson, created_at AS createdAt, expires_at AS expiresAt
    FROM proposals WHERE id = ? AND user_id = ?
  `).bind(id, userId).first();
  return row ? normalizeProposal(row) : null;
}

export function weekRange(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid date range.");
  const day = (date.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day));
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

function normalizeEvent(row) {
  return { ...row, allDay: Boolean(row.allDay), editable: Boolean(row.editable) };
}
function normalizeProposal(row) {
  let operations = [];
  try { operations = JSON.parse(row.operationsJson || "[]"); } catch { operations = []; }
  const { operationsJson, ...proposal } = row;
  return { ...proposal, operations };
}
function minutesBetween(start, end) {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}
