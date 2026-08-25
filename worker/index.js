import dashboardHtml from "../dashboard.html?raw";
import dashboardScript from "../dashboard.js?raw";
import arcadiaLogo from "../arcadia-logo-original.png?inline";
import arcadiaMark from "../arcadia-mark.png?inline";
import arcadiaMarkTransparent from "../arcadia-mark-transparent.png?inline";
import favicon from "../favicon.png?inline";
import appleTouchIcon from "../apple-touch-icon.png?inline";
import socialPreview from "../og-v3.png?inline";
import {
  completeEvent, createEvent, deleteEvent, ensureDatabase, getAnalytics, getEvent, listEvents,
  listMessages, listPendingProposals, requireUser, updateEvent, upsertProfile, weekRange
} from "./db.js";
import {
  beginGoogleOAuth, disconnectGoogle, finishGoogleOAuth, getGoogleStatus, publishArcadiaEvent,
  removePublishedEvent, syncGoogleCalendars
} from "./google.js";
import { applyProposal, chatStream, declineProposal, openAIConfigured } from "./openai.js";

const htmlHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff"
};
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const imageAssets = new Map([
  ["/arcadia-logo.png", arcadiaLogo],
  ["/arcadia-mark.png", arcadiaMark],
  ["/arcadia-mark-transparent.png", arcadiaMarkTransparent],
  ["/favicon.png", favicon],
  ["/apple-touch-icon.png", appleTouchIcon],
  ["/og.png", socialPreview],
  ["/og-v2.png", socialPreview],
  ["/og-v3.png", socialPreview]
]);

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      if (!requireUser(request)) return Response.redirect(`${url.origin}/signin-with-chatgpt?return_to=%2F`, 302);
      return new Response(dashboardHtml, { headers: htmlHeaders });
    }
    if (url.pathname === "/dashboard") return Response.redirect(`${url.origin}/`, 308);
    if (url.pathname === "/dashboard.js") return new Response(dashboardScript, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" } });
    const imageAsset = imageAssets.get(url.pathname);
    if (imageAsset) return new Response(decodeDataUrl(imageAsset), { headers: { "cache-control": "public, max-age=31536000, immutable", "content-type": "image/png" } });
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

    const user = requireUser(request);
    if (!user) return json({ error: "Authentication required." }, 401);
    try {
      await ensureDatabase(env);
      await upsertProfile(env, user);
      return await routeApi(request, env, context, url, user);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: status >= 500 ? friendlyError(error) : error.message }, status);
    }
  }
};

async function routeApi(request, env, context, url, user) {
  const method = request.method.toUpperCase();
  const path = url.pathname;
  if (method === "GET" && path === "/api/dashboard") {
    const range = weekRange(url.searchParams.get("date") || new Date());
    const [events, analytics, google, messages, proposals] = await Promise.all([
      listEvents(env, user.id, range.start, range.end),
      getAnalytics(env, user.id, range.start, range.end),
      getGoogleStatus(env, user.id),
      listMessages(env, user.id, 20),
      listPendingProposals(env, user.id)
    ]);
    if (google.connected && (!google.lastSyncAt || Date.now() - Date.parse(google.lastSyncAt) > 5 * 60 * 1000)) {
      context?.waitUntil?.(syncGoogleCalendars(env, user.id).catch(() => undefined));
    }
    return json({ user, range, events, analytics, google, assistant: { configured: openAIConfigured(env), messages, proposals } });
  }
  if (method === "GET" && path === "/api/analytics") {
    const range = weekRange(url.searchParams.get("date") || new Date());
    return json({ range, analytics: await getAnalytics(env, user.id, range.start, range.end) });
  }
  if (path === "/api/events" && method === "POST") {
    const body = await readJson(request);
    const input = validateEvent(body);
    const conflicts = await findConflicts(env, user.id, input, null);
    if (conflicts.length && !body.allowOverlap) return json({ error: "This time overlaps another event.", conflicts }, 409);
    let event = await createEvent(env, user.id, input);
    event = await publishArcadiaEvent(env, user.id, event);
    return json({ event }, 201);
  }
  if (path === "/api/events" && method === "PATCH") {
    const body = await readJson(request);
    if (!body.id) throw badRequest("An event id is required.");
    return updateEventHandler(env, user.id, body.id, body);
  }
  if (path === "/api/events" && method === "DELETE") {
    const body = await readJson(request);
    if (!body.id) throw badRequest("An event id is required.");
    return deleteEventHandler(env, user.id, body.id);
  }
  const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === "PATCH") return updateEventHandler(env, user.id, decodeURIComponent(eventMatch[1]), await readJson(request));
  if (eventMatch && method === "DELETE") return deleteEventHandler(env, user.id, decodeURIComponent(eventMatch[1]));
  const completionMatch = path.match(/^\/api\/events\/([^/]+)\/complete$/);
  if (completionMatch && method === "POST") {
    const event = await completeEvent(env, user.id, decodeURIComponent(completionMatch[1]));
    if (!event) return json({ error: "Event not found." }, 404);
    return json({ event });
  }

  if (method === "GET" && path === "/api/google/connect") {
    const location = await beginGoogleOAuth(env, user, url.origin);
    return Response.redirect(location, 302);
  }
  if (method === "GET" && path === "/api/google/callback") {
    if (url.searchParams.get("error")) return Response.redirect(`${url.origin}/?google=denied`, 302);
    await finishGoogleOAuth(env, user, url.origin, url.searchParams.get("code"), url.searchParams.get("state"));
    return Response.redirect(`${url.origin}/?google=connected`, 302);
  }
  if (method === "POST" && path === "/api/google/sync") {
    const lastSyncAt = await syncGoogleCalendars(env, user.id);
    return json({ ok: true, lastSyncAt });
  }
  if (method === "DELETE" && path === "/api/google/connection") {
    await disconnectGoogle(env, user.id);
    return json({ ok: true });
  }

  if (method === "GET" && path === "/api/chat") return json({ messages: await listMessages(env, user.id), proposals: await listPendingProposals(env, user.id) });
  if (method === "POST" && path === "/api/chat") {
    const body = await readJson(request);
    return chatStream(env, user, body.message);
  }
  const proposalMatch = path.match(/^\/api\/proposals\/([^/]+)\/(apply|decline)$/);
  if (proposalMatch && method === "POST") {
    const id = decodeURIComponent(proposalMatch[1]);
    if (proposalMatch[2] === "apply") {
      const proposal = await applyProposal(env, user.id, id);
      if (!proposal) return json({ error: "This proposal is unavailable or has already been handled." }, 409);
      return json({ proposal });
    }
    const declined = await declineProposal(env, user.id, id);
    if (!declined) return json({ error: "This proposal is unavailable or has already been handled." }, 409);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

async function updateEventHandler(env, userId, id, body) {
  const existing = await getEvent(env, userId, id);
  if (!existing) return json({ error: "Event not found." }, 404);
  if (!existing.editable || existing.source !== "arcadia") return json({ error: "Imported Google events are read-only." }, 403);
  const input = validateEvent({ ...existing, ...body });
  const conflicts = await findConflicts(env, userId, input, id);
  if (conflicts.length && !body.allowOverlap) return json({ error: "This time overlaps another event.", conflicts }, 409);
  let event = await updateEvent(env, userId, id, input);
  event = await publishArcadiaEvent(env, userId, event);
  return json({ event });
}

async function deleteEventHandler(env, userId, id) {
  const event = await deleteEvent(env, userId, id);
  if (!event) return json({ error: "Event not found or cannot be edited." }, 404);
  await removePublishedEvent(env, userId, event);
  return json({ ok: true });
}

function validateEvent(body) {
  const title = String(body.title || "").trim().slice(0, 120);
  const kind = String(body.kind || "general");
  if (!title) throw badRequest("Add a title for this event.");
  if (!["task", "study", "training", "sleep", "general"].includes(kind)) throw badRequest("Choose a valid event type.");
  const start = new Date(body.startAt); const end = new Date(body.endAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) throw badRequest("Choose valid start and end times.");
  if (end <= start) throw badRequest("The end time must be after the start time.");
  if (end - start > 14 * 24 * 60 * 60 * 1000) throw badRequest("An event cannot be longer than 14 days.");
  const recurrence = body.recurrence ? String(body.recurrence).trim().slice(0, 500) : null;
  if (recurrence && !/^RRULE:/i.test(recurrence)) throw badRequest("Recurrence must use an RRULE value.");
  return {
    title, kind, startAt: start.toISOString(), endAt: end.toISOString(), allDay: Boolean(body.allDay), recurrence,
    description: String(body.description || "").trim().slice(0, 1000),
    subject: String(body.subject || "").trim().slice(0, 80) || null,
    location: String(body.location || "").trim().slice(0, 160) || null
  };
}

async function findConflicts(env, userId, input, excludeId) {
  const result = await env.DB.prepare(`
    SELECT id, title, start_at AS startAt, end_at AS endAt, source FROM events
    WHERE user_id = ? AND status != 'cancelled' AND start_at < ? AND end_at > ? AND (? IS NULL OR id != ?)
    ORDER BY start_at LIMIT 8
  `).bind(userId, input.endAt, input.startAt, excludeId, excludeId).all();
  return result.results || [];
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw badRequest("Expected JSON input.");
  try { return await request.json(); } catch { throw badRequest("The request body is invalid."); }
}
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: jsonHeaders }); }
function badRequest(message) { const error = new Error(message); error.status = 400; return error; }
function friendlyError(error) {
  if (/not configured|setup is not complete|API key/i.test(error.message || "")) return error.message;
  return "Arcadia couldn't complete that request. Please try again.";
}
function decodeDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1); const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
