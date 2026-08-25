import { createProposal, getAnalytics, getEvent, getProposal, listEvents, listMessages, saveMessage, setProposalStatus, weekRange } from "./db.js";
import { publishArcadiaEvent } from "./google.js";

const MODEL = "gpt-5.6-terra";
const MAX_MESSAGE_LENGTH = 2000;

const tools = [
  {
    type: "function", name: "list_schedule_events",
    description: "Read the user's Arcadia and Google Calendar events for the current week.",
    parameters: { type: "object", properties: {}, additionalProperties: false }, strict: true
  },
  {
    type: "function", name: "get_weekly_workload",
    description: "Read focused minutes, completion, planned workload, and remaining capacity for the current week.",
    parameters: { type: "object", properties: {}, additionalProperties: false }, strict: true
  },
  {
    type: "function", name: "propose_schedule_changes",
    description: "Create a reviewable proposal. This never changes the calendar until the user separately presses Apply.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", minLength: 1, maxLength: 240 },
        operations: {
          type: "array", minItems: 1, maxItems: 5,
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["create", "update"] },
              eventId: { type: ["string", "null"] },
              title: { type: ["string", "null"] },
              kind: { type: ["string", "null"], enum: ["task", "study", "training", "sleep", "general", null] },
              subject: { type: ["string", "null"] },
              startAt: { type: "string" },
              endAt: { type: "string" }
            },
            required: ["action", "eventId", "title", "kind", "subject", "startAt", "endAt"],
            additionalProperties: false
          }
        }
      },
      required: ["summary", "operations"], additionalProperties: false
    }, strict: true
  }
];

export function openAIConfigured(env) {
  return Boolean(env.OPENAI_API_KEY);
}

export function chatStream(env, user, message) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (payload) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      try {
        const clean = String(message || "").trim();
        if (!clean || clean.length > MAX_MESSAGE_LENGTH) throw new Error("Enter a message between 1 and 2,000 characters.");
        if (!openAIConfigured(env)) throw new Error("The Arcadia assistant is waiting for its OpenAI API key.");
        emit({ type: "status", value: "thinking" });
        await saveMessage(env, user.id, "user", clean);
        const history = await listMessages(env, user.id, 12);
        const range = weekRange();
        const [events, analytics] = await Promise.all([
          listEvents(env, user.id, range.start, range.end),
          getAnalytics(env, user.id, range.start, range.end)
        ]);
        const context = { range, events: events.slice(0, 40), analytics };
        const input = history.map((item) => ({ role: item.role, content: item.content }));
        let proposal = null;
        let response;
        for (let turn = 0; turn < 3; turn += 1) {
          response = await createResponse(env, user, input, context);
          const calls = (response.output || []).filter((item) => item.type === "function_call");
          if (!calls.length) break;
          input.push(...response.output);
          for (const call of calls) {
            let args = {};
            try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
            let output;
            if (call.name === "list_schedule_events") output = { events: context.events };
            else if (call.name === "get_weekly_workload") output = context.analytics;
            else if (call.name === "propose_schedule_changes") {
              const normalized = await validateOperations(env, user.id, args.operations || []);
              proposal = await createProposal(env, user.id, sanitizeText(args.summary, 240), normalized);
              output = { proposalId: proposal.id, status: "pending", message: "Saved for user review; no calendar changes were applied." };
            } else output = { error: "Unknown tool" };
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
          }
        }
        const text = response?.output_text || extractOutputText(response) || (proposal ? `I prepared “${proposal.summary}” for your review.` : "I couldn't produce a response just now.");
        const saved = await saveMessage(env, user.id, "assistant", text);
        emit({ type: "message", message: saved, proposal });
      } catch (error) {
        emit({ type: "error", message: error.message || "The assistant is temporarily unavailable." });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export async function applyProposal(env, userId, proposalId) {
  const proposal = await getProposal(env, userId, proposalId);
  if (!proposal || proposal.status !== "pending" || Date.parse(proposal.expiresAt) < Date.now()) return null;
  const operations = await validateOperations(env, userId, proposal.operations);
  const now = new Date().toISOString();
  const affectedIds = [];
  const statements = [];
  for (const operation of operations) {
    if (operation.action === "create") {
      const id = crypto.randomUUID(); affectedIds.push(id);
      statements.push(env.DB.prepare(`
        INSERT INTO events (id, user_id, source, title, description, kind, subject, start_at, end_at, all_day,
          status, editable, sync_status, created_at, updated_at)
        VALUES (?, ?, 'arcadia', ?, '', ?, ?, ?, ?, 0, 'planned', 1, 'local', ?, ?)
      `).bind(id, userId, operation.title, operation.kind, operation.subject, operation.startAt, operation.endAt, now, now));
    } else {
      affectedIds.push(operation.eventId);
      statements.push(env.DB.prepare(`
        UPDATE events SET title = COALESCE(?, title), kind = COALESCE(?, kind), subject = COALESCE(?, subject),
          start_at = ?, end_at = ?, sync_status = CASE WHEN external_id IS NULL THEN 'local' ELSE 'pending' END, updated_at = ?
        WHERE id = ? AND user_id = ? AND source = 'arcadia' AND editable = 1
      `).bind(operation.title, operation.kind, operation.subject, operation.startAt, operation.endAt, now, operation.eventId, userId));
    }
  }
  statements.push(env.DB.prepare("UPDATE proposals SET status = 'applied', applied_at = ? WHERE id = ? AND user_id = ? AND status = 'pending'")
    .bind(now, proposalId, userId));
  await env.DB.batch(statements);
  for (const id of affectedIds) {
    const event = await getEvent(env, userId, id);
    if (event) await publishArcadiaEvent(env, userId, event);
  }
  return { ...proposal, status: "applied", affectedIds };
}

export async function declineProposal(env, userId, proposalId) {
  return setProposalStatus(env, userId, proposalId, "declined");
}

async function createResponse(env, user, input, context) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || MODEL,
      store: false,
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "low" },
      max_output_tokens: 900,
      safety_identifier: await stableSafetyId(user.id),
      instructions: `You are Arcadia, a calm planning assistant for students. Use Australian English. Be concise, practical, and capacity-aware. You may read schedule context. When the user asks to create, move, or rebalance calendar work, you must call propose_schedule_changes. Never claim a change is applied; say it is ready for review. Do not alter or propose edits to Google-sourced events. Current dashboard context: ${JSON.stringify(context)}`,
      input,
      tools,
      parallel_tool_calls: false
    })
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error?.message || "OpenAI could not respond.");
  return data;
}

async function validateOperations(env, userId, operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 5) throw new Error("The proposed schedule change is invalid.");
  const normalized = [];
  for (const raw of operations) {
    const action = raw.action;
    if (!['create', 'update'].includes(action)) throw new Error("Only creating or moving Arcadia events is allowed.");
    const startAt = new Date(raw.startAt).toISOString();
    const endAt = new Date(raw.endAt).toISOString();
    if (Date.parse(endAt) <= Date.parse(startAt) || Date.parse(endAt) - Date.parse(startAt) > 12 * 60 * 60 * 1000) throw new Error("A proposed time range is invalid.");
    if (Date.parse(startAt) < Date.now() - 24 * 60 * 60 * 1000 || Date.parse(startAt) > Date.now() + 180 * 24 * 60 * 60 * 1000) throw new Error("A proposed event is outside the supported planning window.");
    const kind = raw.kind && ["task", "study", "training", "sleep", "general"].includes(raw.kind) ? raw.kind : "study";
    if (action === "create") {
      const title = sanitizeText(raw.title, 120);
      if (!title) throw new Error("A proposed event needs a title.");
      normalized.push({ action, eventId: null, title, kind, subject: sanitizeText(raw.subject, 80) || null, startAt, endAt });
    } else {
      const existing = await getEvent(env, userId, raw.eventId);
      if (!existing || existing.source !== "arcadia" || !existing.editable) throw new Error("The assistant can only move editable Arcadia events.");
      normalized.push({ action, eventId: existing.id, title: sanitizeText(raw.title, 120) || null,
        kind: raw.kind ? kind : null, subject: sanitizeText(raw.subject, 80) || null, startAt, endAt });
    }
  }
  return normalized;
}

function extractOutputText(response) {
  return (response?.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text")
    .map((item) => item.text).join("\n").trim();
}
function sanitizeText(value, max) { return String(value || "").trim().slice(0, max); }
async function stableSafetyId(userId) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)));
  return [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
