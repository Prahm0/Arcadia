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
      const isIndex = (sql) => /^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(sql.trim());
      for (const sql of schemaStatements.filter((statement) => !isIndex(statement))) await env.DB.prepare(sql).run();
      await ensureColumn(env, "user_preferences", "theme", "TEXT NOT NULL DEFAULT 'light' CHECK (length(theme) BETWEEN 1 AND 32)");
      await ensureThemeConstraint(env);
      await ensureColumn(env, "study_sessions", "client_id", "TEXT");
      await ensureColumn(env, "study_sessions", "mode", "TEXT NOT NULL DEFAULT 'focus' CHECK (mode IN ('focus', 'stopwatch', 'rest'))");
      await ensureColumn(env, "study_sessions", "goal", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(env, "study_sessions", "duration_seconds", "INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0)");
      await ensureColumn(env, "study_sessions", "distractions", "INTEGER NOT NULL DEFAULT 0 CHECK (distractions >= 0)");
      await ensureColumn(env, "auth_rate_limits", "identity_hash", "TEXT NOT NULL DEFAULT ''");
      await ensureColumn(env, "events", "pinned", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn(env, "chat_messages", "conversation_id", "TEXT");
      for (const sql of schemaStatements.filter(isIndex)) await env.DB.prepare(sql).run();
    })().catch((error) => { schemaPromises.delete(env.DB); throw error; });
    schemaPromises.set(env.DB, schemaPromise);
  }
  await schemaPromise;
}

async function ensureColumn(env, table, column, definition) {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  if (!(info.results || []).some((item) => item.name === column)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function ensureThemeConstraint(env) {
  const row = await env.DB.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'user_preferences'").first();
  if (!row?.sql || /length\s*\(\s*theme\s*\)/i.test(row.sql)) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_preferences_next (
    user_id TEXT PRIMARY KEY,
    bedtime TEXT NOT NULL DEFAULT '22:30',
    wake_time TEXT NOT NULL DEFAULT '06:30',
    minimum_sleep_minutes INTEGER NOT NULL DEFAULT 480 CHECK (minimum_sleep_minutes BETWEEN 360 AND 720),
    max_daily_study_minutes INTEGER NOT NULL DEFAULT 180 CHECK (max_daily_study_minutes BETWEEN 60 AND 480),
    preferred_session_minutes INTEGER NOT NULL DEFAULT 60 CHECK (preferred_session_minutes BETWEEN 25 AND 120),
    break_minutes INTEGER NOT NULL DEFAULT 15 CHECK (break_minutes BETWEEN 5 AND 60),
    theme TEXT NOT NULL DEFAULT 'light' CHECK (length(theme) BETWEEN 1 AND 32),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
  )`).run();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_preferences_next (
      user_id, bedtime, wake_time, minimum_sleep_minutes, max_daily_study_minutes,
      preferred_session_minutes, break_minutes, theme, updated_at
    ) SELECT user_id, bedtime, wake_time, minimum_sleep_minutes, max_daily_study_minutes,
      preferred_session_minutes, break_minutes, theme, updated_at FROM user_preferences`),
    env.DB.prepare("DROP TABLE user_preferences"),
    env.DB.prepare("ALTER TABLE user_preferences_next RENAME TO user_preferences")
  ]);
}

export async function upsertProfile(env, user) {
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO profiles (user_id, email, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email,
      display_name = COALESCE(profiles.display_name, excluded.display_name), updated_at = excluded.updated_at
  `).bind(user.id, user.email, user.name, now, now).run();
  await env.DB.prepare(`
    INSERT INTO user_preferences (user_id, updated_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(user.id, now).run();
}

export async function getProfile(env, userId) {
  const row = await env.DB.prepare(`
    SELECT user_id AS userId, email, display_name AS displayName, grade, timezone,
      onboarding_complete AS onboardingComplete, created_at AS createdAt, updated_at AS updatedAt
    FROM profiles WHERE user_id = ?
  `).bind(userId).first();
  return row ? { ...row, onboardingComplete: Boolean(row.onboardingComplete) } : null;
}

export async function getPreferences(env, userId) {
  const row = await env.DB.prepare(`
    SELECT bedtime, wake_time AS wakeTime, minimum_sleep_minutes AS minimumSleepMinutes,
      max_daily_study_minutes AS maxDailyStudyMinutes, preferred_session_minutes AS preferredSessionMinutes,
      break_minutes AS breakMinutes, theme, updated_at AS updatedAt
    FROM user_preferences WHERE user_id = ?
  `).bind(userId).first();
  return row || {
    bedtime: "22:30", wakeTime: "06:30", minimumSleepMinutes: 480,
    maxDailyStudyMinutes: 180, preferredSessionMinutes: 60, breakMinutes: 15, theme: "light"
  };
}

export async function listStudySessions(env, userId, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT id, client_id AS clientId, mode AS type, subject, goal,
      CASE WHEN duration_seconds > 0 THEN duration_seconds ELSE duration_minutes * 60 END AS seconds,
      distractions, started_at AS startedAt, ended_at AS endedAt
    FROM study_sessions WHERE user_id = ? AND event_id IS NULL
    ORDER BY ended_at DESC LIMIT ?
  `).bind(userId, Math.min(100, Math.max(1, Number(limit) || 50))).all();
  return result.results || [];
}

export async function getCompanion(env, userId, { currentStreak = 0 } = {}) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR IGNORE INTO companion_profiles (user_id, updated_at) VALUES (?, ?)`)
    .bind(userId, now).run();
  const [profile, totals, latest] = await Promise.all([
    env.DB.prepare(`SELECT name, form, palette, accessory, updated_at AS updatedAt FROM companion_profiles WHERE user_id = ?`).bind(userId).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(duration_minutes), 0) AS focusedMinutes FROM study_sessions WHERE user_id = ? AND mode != 'rest'`).bind(userId).first(),
    env.DB.prepare(`SELECT outcome FROM activity WHERE user_id = ? ORDER BY occurred_at DESC, created_at DESC LIMIT 1`).bind(userId).first()
  ]);
  const focusedMinutes = Math.max(0, Number(totals?.focusedMinutes || 0));
  const level = focusedMinutes >= 1800 ? 4 : focusedMinutes >= 900 ? 3 : focusedMinutes >= 300 ? 2 : 1;
  return { profile, focusedMinutes, level, currentStreak: Math.max(0, Number(currentStreak || 0)), state: latest?.outcome === 'missed' ? 'recovering' : 'ready' };
}

export async function updateCompanion(env, userId, input) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO companion_profiles (user_id, name, form, palette, accessory, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, form = excluded.form, palette = excluded.palette,
      accessory = excluded.accessory, updated_at = excluded.updated_at`)
    .bind(userId, input.name, input.form, input.palette, input.accessory, now).run();
  return env.DB.prepare(`SELECT name, form, palette, accessory, updated_at AS updatedAt FROM companion_profiles WHERE user_id = ?`).bind(userId).first();
}

export async function saveStudySessions(env, userId, entries) {
  const now = new Date().toISOString();
  const statements = entries.map((entry) => {
    const seconds = Math.max(1, Math.min(24 * 60 * 60, Math.round(Number(entry.seconds) || 0)));
    const ended = new Date(entry.endedAt); const endedAt = Number.isNaN(ended.valueOf()) ? now : ended.toISOString();
    const startedAt = new Date(Date.parse(endedAt) - seconds * 1000).toISOString();
    const clientId = String(entry.id || crypto.randomUUID()).slice(0, 120);
    const mode = ["focus", "stopwatch", "rest"].includes(entry.type) ? entry.type : "focus";
    return env.DB.prepare(`INSERT OR IGNORE INTO study_sessions
      (id, user_id, event_id, client_id, subject, mode, goal, duration_seconds, distractions, started_at, ended_at, duration_minutes, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, clientId, String(entry.subject || "General").trim().slice(0, 80) || "General", mode,
        String(entry.goal || "").trim().slice(0, 120), seconds, Math.max(0, Math.min(999, Math.round(Number(entry.distractions) || 0))),
        startedAt, endedAt, Math.max(1, Math.round(seconds / 60)), now);
  });
  if (statements.length) await env.DB.batch(statements);
  return listStudySessions(env, userId);
}

export async function clearStudySessions(env, userId) {
  await env.DB.prepare("DELETE FROM study_sessions WHERE user_id = ? AND event_id IS NULL").bind(userId).run();
}

export async function listSubjects(env, userId) {
  const result = await env.DB.prepare(`
    SELECT id, name, color, icon, priority, created_at AS createdAt, updated_at AS updatedAt
    FROM subjects WHERE user_id = ? ORDER BY name COLLATE NOCASE
  `).bind(userId).all();
  return result.results || [];
}

export async function listTasks(env, userId, { includeArchived = false } = {}) {
  const result = await env.DB.prepare(`
    SELECT t.id, t.subject_id AS subjectId, s.name AS subject, s.color AS subjectColor, t.title,
      t.task_type AS taskType, t.due_at AS dueAt, t.estimated_minutes AS estimatedMinutes,
      t.remaining_minutes AS remainingMinutes, t.priority, t.status, t.notes,
      t.completed_at AS completedAt, t.created_at AS createdAt, t.updated_at AS updatedAt
    FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.user_id = ? AND (? = 1 OR t.status != 'archived')
    ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.due_at, t.priority DESC
  `).bind(userId, includeArchived ? 1 : 0).all();
  return result.results || [];
}

export async function getTask(env, userId, id) {
  const row = await env.DB.prepare(`
    SELECT t.id, t.subject_id AS subjectId, s.name AS subject, s.color AS subjectColor, t.title,
      t.task_type AS taskType, t.due_at AS dueAt, t.estimated_minutes AS estimatedMinutes,
      t.remaining_minutes AS remainingMinutes, t.priority, t.status, t.notes,
      t.completed_at AS completedAt, t.created_at AS createdAt, t.updated_at AS updatedAt
    FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE t.user_id = ? AND t.id = ?
  `).bind(userId, id).first();
  return row || null;
}

export async function listCommitments(env, userId) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.subject_id AS subjectId, s.name AS subject, c.title, c.category,
      c.start_date AS startDate, c.weekday, c.start_time AS startTime, c.end_time AS endTime,
      c.recurrence, c.active, c.notes, c.created_at AS createdAt, c.updated_at AS updatedAt
    FROM commitments c LEFT JOIN subjects s ON s.id = c.subject_id
    WHERE c.user_id = ? AND c.active = 1
    ORDER BY COALESCE(c.weekday, 8), c.start_time, c.title
  `).bind(userId).all();
  return (result.results || []).map((row) => ({ ...row, active: Boolean(row.active) }));
}

export async function createCommitment(env, userId, input) {
  const now = new Date().toISOString();
  const commitment = {
    id: crypto.randomUUID(), title: input.title, category: input.category || "other",
    startDate: input.startDate || null, weekday: input.weekday ?? null,
    startTime: input.startTime, endTime: input.endTime, recurrence: input.recurrence || "none",
    notes: input.notes || ""
  };
  await env.DB.prepare(`
    INSERT INTO commitments (id, user_id, title, category, start_date, weekday, start_time, end_time,
      recurrence, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).bind(commitment.id, userId, commitment.title, commitment.category, commitment.startDate,
    commitment.weekday, commitment.startTime, commitment.endTime, commitment.recurrence,
    commitment.notes, now, now).run();
  return commitment;
}

export async function updateCommitmentTime(env, userId, id, startTime, endTime) {
  const result = await env.DB.prepare(`
    UPDATE commitments SET start_time = ?, end_time = ?, updated_at = ?
    WHERE id = ? AND user_id = ? AND active = 1
  `).bind(startTime, endTime, new Date().toISOString(), id, userId).run();
  return Number(result.meta?.changes || 0) > 0;
}

export async function listActivity(env, userId, { start = "1970-01-01T00:00:00.000Z", end = "9999-12-31T23:59:59.999Z", limit = 100 } = {}) {
  const result = await env.DB.prepare(`
    SELECT a.id, a.event_id AS eventId, a.task_id AS taskId, a.outcome, a.duration_minutes AS durationMinutes,
      a.occurred_at AS occurredAt, a.detail, a.created_at AS createdAt, t.title AS taskTitle, s.name AS subject
    FROM activity a LEFT JOIN tasks t ON t.id = a.task_id LEFT JOIN subjects s ON s.id = t.subject_id
    WHERE a.user_id = ? AND a.occurred_at >= ? AND a.occurred_at < ?
    ORDER BY a.occurred_at DESC LIMIT ?
  `).bind(userId, start, end, Math.min(250, Math.max(1, limit))).all();
  return result.results || [];
}

export async function saveOnboarding(env, userId, input) {
  const now = new Date().toISOString();
  const currentSubjects = await listSubjects(env, userId);
  const subjectIds = new Map(currentSubjects.map((subject) => [subject.name.trim().toLowerCase(), subject.id]));
  const statements = [
    env.DB.prepare(`UPDATE profiles SET display_name = ?, grade = ?, timezone = ?, onboarding_complete = 1, updated_at = ? WHERE user_id = ?`)
      .bind(input.name, input.grade, input.timezone, now, userId),
    env.DB.prepare(`
      INSERT INTO user_preferences (user_id, bedtime, wake_time, minimum_sleep_minutes, max_daily_study_minutes,
        preferred_session_minutes, break_minutes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET bedtime = excluded.bedtime, wake_time = excluded.wake_time,
        minimum_sleep_minutes = excluded.minimum_sleep_minutes, max_daily_study_minutes = excluded.max_daily_study_minutes,
        preferred_session_minutes = excluded.preferred_session_minutes, break_minutes = excluded.break_minutes,
        updated_at = excluded.updated_at
    `).bind(userId, input.preferences.bedtime, input.preferences.wakeTime, input.preferences.minimumSleepMinutes,
      input.preferences.maxDailyStudyMinutes, input.preferences.preferredSessionMinutes, input.preferences.breakMinutes, now),
    env.DB.prepare("DELETE FROM events WHERE user_id = ? AND source = 'arcadia' AND outcome = 'planned'").bind(userId),
    env.DB.prepare("DELETE FROM tasks WHERE user_id = ? AND status = 'pending'").bind(userId),
    env.DB.prepare("DELETE FROM commitments WHERE user_id = ? AND active = 1").bind(userId)
  ];

  for (const subject of input.subjects) {
    const key = subject.name.toLowerCase();
    const id = subjectIds.get(key) || crypto.randomUUID();
    subjectIds.set(key, id);
    statements.push(env.DB.prepare(`
      INSERT INTO subjects (id, user_id, name, color, icon, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, name COLLATE NOCASE) DO UPDATE SET color = excluded.color, icon = excluded.icon,
        priority = excluded.priority, updated_at = excluded.updated_at
    `).bind(id, userId, subject.name, subject.color, subject.icon, subject.priority, now, now));
  }
  for (const task of input.tasks) {
    const subjectId = subjectIds.get(String(task.subject || "").toLowerCase()) || null;
    statements.push(env.DB.prepare(`
      INSERT INTO tasks (id, user_id, subject_id, title, task_type, due_at, estimated_minutes,
        remaining_minutes, priority, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, subjectId, task.title, task.taskType, task.dueAt,
      task.estimatedMinutes, task.estimatedMinutes, task.priority, task.notes, now, now));
  }
  for (const commitment of input.commitments) {
    const subjectId = subjectIds.get(String(commitment.subject || "").toLowerCase()) || null;
    statements.push(env.DB.prepare(`
      INSERT INTO commitments (id, user_id, subject_id, title, category, start_date, weekday,
        start_time, end_time, recurrence, active, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, subjectId, commitment.title, commitment.category,
      commitment.startDate, commitment.weekday, commitment.startTime, commitment.endTime,
      commitment.recurrence, commitment.notes, now, now));
  }
  await env.DB.batch(statements);
  return getPlannerData(env, userId);
}

export async function getOrCreateSubject(env, userId, name, { color = null, priority = 2 } = {}) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) return null;
  const existing = await env.DB.prepare("SELECT id, name, color, priority FROM subjects WHERE user_id = ? AND name = ? COLLATE NOCASE")
    .bind(userId, clean).first();
  if (existing) return existing;
  const subject = { id: crypto.randomUUID(), name: clean, color, priority };
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO subjects (id, user_id, name, color, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(subject.id, userId, subject.name, subject.color, subject.priority, now, now).run();
  return subject;
}

export async function createTask(env, userId, input) {
  const subject = input.subject ? await getOrCreateSubject(env, userId, input.subject, { priority: input.priority }) : null;
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(), subjectId: subject?.id || null, title: input.title, taskType: input.taskType || "homework",
    dueAt: input.dueAt, estimatedMinutes: input.estimatedMinutes, remainingMinutes: input.estimatedMinutes,
    priority: input.priority || 2, status: "pending", notes: input.notes || "", createdAt: now, updatedAt: now
  };
  await env.DB.prepare(`
    INSERT INTO tasks (id, user_id, subject_id, title, task_type, due_at, estimated_minutes, remaining_minutes,
      priority, status, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(task.id, userId, task.subjectId, task.title, task.taskType, task.dueAt, task.estimatedMinutes,
    task.remainingMinutes, task.priority, task.notes, now, now).run();
  return getTask(env, userId, task.id);
}

export async function addTaskTime(env, userId, taskId, minutes) {
  const safeMinutes = Math.min(12 * 60, Math.max(15, Math.round(Number(minutes) || 0)));
  const result = await env.DB.prepare(`
    UPDATE tasks SET estimated_minutes = estimated_minutes + ?, remaining_minutes = remaining_minutes + ?,
      status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status != 'archived'
  `).bind(safeMinutes, safeMinutes, new Date().toISOString(), taskId, userId).run();
  return Number(result.meta?.changes || 0) ? getTask(env, userId, taskId) : null;
}

export async function getPlannerData(env, userId) {
  const [profile, preferences, subjects, tasks, commitments] = await Promise.all([
    getProfile(env, userId), getPreferences(env, userId), listSubjects(env, userId),
    listTasks(env, userId), listCommitments(env, userId)
  ]);
  return { profile, preferences, subjects, tasks, commitments };
}

export async function listEvents(env, userId, start, end, { includeCancelled = false } = {}) {
  const result = await env.DB.prepare(`
    SELECT id, source, external_id AS externalId, calendar_id AS calendarId, title, description, kind,
      subject, location, start_at AS startAt, end_at AS endAt, all_day AS allDay, status, editable,
      recurrence, sync_status AS syncStatus, task_id AS taskId, commitment_id AS commitmentId,
      event_category AS category, outcome, occurrence_key AS occurrenceKey, pinned
    FROM events
    WHERE user_id = ? AND start_at < ? AND end_at > ? AND (? = 1 OR status != 'cancelled')
    ORDER BY start_at ASC
  `).bind(userId, end, start, includeCancelled ? 1 : 0).all();
  return (result.results || []).map(normalizeEvent);
}

export async function getEvent(env, userId, id) {
  const row = await env.DB.prepare(`
    SELECT id, source, external_id AS externalId, calendar_id AS calendarId, title, description, kind,
      subject, location, start_at AS startAt, end_at AS endAt, all_day AS allDay, status, editable,
      recurrence, sync_status AS syncStatus, task_id AS taskId, commitment_id AS commitmentId,
      event_category AS category, outcome, occurrence_key AS occurrenceKey, pinned
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
    recurrence: input.recurrence || null, syncStatus: "local", taskId: input.taskId || null,
    commitmentId: input.commitmentId || null, category: input.category || categoryForKind(input.kind),
    outcome: "planned", occurrenceKey: input.occurrenceKey || null, pinned: Boolean(input.pinned)
  };
  await env.DB.prepare(`
    INSERT INTO events (id, user_id, source, title, description, kind, subject, location, start_at, end_at,
      all_day, status, editable, recurrence, sync_status, task_id, commitment_id, event_category, outcome,
      occurrence_key, pinned, created_at, updated_at)
    VALUES (?, ?, 'arcadia', ?, ?, ?, ?, ?, ?, ?, ?, 'planned', 1, ?, 'local', ?, ?, ?, 'planned', ?, ?, ?, ?)
  `).bind(event.id, userId, event.title, event.description, event.kind, event.subject, event.location,
    event.startAt, event.endAt, event.allDay ? 1 : 0, event.recurrence, event.taskId, event.commitmentId,
    event.category, event.occurrenceKey, event.pinned ? 1 : 0, now, now).run();
  return event;
}

export async function updateEvent(env, userId, id, input) {
  const existing = await getEvent(env, userId, id);
  if (!existing || !existing.editable || existing.source !== "arcadia") return null;
  const next = { ...existing, ...input, id, source: "arcadia", editable: true };
  await env.DB.prepare(`
    UPDATE events SET title = ?, description = ?, kind = ?, subject = ?, location = ?, start_at = ?, end_at = ?,
      all_day = ?, recurrence = ?, event_category = ?, pinned = ?, sync_status = CASE WHEN external_id IS NULL THEN 'local' ELSE 'pending' END, updated_at = ?
    WHERE id = ? AND user_id = ? AND source = 'arcadia' AND editable = 1
  `).bind(next.title, next.description || "", next.kind, next.subject || null, next.location || null,
    next.startAt, next.endAt, next.allDay ? 1 : 0, next.recurrence || null,
    next.category || categoryForKind(next.kind), next.pinned ? 1 : 0, new Date().toISOString(), id, userId).run();
  return getEvent(env, userId, id);
}

export async function deleteEvent(env, userId, id) {
  const existing = await getEvent(env, userId, id);
  if (!existing || !existing.editable || existing.source !== "arcadia") return null;
  await env.DB.prepare("DELETE FROM events WHERE id = ? AND user_id = ? AND source = 'arcadia' AND editable = 1")
    .bind(id, userId).run();
  return existing;
}

export async function markEventOutcome(env, userId, id, outcome) {
  const event = await getEvent(env, userId, id);
  if (!event || event.source !== "arcadia" || event.category !== "study" || !["completed", "missed"].includes(outcome)) return null;
  if (event.outcome === outcome) return { event, task: event.taskId ? await getTask(env, userId, event.taskId) : null, changed: false };
  if (event.outcome !== "planned") return null;
  const now = new Date().toISOString();
  const duration = minutesBetween(event.startAt, event.endAt);
  const statements = [
    env.DB.prepare("UPDATE events SET status = ?, outcome = ?, updated_at = ? WHERE id = ? AND user_id = ? AND outcome = 'planned'")
      .bind(outcome === "completed" ? "completed" : "cancelled", outcome, now, id, userId),
    env.DB.prepare("DELETE FROM activity WHERE event_id = ? AND user_id = ?").bind(id, userId),
    env.DB.prepare(`INSERT INTO activity (id, user_id, event_id, task_id, outcome, duration_minutes, occurred_at, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, id, event.taskId, outcome, duration, now,
        `${event.title} · ${new Date(event.startAt).toISOString()}`, now)
  ];
  if (outcome === "completed") {
    statements.push(env.DB.prepare("DELETE FROM study_sessions WHERE event_id = ? AND user_id = ?").bind(id, userId));
    statements.push(env.DB.prepare(`
      INSERT INTO study_sessions (id, user_id, event_id, subject, started_at, ended_at, duration_minutes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, id, event.subject, event.startAt, event.endAt, duration, now));
    if (event.taskId) {
      statements.push(env.DB.prepare(`
        UPDATE tasks SET remaining_minutes = MAX(0, remaining_minutes - ?),
          status = CASE WHEN remaining_minutes - ? <= 0 THEN 'completed' ELSE 'pending' END,
          completed_at = CASE WHEN remaining_minutes - ? <= 0 THEN ? ELSE NULL END, updated_at = ?
        WHERE id = ? AND user_id = ?
      `).bind(duration, duration, duration, now, now, event.taskId, userId));
    }
  }
  await env.DB.batch(statements);
  return { event: await getEvent(env, userId, id), task: event.taskId ? await getTask(env, userId, event.taskId) : null, changed: true };
}

export async function completeEvent(env, userId, id) {
  const event = await getEvent(env, userId, id);
  if (!event || event.source !== "arcadia") return null;
  if (event.category === "study" && event.outcome === "planned") return (await markEventOutcome(env, userId, id, "completed"))?.event || null;
  if (event.category === "study" && event.outcome === "completed") {
    const duration = minutesBetween(event.startAt, event.endAt);
    const statements = [
      env.DB.prepare("UPDATE events SET status = 'planned', outcome = 'planned', updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(new Date().toISOString(), id, userId),
      env.DB.prepare("DELETE FROM activity WHERE event_id = ? AND user_id = ?").bind(id, userId),
      env.DB.prepare("DELETE FROM study_sessions WHERE event_id = ? AND user_id = ?").bind(id, userId)
    ];
    if (event.taskId) statements.push(env.DB.prepare(`
      UPDATE tasks SET remaining_minutes = MIN(estimated_minutes, remaining_minutes + ?), status = 'pending',
        completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?
    `).bind(duration, new Date().toISOString(), event.taskId, userId));
    await env.DB.batch(statements);
    return getEvent(env, userId, id);
  }
  const completed = event.status !== "completed";
  await env.DB.prepare("UPDATE events SET status = ?, outcome = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(completed ? "completed" : "planned", completed ? "completed" : "planned", new Date().toISOString(), id, userId).run();
  return getEvent(env, userId, id);
}

export async function getAnalytics(env, userId, start, end, capacityDays = 7) {
  const [rows, activity, preferences] = await Promise.all([
    listEvents(env, userId, start, end), listActivity(env, userId, { start, end, limit: 250 }), getPreferences(env, userId)
  ]);
  const study = rows.filter((event) => event.category === "study");
  const completedStudy = study.filter((event) => event.outcome === "completed");
  const missed = activity.filter((item) => item.outcome === "missed").length;
  const completedActivities = activity.filter((item) => item.outcome === "completed");
  const focusedMinutes = completedStudy.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const plannedMinutes = study.filter((event) => event.outcome === "planned").reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const scheduledMinutes = study.reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  const denominator = completedActivities.length + missed + study.filter((event) => event.outcome === "planned").length;
  const subjects = new Map();
  for (const event of completedStudy) {
    const subject = event.subject || "General";
    subjects.set(subject, (subjects.get(subject) || 0) + minutesBetween(event.startAt, event.endAt));
  }
  const subjectDistribution = [...subjects.entries()].map(([subject, minutes]) => ({ subject, minutes }))
    .sort((a, b) => b.minutes - a.minutes).slice(0, 5);
  return {
    focusedMinutes,
    plannedMinutes,
    completionRate: denominator ? Math.round((completedActivities.length / denominator) * 100) : 0,
    completedCount: completedActivities.length,
    missedCount: missed,
    plannedCount: denominator,
    currentStreak: completionStreak(activity),
    capacityMinutes: Math.max(0, Number(preferences.maxDailyStudyMinutes || 180) * Math.max(1, Number(capacityDays) || 7) - scheduledMinutes),
    subjectDistribution
  };
}

export async function listSubjectContexts(env, userId) {
  const [contextsResult, filesResult] = await Promise.all([
    env.DB.prepare(`SELECT s.id AS subjectId, s.name AS subjectName, s.color,
      COALESCE(c.notes, '') AS notes, COALESCE(c.include_in_arcad, 1) AS includeInArcad,
      c.updated_at AS updatedAt
      FROM subjects s LEFT JOIN subject_contexts c ON c.subject_id = s.id AND c.user_id = s.user_id
      WHERE s.user_id = ? ORDER BY s.priority DESC, s.name COLLATE NOCASE`).bind(userId).all(),
    env.DB.prepare(`SELECT id, subject_id AS subjectId, filename, content_type AS contentType,
      size_bytes AS sizeBytes, text_excerpt AS textExcerpt, created_at AS createdAt
      FROM subject_files WHERE user_id = ? ORDER BY created_at DESC`).bind(userId).all()
  ]);
  const filesBySubject = new Map();
  for (const file of filesResult.results || []) {
    if (!filesBySubject.has(file.subjectId)) filesBySubject.set(file.subjectId, []);
    filesBySubject.get(file.subjectId).push(file);
  }
  return (contextsResult.results || []).map((row) => ({
    ...row,
    includeInArcad: Boolean(row.includeInArcad),
    files: (filesBySubject.get(row.subjectId) || []).slice(0, 30)
  }));
}

export async function saveSubjectContext(env, userId, subjectId, input) {
  const subject = await env.DB.prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?").bind(subjectId, userId).first();
  if (!subject) return null;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO subject_contexts (subject_id, user_id, notes, include_in_arcad, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_id) DO UPDATE SET notes = excluded.notes, include_in_arcad = excluded.include_in_arcad, updated_at = excluded.updated_at
    WHERE subject_contexts.user_id = excluded.user_id`)
    .bind(subjectId, userId, input.notes, input.includeInArcad ? 1 : 0, now, now).run();
  return (await listSubjectContexts(env, userId)).find((item) => item.subjectId === subjectId) || null;
}

export async function createSubjectFileMetadata(env, userId, subjectId, file) {
  const subject = await env.DB.prepare("SELECT id FROM subjects WHERE id = ? AND user_id = ?").bind(subjectId, userId).first();
  if (!subject) return null;
  const record = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...file };
  await env.DB.prepare(`INSERT INTO subject_files
    (id, user_id, subject_id, filename, content_type, size_bytes, storage_key, text_excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(record.id, userId, subjectId, record.filename, record.contentType, record.sizeBytes, record.storageKey, record.textExcerpt, record.createdAt).run();
  const { storageKey, textExcerpt, ...view } = record;
  return { ...view, subjectId };
}

export async function getSubjectFile(env, userId, id) {
  return env.DB.prepare(`SELECT id, subject_id AS subjectId, filename, content_type AS contentType,
    size_bytes AS sizeBytes, storage_key AS storageKey, text_excerpt AS textExcerpt, created_at AS createdAt
    FROM subject_files WHERE id = ? AND user_id = ?`).bind(id, userId).first();
}

export async function deleteSubjectFileMetadata(env, userId, id) {
  const file = await getSubjectFile(env, userId, id);
  if (!file) return null;
  const result = await env.DB.prepare("DELETE FROM subject_files WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return Number(result.meta?.changes || 0) ? file : null;
}

export async function listMessages(env, userId, limit = 20) {
  const result = await env.DB.prepare(`
    SELECT id, role, content, created_at AS createdAt FROM chat_messages
    WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, Math.min(50, Math.max(1, limit))).all();
  return (result.results || []).reverse();
}

export async function saveMessage(env, userId, role, content, conversationId = null) {
  const message = { id: crypto.randomUUID(), role, content, conversationId: conversationId || null, createdAt: new Date().toISOString() };
  await env.DB.prepare("INSERT INTO chat_messages (id, user_id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(message.id, userId, message.conversationId, role, content, message.createdAt).run();
  return message;
}

function deriveConversationTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean;
}

export async function getConversation(env, userId, id) {
  return env.DB.prepare(`
    SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, last_message_at AS lastMessageAt
    FROM chat_conversations WHERE id = ? AND user_id = ?
  `).bind(id, userId).first();
}

export async function createConversation(env, userId, { title = null } = {}) {
  const now = new Date().toISOString();
  const conversation = { id: crypto.randomUUID(), title: title || null, createdAt: now, updatedAt: now, lastMessageAt: null };
  await env.DB.prepare(`
    INSERT INTO chat_conversations (id, user_id, title, created_at, updated_at, last_message_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).bind(conversation.id, userId, conversation.title, now, now).run();
  return conversation;
}

export async function listConversations(env, userId, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt, c.last_message_at AS lastMessageAt,
      (SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS messageCount
    FROM chat_conversations c
    WHERE c.user_id = ?
    ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
    LIMIT ?
  `).bind(userId, Math.min(100, Math.max(1, limit))).all();
  return (result.results || []).map((row) => ({
    id: row.id,
    title: row.title || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    messageCount: Number(row.messageCount || 0),
    snippet: row.lastMessage ? deriveConversationTitle(row.lastMessage) : ""
  }));
}

export async function listConversationMessages(env, userId, conversationId, limit = 50) {
  const result = await env.DB.prepare(`
    SELECT id, role, content, created_at AS createdAt FROM chat_messages
    WHERE user_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, conversationId, Math.min(200, Math.max(1, limit))).all();
  return (result.results || []).reverse();
}

export async function touchConversation(env, userId, conversationId, { at = new Date().toISOString(), autoTitleFrom = null } = {}) {
  if (autoTitleFrom) {
    await env.DB.prepare(`
      UPDATE chat_conversations SET last_message_at = ?, updated_at = ?, title = COALESCE(title, ?)
      WHERE id = ? AND user_id = ?
    `).bind(at, at, deriveConversationTitle(autoTitleFrom), conversationId, userId).run();
  } else {
    await env.DB.prepare(`
      UPDATE chat_conversations SET last_message_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(at, at, conversationId, userId).run();
  }
}

export async function getOrCreateActiveConversation(env, userId, preferredId = null) {
  if (preferredId) {
    const found = await getConversation(env, userId, preferredId);
    if (found) return found;
  }
  const newest = async () => env.DB.prepare(`
    SELECT id FROM chat_conversations WHERE user_id = ?
    ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 1
  `).bind(userId).first();

  const existing = await newest();
  if (existing) return getConversation(env, userId, existing.id);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const firstUser = await env.DB.prepare(`
    SELECT content FROM chat_messages
    WHERE user_id = ? AND conversation_id IS NULL AND role = 'user'
    ORDER BY created_at ASC LIMIT 1
  `).bind(userId).first();
  const lastOrphan = await env.DB.prepare(`
    SELECT MAX(created_at) AS ts FROM chat_messages WHERE user_id = ? AND conversation_id IS NULL
  `).bind(userId).first();
  const title = firstUser ? deriveConversationTitle(firstUser.content) : null;
  await env.DB.prepare(`
    INSERT INTO chat_conversations (id, user_id, title, created_at, updated_at, last_message_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM chat_conversations WHERE user_id = ?)
  `).bind(id, userId, title, now, now, lastOrphan?.ts || null, userId).run();
  const resolved = await newest();
  const activeId = resolved?.id || id;
  await env.DB.prepare("UPDATE chat_messages SET conversation_id = ? WHERE user_id = ? AND conversation_id IS NULL")
    .bind(activeId, userId).run();
  return getConversation(env, userId, activeId);
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
  return { ...row, allDay: Boolean(row.allDay), editable: Boolean(row.editable), pinned: Boolean(row.pinned), category: row.category || categoryForKind(row.kind), outcome: row.outcome || (row.status === "completed" ? "completed" : "planned") };
}
function normalizeProposal(row) {
  let operations = [];
  try { operations = JSON.parse(row.operationsJson || "[]"); } catch { operations = []; }
  const { operationsJson, ...proposal } = row;
  return { ...proposal, operations };
}
function categoryForKind(kind) {
  if (kind === "study" || kind === "task") return "study";
  if (kind === "training") return "sport";
  if (kind === "sleep") return "sleep";
  return "other";
}
function minutesBetween(start, end) {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000));
}
function completionStreak(activity) {
  const days = new Set(activity.filter((item) => item.outcome === "completed").map((item) => item.occurredAt.slice(0, 10)));
  if (!days.size) return 0;
  let cursor = new Date(); cursor.setUTCHours(0, 0, 0, 0);
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return streak;
}
