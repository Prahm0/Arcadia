const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.app.created"
];

export function googleConfigured(env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY);
}

export async function beginGoogleOAuth(env, user, origin) {
  assertConfigured(env);
  const verifier = randomToken(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomToken(32);
  const stateHash = await sha256Base64Url(state);
  await env.DB.prepare("DELETE FROM oauth_states WHERE user_id = ? OR created_at < ?")
    .bind(user.id, new Date(Date.now() - 10 * 60 * 1000).toISOString()).run();
  await env.DB.prepare("INSERT INTO oauth_states (state_hash, user_id, code_verifier, created_at) VALUES (?, ?, ?, ?)")
    .bind(stateHash, user.id, verifier, new Date().toISOString()).run();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env, origin),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });
  return `${GOOGLE_AUTH}?${params}`;
}

export async function finishGoogleOAuth(env, user, origin, code, state) {
  assertConfigured(env);
  if (!code || !state) throw new Error("Google did not return an authorization code.");
  const stateHash = await sha256Base64Url(state);
  const stored = await env.DB.prepare("SELECT user_id AS userId, code_verifier AS verifier, created_at AS createdAt FROM oauth_states WHERE state_hash = ?")
    .bind(stateHash).first();
  if (!stored || (user && stored.userId !== user.id) || Date.now() - Date.parse(stored.createdAt) > 10 * 60 * 1000) {
    throw new Error("Google connection expired. Please try again.");
  }
  await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(stateHash).run();
  const tokenResponse = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: stored.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(env, origin)
    })
  });
  const tokens = await readGoogleResponse(tokenResponse, "Google token exchange failed");
  if (!tokens.refresh_token) throw new Error("Google did not provide offline access. Disconnect Arcadia in Google and try again.");
  const encrypted = await encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.refresh_token);
  const calendar = await googleFetch(tokens.access_token, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Arcadia", description: "Study blocks planned by Arcadia" })
  });
  const now = new Date().toISOString();
  const userId = stored.userId;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO google_connections (user_id, encrypted_refresh_token, token_iv, arcadia_calendar_id, connected_at, last_sync_at)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token,
        token_iv = excluded.token_iv, arcadia_calendar_id = excluded.arcadia_calendar_id, connected_at = excluded.connected_at, last_sync_at = NULL
    `).bind(userId, encrypted.ciphertext, encrypted.iv, calendar.id, now),
    env.DB.prepare("DELETE FROM google_calendars WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM events WHERE user_id = ? AND source = 'google'").bind(userId)
  ]);
  await loadGoogleCalendars(env, userId, tokens.access_token, calendar.id);
  await syncGoogleCalendars(env, userId, tokens.access_token);
  return userId;
}

export async function getGoogleStatus(env, userId) {
  if (!googleConfigured(env)) return { configured: false, connected: false, calendars: [], lastSyncAt: null };
  const connection = await env.DB.prepare(`
    SELECT arcadia_calendar_id AS arcadiaCalendarId, connected_at AS connectedAt, last_sync_at AS lastSyncAt
    FROM google_connections WHERE user_id = ?
  `).bind(userId).first();
  if (!connection) return { configured: true, connected: false, calendars: [], lastSyncAt: null };
  const result = await env.DB.prepare("SELECT calendar_id AS id, title, color, selected FROM google_calendars WHERE user_id = ? ORDER BY title")
    .bind(userId).all();
  return { configured: true, connected: true, ...connection, calendars: (result.results || []).map((row) => ({ ...row, selected: Boolean(row.selected) })) };
}

export async function syncGoogleCalendars(env, userId, suppliedAccessToken) {
  assertConfigured(env);
  const accessToken = suppliedAccessToken || await getAccessToken(env, userId);
  const calendars = await env.DB.prepare("SELECT calendar_id AS id, sync_token AS syncToken FROM google_calendars WHERE user_id = ? AND selected = 1")
    .bind(userId).all();
  for (const calendar of calendars.results || []) await syncCalendar(env, userId, accessToken, calendar.id, calendar.syncToken);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE google_connections SET last_sync_at = ? WHERE user_id = ?").bind(now, userId).run();
  return now;
}

export async function disconnectGoogle(env, userId) {
  const connection = await env.DB.prepare("SELECT encrypted_refresh_token AS token, token_iv AS iv FROM google_connections WHERE user_id = ?")
    .bind(userId).first();
  if (connection && googleConfigured(env)) {
    try {
      const refreshToken = await decryptToken(env.TOKEN_ENCRYPTION_KEY, connection.token, connection.iv);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }
      });
    } catch { /* Local disconnect still succeeds when revocation is unavailable. */ }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE user_id = ? AND source = 'google'").bind(userId),
    env.DB.prepare("DELETE FROM google_calendars WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(userId)
  ]);
}

export async function publishArcadiaEvent(env, userId, event) {
  if (!googleConfigured(env) || event.kind !== "study") return event;
  const connection = await env.DB.prepare("SELECT arcadia_calendar_id AS calendarId FROM google_connections WHERE user_id = ?")
    .bind(userId).first();
  if (!connection?.calendarId) return event;
  try {
    const accessToken = await getAccessToken(env, userId);
    const payload = googleEventPayload(event);
    const external = event.externalId
      ? await googleFetch(accessToken, `/calendars/${encodeURIComponent(connection.calendarId)}/events/${encodeURIComponent(event.externalId)}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await googleFetch(accessToken, `/calendars/${encodeURIComponent(connection.calendarId)}/events`, { method: "POST", body: JSON.stringify(payload) });
    await env.DB.prepare("UPDATE events SET external_id = ?, calendar_id = ?, sync_status = 'synced', updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(external.id, connection.calendarId, new Date().toISOString(), event.id, userId).run();
    return { ...event, externalId: external.id, calendarId: connection.calendarId, syncStatus: "synced" };
  } catch {
    await env.DB.prepare("UPDATE events SET sync_status = 'error' WHERE id = ? AND user_id = ?").bind(event.id, userId).run();
    return { ...event, syncStatus: "error" };
  }
}

export async function removePublishedEvent(env, userId, event) {
  if (!event.externalId || !event.calendarId || !googleConfigured(env)) return;
  try {
    const accessToken = await getAccessToken(env, userId);
    const response = await fetch(`${GOOGLE_API}/calendars/${encodeURIComponent(event.calendarId)}/events/${encodeURIComponent(event.externalId)}`, {
      method: "DELETE", headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Google delete failed");
  } catch { /* The Arcadia record is already removed; a later sync can reconcile Google. */ }
}

async function loadGoogleCalendars(env, userId, accessToken, arcadiaCalendarId) {
  let pageToken = null;
  do {
    const params = new URLSearchParams({ minAccessRole: "reader", showHidden: "false", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleFetch(accessToken, `/users/me/calendarList?${params}`);
    const statements = (page.items || []).map((calendar) => env.DB.prepare(`
      INSERT INTO google_calendars (user_id, calendar_id, title, color, access_role, selected)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, calendar_id) DO UPDATE SET title = excluded.title, color = excluded.color, access_role = excluded.access_role, selected = excluded.selected
    `).bind(userId, calendar.id, calendar.summary || "Calendar", calendar.backgroundColor || null, calendar.accessRole || "reader", calendar.id === arcadiaCalendarId ? 0 : 1));
    if (statements.length) await env.DB.batch(statements);
    pageToken = page.nextPageToken || null;
  } while (pageToken);
}

async function syncCalendar(env, userId, accessToken, calendarId, syncToken) {
  let pageToken = null;
  let nextSyncToken = null;
  try {
    do {
      const params = new URLSearchParams({ singleEvents: "true", showDeleted: "true", maxResults: "2500" });
      if (syncToken) params.set("syncToken", syncToken);
      else {
        params.set("timeMin", new Date(Date.now() - 90 * 86400000).toISOString());
        params.set("timeMax", new Date(Date.now() + 365 * 86400000).toISOString());
      }
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetch(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      if (response.status === 410) {
        await env.DB.prepare("UPDATE google_calendars SET sync_token = NULL WHERE user_id = ? AND calendar_id = ?").bind(userId, calendarId).run();
        return syncCalendar(env, userId, accessToken, calendarId, null);
      }
      const page = await readGoogleResponse(response, "Google calendar sync failed");
      for (const item of page.items || []) await upsertGoogleEvent(env, userId, calendarId, item);
      pageToken = page.nextPageToken || null;
      nextSyncToken = page.nextSyncToken || nextSyncToken;
    } while (pageToken);
    if (nextSyncToken) await env.DB.prepare("UPDATE google_calendars SET sync_token = ? WHERE user_id = ? AND calendar_id = ?")
      .bind(nextSyncToken, userId, calendarId).run();
  } catch (error) {
    throw new Error(error.message || "Unable to synchronize Google Calendar.");
  }
}

async function upsertGoogleEvent(env, userId, calendarId, item) {
  if (!item.id) return;
  if (item.status === "cancelled") {
    await env.DB.prepare("DELETE FROM events WHERE user_id = ? AND source = 'google' AND calendar_id = ? AND external_id = ?")
      .bind(userId, calendarId, item.id).run();
    return;
  }
  const startAt = item.start?.dateTime || (item.start?.date ? `${item.start.date}T00:00:00.000Z` : null);
  const endAt = item.end?.dateTime || (item.end?.date ? `${item.end.date}T00:00:00.000Z` : null);
  if (!startAt || !endAt) return;
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM events WHERE user_id = ? AND source = 'google' AND calendar_id = ? AND external_id = ?")
    .bind(userId, calendarId, item.id).first();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO events (id, user_id, source, external_id, calendar_id, title, description, kind, location, start_at, end_at,
      all_day, status, editable, recurrence, sync_status, created_at, updated_at)
    VALUES (?, ?, 'google', ?, ?, ?, ?, 'general', ?, ?, ?, ?, 'planned', 0, ?, 'synced', ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, location = excluded.location,
      start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day, recurrence = excluded.recurrence,
      sync_status = 'synced', updated_at = excluded.updated_at
  `).bind(id, userId, item.id, calendarId, item.summary || "Busy", item.description || "", item.location || null,
    startAt, endAt, item.start?.date ? 1 : 0, item.recurrence ? JSON.stringify(item.recurrence) : null, now, now).run();
}

async function getAccessToken(env, userId) {
  const connection = await env.DB.prepare("SELECT encrypted_refresh_token AS token, token_iv AS iv FROM google_connections WHERE user_id = ?")
    .bind(userId).first();
  if (!connection) throw new Error("Google Calendar is not connected.");
  const refreshToken = await decryptToken(env.TOKEN_ENCRYPTION_KEY, connection.token, connection.iv);
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const tokens = await readGoogleResponse(response, "Google token refresh failed");
  return tokens.access_token;
}

async function googleFetch(accessToken, path, options = {}) {
  const response = await fetch(`${GOOGLE_API}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...(options.headers || {}) }
  });
  return readGoogleResponse(response, "Google Calendar request failed");
}

async function readGoogleResponse(response, message) {
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error?.message || data.error_description || message);
  return data;
}

function googleEventPayload(event) {
  const allDay = Boolean(event.allDay);
  return {
    summary: event.title,
    description: event.description || "Planned by Arcadia",
    location: event.location || undefined,
    start: allDay ? { date: event.startAt.slice(0, 10) } : { dateTime: event.startAt },
    end: allDay ? { date: event.endAt.slice(0, 10) } : { dateTime: event.endAt },
    recurrence: event.recurrence ? [event.recurrence] : undefined,
    extendedProperties: { private: { arcadiaEventId: event.id } }
  };
}

function assertConfigured(env) {
  if (!googleConfigured(env)) throw new Error("Google Calendar setup is not complete.");
}
function redirectUri(env, origin) {
  return env.GOOGLE_REDIRECT_URI || `${origin}/api/google/callback`;
}
function randomToken(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(values);
}
async function sha256Base64Url(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function encryptionKey(secret) {
  let bytes;
  try { bytes = base64UrlDecode(secret); } catch { bytes = new TextEncoder().encode(secret); }
  if (bytes.length !== 32) bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encryptToken(secret, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(token));
  return { ciphertext: base64Url(new Uint8Array(data)), iv: base64Url(iv) };
}
async function decryptToken(secret, ciphertext, iv) {
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(iv) }, await encryptionKey(secret), base64UrlDecode(ciphertext));
  return new TextDecoder().decode(data);
}
function base64Url(bytes) {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded); return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
