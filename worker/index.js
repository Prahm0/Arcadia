import dashboardHtml from "../dashboard.html?raw";
import dashboardScript from "../dashboard.js?raw";
import authHtml from "../auth.html?raw";
import authScript from "../auth.js?raw";
import lucideIconsScript from "../lucide-icons.js?raw";
import arcadiaLogo from "../arcadia-logo-original.png?inline";
import arcadiaMark from "../arcadia-mark.png?inline";
import arcadiaMarkTransparent from "../arcadia-mark-transparent.png?inline";
import favicon from "../favicon.png?inline";
import appleTouchIcon from "../apple-touch-icon.png?inline";
import socialPreview from "../og-v3.png?inline";
import {
  completeEvent, createEvent, createSubjectFileMetadata, createTask, deleteEvent, deleteSubjectFileMetadata, ensureDatabase,
  getAnalytics, getCompanion, getEvent, getPlannerData, getSubjectFile, listActivity, listEvents, listMessages, listPendingProposals,
  listStudySessions, listSubjectContexts, markEventOutcome, saveOnboarding, saveStudySessions, saveSubjectContext,
  clearStudySessions, updateCompanion, updateEvent, weekRange
} from "./db.js";
import {
  beginGoogleOAuth, disconnectGoogle, finishGoogleOAuth, getGoogleStatus, publishArcadiaEvent,
  removePublishedEvent, syncGoogleCalendars
} from "./google.js";
import { applyProposal, chatStream, declineProposal, mentorAvailable } from "./openai.js";
import { buildBriefing, dateKeyInZone, focusTasks, rebuildSchedule, zonedDateTime } from "./scheduler.js";
import {
  attachSession, authenticateRequest, handleAccountRoute, handleAuthRoute, handleSessionRoute,
  requireCsrf, verifyEmailChange
} from "./auth.js";

const htmlHeaders = {
  "cache-control": "private, no-store",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff"
};
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const MAX_SUBJECT_FILE_BYTES = 10 * 1024 * 1024;
const imageAssets = new Map([
  ["/arcadia-logo.png", arcadiaLogo], ["/arcadia-mark.png", arcadiaMark],
  ["/arcadia-mark-transparent.png", arcadiaMarkTransparent], ["/favicon.png", favicon],
  ["/apple-touch-icon.png", appleTouchIcon], ["/og.png", socialPreview],
  ["/og-v2.png", socialPreview], ["/og-v3.png", socialPreview]
]);

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === "/auth.js") return new Response(authScript, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" } });
    if (url.pathname === "/dashboard.js") return new Response(dashboardScript, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" } });
    if (url.pathname === "/lucide-icons.js") return new Response(lucideIconsScript, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, no-store" } });
    const imageAsset = imageAssets.get(url.pathname);
    if (imageAsset) return new Response(decodeDataUrl(imageAsset), { headers: { "cache-control": "public, max-age=31536000, immutable", "content-type": "image/png" } });
    try {
      await ensureDatabase(env);
      if (url.pathname.startsWith("/api/auth/")) {
        const publicResponse = await handleAuthRoute(request, env, url);
        if (publicResponse) return publicResponse;
      }
      if (request.method === "GET" && url.pathname === "/api/account/verify-email-change") return verifyEmailChange(request, env, url);
      if (request.method === "GET" && url.pathname === "/api/google/callback") {
        if (url.searchParams.get("error")) return Response.redirect(`${url.origin}/?google=denied`, 302);
        await finishGoogleOAuth(env, null, url.origin, url.searchParams.get("code"), url.searchParams.get("state"));
        return Response.redirect(`${url.origin}/?google=connected`, 302);
      }

      const auth = await authenticateRequest(request, env);
      if (["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(url.pathname)) {
        return auth ? attachSession(Response.redirect(`${url.origin}/`, 302), auth) : new Response(authHtml, { headers: htmlHeaders });
      }
      if (url.pathname === "/dashboard") return Response.redirect(`${url.origin}/`, 308);
      if (url.pathname === "/") return auth
        ? attachSession(new Response(dashboardHtml, { headers: htmlHeaders }), auth)
        : Response.redirect(`${url.origin}/login`, 302);
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      if (!auth) return json({ error: "Authentication required.", loginUrl: "/login" }, 401);

      const sessionResponse = await handleSessionRoute(request, env, url, auth);
      if (sessionResponse) return sessionResponse;
      const accountResponse = await handleAccountRoute(request, env, url, auth);
      if (accountResponse) return attachSession(accountResponse, auth);
      requireCsrf(request, auth);
      return attachSession(await routeApi(request, env, context, url, auth.user, auth.csrfToken), auth);
    } catch (error) {
      console.error("Arcadia request failed", { path: url.pathname, message: error?.message });
      const status = error.status || 500;
      return json({ error: status >= 500 ? friendlyError(error) : error.message }, status);
    }
  }
};

async function routeApi(request, env, context, url, authenticatedUser, csrfToken) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/api/dashboard") {
    const range = weekRange(url.searchParams.get("date") || new Date());
    const planner = await getPlannerData(env, authenticatedUser.id);
    const [events, analytics, google, messages, proposals, activity, subjectContexts] = await Promise.all([
      listEvents(env, authenticatedUser.id, range.start, range.end),
      getAnalytics(env, authenticatedUser.id, range.start, range.end),
      getGoogleStatus(env, authenticatedUser.id),
      listMessages(env, authenticatedUser.id, 24),
      listPendingProposals(env, authenticatedUser.id),
      listActivity(env, authenticatedUser.id, { start: new Date(Date.now() - 14 * 86_400_000).toISOString(), limit: 30 }),
      listSubjectContexts(env, authenticatedUser.id)
    ]);
    const companion = await getCompanion(env, authenticatedUser.id, { currentStreak: analytics.currentStreak });
    if (google.connected && (!google.lastSyncAt || Date.now() - Date.parse(google.lastSyncAt) > 5 * 60 * 1000)) {
      context?.waitUntil?.(syncGoogleCalendars(env, authenticatedUser.id).catch((error) => console.error("Google sync failed", error?.message)));
    }
    const user = {
      ...authenticatedUser,
      name: planner.profile?.displayName || authenticatedUser.name,
      grade: planner.profile?.grade || null,
      timezone: planner.profile?.timezone || "Australia/Sydney",
      onboardingComplete: Boolean(planner.profile?.onboardingComplete)
    };
    return json({
      user, profile: planner.profile, preferences: planner.preferences, subjects: planner.subjects,
      tasks: planner.tasks, commitments: planner.commitments, range, events, analytics, activity, subjectContexts, companion,
      focusTasks: focusTasks(planner.tasks),
      briefing: planner.profile?.onboardingComplete ? buildBriefing({ ...planner, events, now: new Date() }) : null,
      google,
      studySessions: await listStudySessions(env, authenticatedUser.id), csrfToken,
      assistant: { configured: mentorAvailable(env), providerConfigured: Boolean(env.OPENAI_API_KEY), messages, proposals }
    });
  }

  if (method === "GET" && path === "/api/calendar") {
    const range = validateCalendarRange(url.searchParams.get("start"), url.searchParams.get("end"));
    const events = await listEvents(env, authenticatedUser.id, range.start, range.end);
    return json({ range, events });
  }

  if (method === "POST" && path === "/api/onboarding") {
    const input = validateOnboarding(await readJson(request));
    await saveOnboarding(env, authenticatedUser.id, input);
    const schedule = await rebuildSchedule(env, authenticatedUser.id, { from: new Date(), horizonDays: 21 });
    publishSchedule(context, env, authenticatedUser.id, schedule.created);
    return json({ ok: true, createdCount: schedule.created.length, unscheduled: schedule.unscheduled }, 201);
  }

  if (method === "POST" && path === "/api/tasks") {
    const input = validateTask(await readJson(request));
    const task = await createTask(env, authenticatedUser.id, input);
    const schedule = await rebuildSchedule(env, authenticatedUser.id, { from: new Date(), horizonDays: 21 });
    publishSchedule(context, env, authenticatedUser.id, schedule.created);
    return json({ task, schedule: scheduleSummary(schedule) }, 201);
  }

  if (method === "POST" && path === "/api/schedule/generate") {
    const schedule = await rebuildSchedule(env, authenticatedUser.id, { from: new Date(), horizonDays: 21 });
    publishSchedule(context, env, authenticatedUser.id, schedule.created);
    return json({ schedule: scheduleSummary(schedule) });
  }

  if (method === "GET" && path === "/api/analytics") {
    const period = url.searchParams.get("period") || "week";
    if (!["day", "week", "month"].includes(period)) throw badRequest("Choose day, week, or month for the analytics period.");
    const planner = await getPlannerData(env, authenticatedUser.id);
    const timezone = planner.profile?.timezone || "Australia/Sydney";
    const range = analyticsRange(url.searchParams.get("date") || new Date(), period, timezone);
    const analytics = await getAnalytics(env, authenticatedUser.id, range.start, range.end, range.days);
    return json({ period, range: { start: range.start, end: range.end }, analytics });
  }

  if (method === "GET" && path === "/api/study-sessions") return json({ sessions: await listStudySessions(env, authenticatedUser.id) });
  if (method === "PATCH" && path === "/api/companion") {
    const companion = await updateCompanion(env, authenticatedUser.id, validateCompanion(await readJson(request)));
    return json({ companion });
  }
  if (method === "POST" && path === "/api/study-sessions") {
    const body = await readJson(request); const raw = Array.isArray(body.sessions) ? body.sessions : [body];
    if (!raw.length || raw.length > 50) throw badRequest("Add between 1 and 50 study sessions at a time.");
    const sessions = await saveStudySessions(env, authenticatedUser.id, raw.map(validateStudySession));
    return json({ sessions }, 201);
  }
  if (method === "DELETE" && path === "/api/study-sessions") {
    await clearStudySessions(env, authenticatedUser.id); return json({ ok: true });
  }

  const subjectContextMatch = path.match(/^\/api\/subjects\/([^/]+)\/context$/);
  if (subjectContextMatch && method === "PATCH") {
    const subjectId = decodeURIComponent(subjectContextMatch[1]); const body = await readJson(request);
    const saved = await saveSubjectContext(env, authenticatedUser.id, subjectId, {
      notes: text(body.notes, 4000), includeInArcad: body.includeInArcad !== false
    });
    if (!saved) return json({ error: "Subject not found." }, 404);
    return json({ context: saved });
  }

  const subjectFilesMatch = path.match(/^\/api\/subjects\/([^/]+)\/files$/);
  if (subjectFilesMatch && method === "POST") {
    if (!env.FILES) throw new Error("Arcadia file storage is not configured.");
    const subjectId = decodeURIComponent(subjectFilesMatch[1]);
    const contexts = await listSubjectContexts(env, authenticatedUser.id);
    if (!contexts.some((item) => item.subjectId === subjectId)) return json({ error: "Subject not found." }, 404);
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_SUBJECT_FILE_BYTES) return json({ error: "Choose a file no larger than 10 MB." }, 413);
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_SUBJECT_FILE_BYTES) return json({ error: "Choose a file between 1 byte and 10 MB." }, 413);
    const filename = safeFilename(url.searchParams.get("filename") || request.headers.get("x-file-name"));
    const contentType = text(request.headers.get("content-type"), 120) || "application/octet-stream";
    const storageKey = `${authenticatedUser.id}/${subjectId}/${crypto.randomUUID()}`;
    const textExcerpt = extractTextExcerpt(bytes, filename, contentType);
    await env.FILES.put(storageKey, bytes, { httpMetadata: { contentType }, customMetadata: { userId: authenticatedUser.id, subjectId } });
    try {
      const file = await createSubjectFileMetadata(env, authenticatedUser.id, subjectId, { filename, contentType, sizeBytes: bytes.byteLength, storageKey, textExcerpt });
      return json({ file }, 201);
    } catch (error) { await env.FILES.delete(storageKey); throw error; }
  }

  const subjectFileMatch = path.match(/^\/api\/subject-files\/([^/]+)$/);
  if (subjectFileMatch && method === "GET") {
    if (!env.FILES) throw new Error("Arcadia file storage is not configured.");
    const file = await getSubjectFile(env, authenticatedUser.id, decodeURIComponent(subjectFileMatch[1]));
    if (!file) return json({ error: "File not found." }, 404);
    const object = await env.FILES.get(file.storageKey);
    if (!object) return json({ error: "File content is unavailable." }, 404);
    return new Response(object.body, { headers: {
      "content-type": file.contentType, "content-length": String(file.sizeBytes), "cache-control": "private, no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "x-content-type-options": "nosniff"
    } });
  }
  if (subjectFileMatch && method === "DELETE") {
    if (!env.FILES) throw new Error("Arcadia file storage is not configured.");
    const file = await getSubjectFile(env, authenticatedUser.id, decodeURIComponent(subjectFileMatch[1]));
    if (!file) return json({ error: "File not found." }, 404);
    await env.FILES.delete(file.storageKey);
    await deleteSubjectFileMetadata(env, authenticatedUser.id, file.id);
    return json({ ok: true });
  }

  if (path === "/api/events" && method === "POST") {
    const input = validateEvent(await readJson(request));
    const conflicts = await findConflicts(env, authenticatedUser.id, input, null);
    if (conflicts.length) return json({ error: "This time overlaps another event. Choose a free time instead.", conflicts }, 409);
    let event = await createEvent(env, authenticatedUser.id, input);
    event = await publishArcadiaEvent(env, authenticatedUser.id, event);
    return json({ event }, 201);
  }
  if (path === "/api/events" && method === "PATCH") {
    const body = await readJson(request);
    if (!body.id) throw badRequest("An event id is required.");
    return updateEventHandler(env, authenticatedUser.id, body.id, body);
  }
  if (path === "/api/events" && method === "DELETE") {
    const body = await readJson(request);
    if (!body.id) throw badRequest("An event id is required.");
    return deleteEventHandler(env, authenticatedUser.id, body.id);
  }
  const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && method === "PATCH") return updateEventHandler(env, authenticatedUser.id, decodeURIComponent(eventMatch[1]), await readJson(request));
  if (eventMatch && method === "DELETE") return deleteEventHandler(env, authenticatedUser.id, decodeURIComponent(eventMatch[1]));
  const completionMatch = path.match(/^\/api\/events\/([^/]+)\/complete$/);
  if (completionMatch && method === "POST") {
    const event = await completeEvent(env, authenticatedUser.id, decodeURIComponent(completionMatch[1]));
    if (!event) return json({ error: "Event not found." }, 404);
    return json({ event });
  }
  const outcomeMatch = path.match(/^\/api\/events\/([^/]+)\/outcome$/);
  if (outcomeMatch && method === "POST") {
    const body = await readJson(request);
    if (!["completed", "missed"].includes(body.outcome)) throw badRequest("Choose completed or missed.");
    const eventId = decodeURIComponent(outcomeMatch[1]);
    const original = await getEvent(env, authenticatedUser.id, eventId);
    const outcome = await markEventOutcome(env, authenticatedUser.id, eventId, body.outcome);
    if (!outcome) return json({ error: "This study session is unavailable." }, 404);
    if (body.outcome === "completed") return json({ outcome, message: `${original.title} is complete. Your progress has been saved.` });
    const schedule = await rebuildSchedule(env, authenticatedUser.id, { from: new Date(), horizonDays: 21 });
    publishSchedule(context, env, authenticatedUser.id, schedule.created);
    const moved = schedule.created.find((event) => event.taskId === original.taskId);
    const message = moved
      ? `You missed ${original.title}, so I moved ${minutesBetween(original.startAt, original.endAt)} minutes to ${formatMove(moved.startAt)}. The rest of your plan was checked for conflicts.`
      : `You missed ${original.title}. The work still remains, but there is no safe opening before its deadline. Review the task with Arcad.`;
    return json({ outcome, schedule: scheduleSummary(schedule), message });
  }

  if (method === "GET" && path === "/api/google/connect") {
    return Response.redirect(await beginGoogleOAuth(env, authenticatedUser, url.origin), 302);
  }
  if (method === "POST" && path === "/api/google/sync") return json({ ok: true, lastSyncAt: await syncGoogleCalendars(env, authenticatedUser.id) });
  if (method === "DELETE" && path === "/api/google/connection") {
    await disconnectGoogle(env, authenticatedUser.id);
    return json({ ok: true });
  }

  if (method === "GET" && path === "/api/chat") return json({ messages: await listMessages(env, authenticatedUser.id), proposals: await listPendingProposals(env, authenticatedUser.id) });
  if (method === "POST" && path === "/api/chat") {
    const body = await readJson(request);
    return chatStream(env, authenticatedUser, body.message, context);
  }
  const proposalMatch = path.match(/^\/api\/proposals\/([^/]+)\/(apply|decline)$/);
  if (proposalMatch && method === "POST") {
    const id = decodeURIComponent(proposalMatch[1]);
    if (proposalMatch[2] === "apply") {
      const proposal = await applyProposal(env, authenticatedUser.id, id);
      if (!proposal) return json({ error: "This proposal is unavailable or has already been handled." }, 409);
      return json({ proposal });
    }
    const declined = await declineProposal(env, authenticatedUser.id, id);
    if (!declined) return json({ error: "This proposal is unavailable or has already been handled." }, 409);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

async function updateEventHandler(env, userId, id, body) {
  const existing = await getEvent(env, userId, id);
  if (!existing) return json({ error: "Event not found." }, 404);
  if (!existing.editable || existing.source !== "arcadia") return json({ error: "Fixed and imported events are read-only here. Update them in Life setup or their source calendar." }, 403);
  const input = { ...validateEvent({ ...existing, ...body }), pinned: body.pinned === undefined ? existing.pinned : Boolean(body.pinned) };
  const conflicts = await findConflicts(env, userId, input, id);
  if (conflicts.length) return json({ error: "This time overlaps another event. Choose a free time instead.", conflicts }, 409);
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

function validateOnboarding(body) {
  const name = text(body.name, 80);
  const grade = text(body.grade, 40);
  const timezone = text(body.timezone, 80) || "Australia/Sydney";
  if (!name || !grade) throw badRequest("Add your name and school year.");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw badRequest("Choose a valid timezone."); }

  if (!Array.isArray(body.subjects) || body.subjects.length < 1 || body.subjects.length > 20) throw badRequest("Add between 1 and 20 subjects.");
  const seen = new Set();
  const subjects = body.subjects.map((raw, index) => {
    const subjectName = text(raw.name, 80);
    if (!subjectName) throw badRequest(`Subject ${index + 1} needs a name.`);
    const key = subjectName.toLowerCase();
    if (seen.has(key)) throw badRequest(`${subjectName} is listed more than once.`);
    seen.add(key);
    return { name: subjectName, color: validColor(raw.color), icon: text(raw.icon, 8) || null, priority: priority(raw.priority) };
  });

  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 40).map((raw) => validateTask(raw, { subjects: seen }));
  const commitments = (Array.isArray(body.commitments) ? body.commitments : []).slice(0, 60).map(validateCommitment);
  const preferences = validatePreferences(body.preferences || {});
  return { name, grade, timezone, subjects, tasks, commitments, preferences };
}

function validateCompanion(body) {
  const name = text(body.name, 40);
  const form = text(body.form, 20);
  const palette = text(body.palette, 20);
  const accessory = text(body.accessory, 20);
  if (!name) throw badRequest("Give your companion a name.");
  if (!["orb", "comet", "nebula"].includes(form)) throw badRequest("Choose a valid companion form.");
  if (!["violet", "aqua", "coral", "gold"].includes(palette)) throw badRequest("Choose a valid companion palette.");
  if (!["none", "ring", "star", "book", "headphones"].includes(accessory)) throw badRequest("Choose a valid companion accessory.");
  return { name, form, palette, accessory };
}

function validateTask(body, { subjects } = {}) {
  const title = text(body.title, 120);
  const subject = text(body.subject, 80);
  const taskType = text(body.taskType, 30) || "homework";
  const due = new Date(body.dueAt);
  const estimatedMinutes = Math.round(Number(body.estimatedMinutes));
  if (!title) throw badRequest("Every task needs a title.");
  if (subjects && subject && !subjects.has(subject.toLowerCase())) throw badRequest(`${subject} must be added as a subject first.`);
  if (!["homework", "assignment", "exam", "revision", "project", "other"].includes(taskType)) throw badRequest("Choose a valid task type.");
  if (Number.isNaN(due.valueOf())) throw badRequest(`${title} needs a valid due date.`);
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 15 || estimatedMinutes > 24 * 60) throw badRequest(`${title} needs an estimate between 15 minutes and 24 hours.`);
  return { title, subject: subject || null, taskType, dueAt: due.toISOString(), estimatedMinutes, priority: priority(body.priority), notes: text(body.notes, 1000) };
}

function validateCommitment(body) {
  const title = text(body.title, 120);
  const category = text(body.category, 30);
  const recurrence = text(body.recurrence, 20) || "none";
  const startTime = validTime(body.startTime);
  const endTime = validTime(body.endTime);
  const weekday = body.weekday === null || body.weekday === undefined || body.weekday === "" ? null : Number(body.weekday);
  const startDate = body.startDate ? text(body.startDate, 10) : null;
  if (!title) throw badRequest("Every commitment needs a title.");
  if (!["school", "sport", "extracurricular", "other"].includes(category)) throw badRequest(`Choose a valid category for ${title}.`);
  if (!["none", "weekly", "weekdays"].includes(recurrence)) throw badRequest(`Choose a valid recurrence for ${title}.`);
  if (!startTime || !endTime || startTime === endTime) throw badRequest(`${title} needs valid start and end times.`);
  if (recurrence === "weekly" && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) throw badRequest(`${title} needs a weekday.`);
  if (recurrence === "none" && !/^\d{4}-\d{2}-\d{2}$/.test(startDate || "")) throw badRequest(`${title} needs a date.`);
  return { title, subject: text(body.subject, 80) || null, category, startDate, weekday, startTime, endTime, recurrence, notes: text(body.notes, 1000) };
}

function validatePreferences(body) {
  const bedtime = validTime(body.bedtime) || "22:30";
  const wakeTime = validTime(body.wakeTime) || "06:30";
  const minimumSleepMinutes = clampInt(body.minimumSleepMinutes, 360, 720, 480);
  const maxDailyStudyMinutes = clampInt(body.maxDailyStudyMinutes, 60, 480, 180);
  const preferredSessionMinutes = clampInt(body.preferredSessionMinutes, 25, 120, 60);
  const breakMinutes = clampInt(body.breakMinutes, 5, 60, 15);
  const sleepWindow = (timeToMinutes(wakeTime) - timeToMinutes(bedtime) + 1440) % 1440;
  if (sleepWindow < minimumSleepMinutes) throw badRequest("Your bedtime and wake time do not allow the minimum sleep target.");
  return { bedtime, wakeTime, minimumSleepMinutes, maxDailyStudyMinutes, preferredSessionMinutes, breakMinutes };
}

function validateEvent(body) {
  const title = text(body.title, 120);
  const kind = text(body.kind, 30) || "general";
  const category = text(body.category, 30) || ({ study: "study", task: "study", training: "sport", sleep: "sleep" }[kind] || "other");
  if (!title) throw badRequest("Add a title for this event.");
  if (!["task", "study", "training", "sleep", "general"].includes(kind)) throw badRequest("Choose a valid event type.");
  if (!["school", "study", "sport", "extracurricular", "other", "sleep"].includes(category)) throw badRequest("Choose a valid event category.");
  const start = new Date(body.startAt); const end = new Date(body.endAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) throw badRequest("Choose valid start and end times.");
  if (end <= start) throw badRequest("The end time must be after the start time.");
  if (end - start > 14 * DAY_MS) throw badRequest("An event cannot be longer than 14 days.");
  const recurrence = body.recurrence ? text(body.recurrence, 500) : null;
  if (recurrence && !/^RRULE:/i.test(recurrence)) throw badRequest("Recurrence must use an RRULE value.");
  return { title, kind, category, startAt: start.toISOString(), endAt: end.toISOString(), allDay: Boolean(body.allDay), recurrence,
    description: text(body.description, 1000), subject: text(body.subject, 80) || null, location: text(body.location, 160) || null };
}

function validateCalendarRange(startValue, endValue) {
  const start = new Date(startValue || ""); const end = new Date(endValue || "");
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) throw badRequest("Choose a valid calendar date range.");
  if (end <= start) throw badRequest("The calendar range end must be after its start.");
  if (end - start > 62 * DAY_MS) throw badRequest("Calendar ranges cannot be longer than 62 days.");
  return { start: start.toISOString(), end: end.toISOString() };
}

function validateStudySession(body) {
  const seconds = Math.round(Number(body.seconds)); const ended = new Date(body.endedAt);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 24 * 60 * 60) throw badRequest("Study session duration must be between one second and 24 hours.");
  if (Number.isNaN(ended.valueOf()) || ended.getTime() > Date.now() + 5 * 60 * 1000) throw badRequest("Choose a valid study session end time.");
  return { id: text(body.id, 120) || crypto.randomUUID(), type: text(body.type, 20), seconds,
    subject: text(body.subject, 80) || "General", goal: text(body.goal, 120), distractions: clampInt(body.distractions, 0, 999, 0), endedAt: ended.toISOString() };
}

export function analyticsRange(value, period = "week", timezone = "Australia/Sydney") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw badRequest("Choose a valid analytics date.");
  if (!["day", "week", "month"].includes(period)) throw badRequest("Choose day, week, or month for the analytics period.");
  let startKey = dateKeyInZone(date, timezone);
  let days = 1;
  if (period === "week") {
    const weekday = (new Date(`${startKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
    startKey = shiftDateKey(startKey, -weekday);
    days = 7;
  } else if (period === "month") {
    const [year, month] = startKey.split("-").map(Number);
    startKey = `${year}-${String(month).padStart(2, "0")}-01`;
    days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  const endKey = shiftDateKey(startKey, days);
  return {
    start: zonedDateTime(startKey, "00:00", timezone).toISOString(),
    end: zonedDateTime(endKey, "00:00", timezone).toISOString(),
    days
  };
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

async function findConflicts(env, userId, input, excludeId) {
  const result = await env.DB.prepare(`
    SELECT id, title, start_at AS startAt, end_at AS endAt, source FROM events
    WHERE user_id = ? AND status != 'cancelled' AND start_at < ? AND end_at > ? AND (? IS NULL OR id != ?)
    ORDER BY start_at LIMIT 8
  `).bind(userId, input.endAt, input.startAt, excludeId, excludeId).all();
  return result.results || [];
}

function publishSchedule(context, env, userId, events) {
  const work = Promise.all(events.map((event) => publishArcadiaEvent(env, userId, event))).catch((error) => console.error("Calendar publishing failed", error?.message));
  context?.waitUntil?.(work);
}
function scheduleSummary(schedule) { return { createdCount: schedule.created.length, unscheduled: schedule.unscheduled, created: schedule.created }; }
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
function text(value, max) { return String(value || "").trim().slice(0, max); }
function safeFilename(value) {
  const clean = String(value || "file").replace(/[\u0000-\u001f\u007f\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return clean || "file";
}
function extractTextExcerpt(bytes, filename, contentType) {
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  const textLike = contentType.startsWith("text/") || ["application/json", "application/xml", "application/javascript", "application/x-yaml"].includes(contentType.split(";")[0]) || ["txt", "md", "csv", "json", "xml", "yaml", "yml", "js", "ts", "css", "html"].includes(extension);
  if (!textLike || bytes.byteLength > 512 * 1024) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "").slice(0, 12000);
}
function validTime(value) { const clean = String(value || ""); return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean) ? clean : null; }
function validColor(value) { const clean = String(value || ""); return /^#[0-9a-f]{6}$/i.test(clean) ? clean : null; }
function priority(value) { const number = Number(value); return [1, 2, 3].includes(number) ? number : 2; }
function clampInt(value, min, max, fallback) { const number = Math.round(Number(value)); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
function timeToMinutes(value) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function minutesBetween(start, end) { return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000)); }
function formatMove(value) { return new Intl.DateTimeFormat("en-AU", { weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
const DAY_MS = 86_400_000;
