// Pure analytics aggregation. Deliberately import-free: worker/db.js cannot reach
// worker/scheduler.js (scheduler already imports db), so the timezone helpers are local.

const DAY_MS = 86_400_000;

export const ANALYTICS_SETTINGS_DEFAULTS = {
  heatmap: { window: 371, metric: "minutes", includeTracker: true, weekStart: "monday" },
  trend: { metric: "minutes", compare: true },
  subjects: { sort: "minutes", limit: 6 },
  rhythm: { metric: "minutes" }
};

const SETTINGS_SHAPE = {
  heatmap: {
    window: { type: "enum", values: [92, 183, 371] },
    metric: { type: "enum", values: ["minutes", "sessions"] },
    includeTracker: { type: "boolean" },
    weekStart: { type: "enum", values: ["monday", "sunday"] }
  },
  trend: {
    metric: { type: "enum", values: ["minutes", "sessions", "completion"] },
    compare: { type: "boolean" }
  },
  subjects: {
    sort: { type: "enum", values: ["minutes", "name", "sessions"] },
    limit: { type: "integer", min: 3, max: 20 }
  },
  rhythm: {
    metric: { type: "enum", values: ["minutes", "sessions"] }
  }
};

export function safeTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return "Australia/Sydney";
  }
}

export function dateKeyInZone(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function hourInZone(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeTimezone(timezone), hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour);
}

export function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Weekday of a date key, Monday = 0 .. Sunday = 6. Computed from the key itself so it never
// depends on the viewer's zone.
export function weekdayOfKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function daysBetweenKeys(startKey, endKey) {
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / DAY_MS);
}

function emptyDay(date) {
  return {
    date, minutes: 0, sessions: 0, completedCount: 0, missedCount: 0,
    plannedMinutes: 0, topSubject: null, subjects: {}
  };
}

/**
 * Buckets study entries into one row per day, including days with no study at all.
 *
 * An entry is `{ startAt, endAt, minutes, subject, outcome, source }`. `minutes` counts only
 * toward completed study; planned blocks accumulate into `plannedMinutes` so the trend chart
 * can show intent against reality.
 */
export function bucketDailyStudy(entries, timezone, startKey, days) {
  const zone = safeTimezone(timezone);
  const total = Math.max(0, Math.round(Number(days) || 0));
  const rows = new Map();
  for (let index = 0; index < total; index += 1) {
    const key = shiftDateKey(startKey, index);
    rows.set(key, emptyDay(key));
  }

  for (const entry of entries || []) {
    const key = dateKeyInZone(entry.startAt, zone);
    const row = rows.get(key);
    if (!row) continue;
    const minutes = Math.max(0, Math.round(Number(entry.minutes) || 0));
    if (entry.outcome === "completed") {
      row.minutes += minutes;
      row.sessions += 1;
      row.completedCount += 1;
      const subject = entry.subject || "General";
      row.subjects[subject] = (row.subjects[subject] || 0) + minutes;
    } else if (entry.outcome === "missed") {
      row.missedCount += 1;
    } else {
      row.plannedMinutes += minutes;
    }
  }

  for (const row of rows.values()) {
    const ranked = Object.entries(row.subjects).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    row.topSubject = ranked.length ? ranked[0][0] : null;
  }
  return [...rows.values()];
}

/** Sparse weekday x hour totals. Weekday 0 = Monday. */
export function bucketHourlyStudy(entries, timezone) {
  const zone = safeTimezone(timezone);
  const cells = new Map();
  for (const entry of entries || []) {
    if (entry.outcome !== "completed") continue;
    const key = dateKeyInZone(entry.startAt, zone);
    const weekday = weekdayOfKey(key);
    const hour = hourInZone(entry.startAt, zone);
    const id = `${weekday}:${hour}`;
    const cell = cells.get(id) || { weekday, hour, minutes: 0, sessions: 0 };
    cell.minutes += Math.max(0, Math.round(Number(entry.minutes) || 0));
    cell.sessions += 1;
    cells.set(id, cell);
  }
  return [...cells.values()].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}

export function subjectTotals(entries) {
  const subjects = new Map();
  for (const entry of entries || []) {
    if (entry.outcome !== "completed") continue;
    const name = entry.subject || "General";
    const current = subjects.get(name) || { subject: name, minutes: 0, sessions: 0 };
    current.minutes += Math.max(0, Math.round(Number(entry.minutes) || 0));
    current.sessions += 1;
    subjects.set(name, current);
  }
  return [...subjects.values()].sort((a, b) => b.minutes - a.minutes || a.subject.localeCompare(b.subject));
}

/**
 * Current and longest run of consecutive studied days across `dailyRows`.
 *
 * `todayKey` anchors the current streak: a run that ended yesterday still counts as current
 * (the day is not over yet), a run that ended earlier does not.
 */
export function summariseStreaks(dailyRows, todayKey) {
  const rows = [...(dailyRows || [])].sort((a, b) => a.date.localeCompare(b.date));
  const studied = new Set(rows.filter((row) => row.minutes > 0).map((row) => row.date));
  let longest = 0; let run = 0; let previous = null;
  for (const row of rows) {
    if (studied.has(row.date)) {
      run = previous && daysBetweenKeys(previous, row.date) === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      previous = row.date;
    } else {
      run = 0; previous = null;
    }
  }

  let current = 0;
  if (todayKey) {
    let cursor = studied.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
    while (studied.has(cursor)) { current += 1; cursor = shiftDateKey(cursor, -1); }
  }
  return { current, longest, activeDays: studied.size, totalDays: rows.length };
}

/**
 * Four cut points splitting the non-zero values into five intensity bands, so the heatmap
 * scale adapts to the individual instead of a fixed minute ladder. A light studier still
 * gets contrast; a heavy one does not saturate at the top.
 */
export function intensityThresholds(values) {
  const sorted = (values || []).map((value) => Number(value) || 0).filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return [1, 2, 3, 4];
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  const raw = [at(0.2), at(0.45), at(0.7), at(0.9)];
  // Keep the bands strictly increasing so distinct levels stay distinguishable.
  const thresholds = [];
  for (const value of raw) thresholds.push(Math.max(1, value, (thresholds[thresholds.length - 1] || 0) + 1));
  return thresholds;
}

export function intensityLevel(value, thresholds) {
  const amount = Number(value) || 0;
  if (amount <= 0) return 0;
  const bands = thresholds || [1, 2, 3, 4];
  for (let index = 0; index < bands.length; index += 1) if (amount <= bands[index]) return index + 1;
  return bands.length + 1;
}

/** Merges user input over the defaults, dropping unknown keys and clamping known ones. */
export function validateAnalyticsSettings(input, base = ANALYTICS_SETTINGS_DEFAULTS) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const merged = {};
  for (const [widget, fields] of Object.entries(SETTINGS_SHAPE)) {
    const defaults = { ...ANALYTICS_SETTINGS_DEFAULTS[widget], ...(base?.[widget] || {}) };
    const incoming = source[widget] && typeof source[widget] === "object" ? source[widget] : {};
    const result = {};
    for (const [field, rule] of Object.entries(fields)) {
      result[field] = coerce(incoming[field], rule, defaults[field] ?? ANALYTICS_SETTINGS_DEFAULTS[widget][field]);
    }
    merged[widget] = result;
  }
  return merged;
}

function coerce(value, rule, fallback) {
  if (value === undefined || value === null) return fallback;
  if (rule.type === "boolean") return typeof value === "boolean" ? value : fallback;
  if (rule.type === "integer") {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.min(rule.max, Math.max(rule.min, number));
  }
  if (rule.type === "enum") {
    const numeric = typeof rule.values[0] === "number" ? Number(value) : value;
    return rule.values.includes(numeric) ? numeric : fallback;
  }
  return fallback;
}

export function parseAnalyticsSettings(json) {
  let parsed = {};
  try { parsed = JSON.parse(json || "{}"); } catch { parsed = {}; }
  return validateAnalyticsSettings(parsed);
}
