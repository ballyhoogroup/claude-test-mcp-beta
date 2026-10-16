/** Shared MCP activity redaction, safe argument tokens, and customer-job lead lines. */

import { STANDARD_ASSISTANCE_INTENTS, intentById } from "./intents.mjs";

const SECRET_KEY = /secret|password|token|api[-_]?key|authorization|cookie|email|phone|ssn|card|cvv|cvc|pan/i;
const FREE_TEXT_KEY = /^(query|q|prompt|text|message|content|body|issuesummary|issue_summary|search|input|notes?|comment|description|name|fullname|address|subject)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|sb_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]+=*)\b/gi;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const SHORT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;

export function redact(value, depth = 0) {
  if (depth > 2) return "[truncated]";
  if (typeof value === "string") {
    const cleaned = value
      .replace(EMAIL, "[redacted]")
      .replace(SECRET_VALUE, "[redacted]")
      .replace(CARD, "[redacted]");
    return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value ?? null;
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 30)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(child, depth + 1);
  }
  return out;
}

function isSafeTokenValue(value) {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) <= 1_000_000;
  }
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text === "[redacted]" || text === "[truncated]") return false;
  if (/\s/.test(text)) return false;
  if (EMAIL.test(text)) {
    EMAIL.lastIndex = 0;
    return false;
  }
  EMAIL.lastIndex = 0;
  if (SECRET_VALUE.test(text)) {
    SECRET_VALUE.lastIndex = 0;
    return false;
  }
  SECRET_VALUE.lastIndex = 0;
  return SHORT_TOKEN.test(text);
}

/** Safe argument tokens only: enums/booleans/small ints/short tokens. Drops free text. */
export function safeArgumentTokens(args) {
  if (args == null || typeof args !== "object" || Array.isArray(args)) return {};
  const redacted = redact(args);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
  const tokens = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (SECRET_KEY.test(key) || FREE_TEXT_KEY.test(key)) continue;
    if (value == null || value === "" || value === "[redacted]" || value === "[truncated]") continue;
    if (typeof value === "object") continue;
    if (!isSafeTokenValue(value)) continue;
    tokens[key] = typeof value === "string" ? value.trim() : value;
    if (Object.keys(tokens).length >= 12) break;
  }
  return tokens;
}

const PREVIEW_SKIP = /^(name|fullname|address|notes?|comment|description)$/i;
const ARGUMENT_TEXT_KEY = /^(query|q|prompt|text|message|content|input|search)$/i;

/** Short redacted query gist. Safe to store on an activity event; not a raw argument dump. */
export function argumentPreview(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const redacted = redact(args);
  if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return "";
  const parts = [];
  for (const [key, value] of Object.entries(redacted)) {
    if (SECRET_KEY.test(key) || PREVIEW_SKIP.test(key)) continue;
    if (typeof value !== "string") continue;
    const text = value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text || text === "[redacted]" || text === "[truncated]") continue;
    const searchable = ARGUMENT_TEXT_KEY.test(key);
    if (!searchable && (isSafeTokenValue(text) || !/\s/.test(text))) continue;
    parts.push(text);
    if (parts.join(" · ").length >= 140) break;
  }
  return parts.join(" · ").slice(0, 160);
}

/** @deprecated Prefer safeArgumentTokens. Kept for callers that want a string. */
export function summarizeArguments(args) {
  const tokens = safeArgumentTokens(args);
  const parts = [];
  for (const [key, value] of Object.entries(tokens)) {
    parts.push(`${key}: ${value}`);
    if (parts.join(", ").length >= 140) break;
  }
  return parts.join(", ").slice(0, 160);
}

/** Short redacted text of what the tool sent back. Safe to store on an activity event. */
export function resultText(result) {
  const part = Array.isArray(result?.content) ? result.content.find(row => row?.type === "text" && row.text) : null;
  if (!part) return "";
  return sanitizeError(part.text);
}

export function sanitizeError(message) {
  if (message == null) return "";
  return String(redact(String(message)))
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 160);
}

export function cleanToolTitle(value) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120);
}

export function cleanToolDescription(value) {
  if (value == null) return "";
  return String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500);
}

/** Human descriptor: description, else title, else tool name. Long model copy is shortened to the first sentence. */
export function activityDescriptor(row) {
  const description = String(row?.description ?? "").trim();
  if (description) {
    if (description.length <= 96) return description;
    const first = description.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim();
    if (first && first.length <= 120) return first.replace(/[.!?]$/, "") || first;
    return description.slice(0, 96).trim();
  }
  const title = String(row?.title ?? "").trim();
  if (title) return title;
  const toolName = String(row?.toolName ?? "").trim();
  return toolName || "tool";
}

export function activityFingerprint(row) {
  const toolName = String(row?.toolName ?? "");
  const tokens = row?.tokens && typeof row.tokens === "object" && !Array.isArray(row.tokens)
    ? row.tokens
    : {};
  const parts = Object.keys(tokens).sort().map(key => `${key}=${String(tokens[key])}`);
  return `${toolName}|${parts.join("&")}|${eventGist(row)}`;
}

function errorClass(row) {
  const text = `${row?.error ?? ""} ${row?.summary ?? ""}`.toLowerCase();
  if (row?.outcome === "timeout" || /\btimeout\b|\btimed out\b/.test(text)) return "timeout";
  if (/\brate[- ]?limit|\b429\b|\btoo many requests\b/.test(text)) return "rate_limited";
  if (/\bauth|\bunauthoriz|\bforbidden|\b401\b|\b403\b|\bcredential/.test(text)) return "auth_error";
  if (row?.outcome === "error") return "error";
  return "ok";
}

/** Optional humanized status line from approved design-guide templates. */
export function humanizedActivityLine(row) {
  const tool = activityDescriptor(row);
  const klass = errorClass(row);
  const count = Math.max(1, Number(row?.count) || 1);
  const durationMs = Math.max(0, Number(row?.durationMs) || 0);
  if (klass === "timeout") {
    const seconds = Math.max(1, Math.round(durationMs / 1000) || 1);
    return `${tool} timed out after ${seconds}s`;
  }
  if (klass === "auth_error") return `${tool} rejected the session's credentials`;
  if (klass === "rate_limited") return `${tool} is rate limiting this session`;
  if (klass === "error" && count > 1) {
    const duration = durationMs >= 1000
      ? `${Math.round(durationMs / 1000)}s`
      : `${Math.max(1, durationMs)}ms`;
    return `${tool} failed ${count} times in ${duration}`;
  }
  return "";
}

/** Reduce a tool result to a count. JSON bodies and long replies stay out of the summary line. */
export function resultDigest(value) {
  const text = String(value ?? "").trim();
  if (!text) return { shown: null, total: null, reply: "" };
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const bag = Array.isArray(parsed) ? { count: parsed.length } : parsed;
      if (!bag || typeof bag !== "object") return { shown: null, total: null, reply: "" };
      return { shown: firstNumber(bag, ["count", "shown", "returned"]), total: firstNumber(bag, ["totalMatches", "total", "totalCount"]), reply: "" };
    } catch {
      return { shown: null, total: null, reply: "" };
    }
  }
  const found = text.match(/\bFound\s+(\d+)\b/i);
  const total = text.match(/\b(?:of|totalMatches)\s*[:=]?\s*(\d+)\b/i);
  if (found) {
    return { shown: Number(found[1]), total: total ? Number(total[1]) : null, reply: "" };
  }
  return { shown: null, total: null, reply: text };
}

export function digestLine(digest) {
  if (!digest || digest.shown == null) return "";
  if (digest.total != null && digest.total !== digest.shown) return `${digest.shown} of ${digest.total} shown`;
  return `${digest.shown} shown`;
}

function firstNumber(bag, keys) {
  for (const key of keys) {
    const value = Number(bag[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Collapse consecutive same tool + safe-token fingerprint into beats with count. */
export function collapseActivityBeats(activity) {
  const rows = Array.isArray(activity) ? activity.filter(Boolean) : [];
  const beats = [];
  for (const row of rows) {
    const fingerprint = activityFingerprint(row);
    const last = beats[beats.length - 1];
    if (last && last.fingerprint === fingerprint) {
      last.count += 1;
      last.at = row.at ?? last.at;
      last.outcome = row.outcome ?? last.outcome;
      last.durationMs = row.durationMs ?? last.durationMs;
      if (row.error) last.error = row.error;
      if (row.result) last.result = row.result;
      const gist = eventGist(row);
      if (gist && last.gist && last.gist !== gist) last.gistMixed = true;
      else if (gist && !last.gistMixed) last.gist = gist;
      continue;
    }
    beats.push({
      toolName: row.toolName,
      title: row.title || undefined,
      description: row.description || undefined,
      outcome: row.outcome,
      durationMs: row.durationMs ?? 0,
      at: row.at,
      tokens: row.tokens && typeof row.tokens === "object" ? { ...row.tokens } : {},
      summary: row.summary ?? "",
      error: row.error,
      result: row.result || undefined,
      gist: eventGist(row),
      gistMixed: false,
      count: 1,
      fingerprint
    });
  }
  return beats;
}

function eventGist(row) {
  return argumentPreview({ query: row?.gist });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Intent named by an id or by a gist hitting the assistance word lists. Descriptions are ignored. */
export function intentFromText(value) {
  const text = String(value ?? "");
  if (!text.trim()) return null;
  let best = null;
  let bestAt = Infinity;
  for (const intent of STANDARD_ASSISTANCE_INTENTS) {
    for (const word of intent.words ?? []) {
      const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(word)}(?:[^A-Za-z0-9]|$)`, "i");
      const match = pattern.exec(text);
      if (match && match.index < bestAt) {
        bestAt = match.index;
        best = intent;
      }
    }
  }
  return best;
}

function isCompanySearch(row) {
  const name = String(row?.toolName ?? "").trim().toLowerCase();
  if (name === "search_companies") return true;
  const blob = `${row?.title ?? ""} ${row?.description ?? ""}`.toLowerCase();
  return /\bsearch\w*/.test(blob) && /\bcompan(?:y|ies)\b/.test(blob);
}

function askedSentence(intent) {
  switch (intent?.id) {
    case "pricing": return "Asked about pricing.";
    case "purchase": return "Asked about purchasing.";
    case "demo_or_pilot": return "Asked about a demo.";
    case "enterprise": return "Asked about enterprise options.";
    case "implementation": return "Asked about implementation.";
    case "security_compliance": return "Asked about security.";
    case "billing_payment": return "Asked about billing.";
    case "cancellation_downgrade": return "Asked about cancellation.";
    default: return "Asked for a person.";
  }
}

function noteSentence(status, intent) {
  const note = status === "awaiting_consent"
    ? "An escalation request is waiting to be sent."
    : "They sent an escalation request.";
  if (!intent) return note;
  return `${askedSentence(intent)} ${note}`;
}

function distinctGists(rows) {
  const gists = [];
  for (const row of rows) {
    const gist = eventGist(row);
    if (!gist) continue;
    if (gists.at(-1) !== gist) gists.push(gist);
  }
  return gists.slice(0, 6);
}

function describeSearches(rows) {
  const gists = distinctGists(rows);
  const withGist = rows.map(eventGist).filter(Boolean);
  const missing = rows.some(row => !eventGist(row));
  if (gists.length >= 2) {
    return {
      sentence: `Searched companies for ${gists[0]}, then ${gists.slice(1).join(", then ")}.`,
      intent: null,
      stuck: false
    };
  }
  if (gists.length === 1) {
    const intent = intentFromText(gists[0]);
    if (intent) return { sentence: askedSentence(intent), intent, stuck: false };
    if (!missing && withGist.length >= 2) {
      return { sentence: `Stuck searching companies for ${gists[0]}.`, intent: null, stuck: true };
    }
    return { sentence: `Searched companies for ${gists[0]}.`, intent: null, stuck: false };
  }
  return { sentence: "Browsing the company catalog.", intent: null, stuck: false };
}

function toolTitle(row) {
  const title = String(row?.title ?? "").trim().replace(/[.!?]+$/g, "").trim();
  if (title) return title.slice(0, 80);
  return String(row?.toolName ?? "").trim().replace(/_/g, " ").slice(0, 80);
}

function lowerFirst(value) {
  if (!value) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function titleSentence(rows) {
  const titles = [];
  for (const row of rows) {
    const title = toolTitle(row);
    if (!title) continue;
    if (titles.at(-1) !== title) titles.push(title);
  }
  if (!titles.length) return "No recent tool activity.";
  if (titles.length === 1) return `${titles[0]}.`;
  return `${titles[0]}, then ${titles.slice(1).map(lowerFirst).join(", then ")}.`;
}

function assistanceIntent(row) {
  if (String(row?.toolName ?? "") !== "offer_assistance") return null;
  return intentById(row?.tokens?.intent) || intentFromText(eventGist(row)) || intentById("purchase");
}

function interestPhrase(intent) {
  switch (intent?.id) {
    case "pricing": return "pricing";
    case "purchase": return "purchasing";
    case "demo_or_pilot": return "a demo";
    case "enterprise": return "enterprise options";
    case "implementation": return "implementation";
    case "security_compliance": return "security";
    case "billing_payment": return "billing";
    case "cancellation_downgrade": return "cancellation";
    default: return "help";
  }
}

function goalClause(intent) {
  switch (intent?.id) {
    case "pricing": return "trying to find the price";
    case "purchase": return "trying to buy";
    case "demo_or_pilot": return "trying to see a demo";
    case "enterprise": return "trying to sort out enterprise terms";
    case "implementation": return "trying to figure out implementation";
    case "security_compliance": return "trying to check security";
    case "billing_payment": return "trying to sort out a bill";
    case "cancellation_downgrade": return "trying to cancel or downgrade";
    default: return "trying to reach a person";
  }
}

function searchesBetweenAsks(searches, asks) {
  const askTimes = asks.map(row => Date.parse(row?.at)).filter(Number.isFinite);
  if (askTimes.length < 2) return false;
  const first = Math.min(...askTimes);
  const last = Math.max(...askTimes);
  return searches.some(row => {
    const time = Date.parse(row?.at);
    return Number.isFinite(time) && time > first && time < last;
  });
}

function joinTopics(gists) {
  if (gists.length <= 1) return gists[0] || "";
  if (gists.length === 2) return `${gists[0]} and ${gists[1]}`;
  return `${gists.slice(0, -1).join(", ")}, and ${gists.at(-1)}`;
}

function spanPhrase(rows) {
  const times = rows.map(row => Date.parse(row?.at)).filter(Number.isFinite);
  if (times.length < 2) return "just now";
  const minutes = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000));
  return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
}

function recentBurst(rows) {
  const times = rows.map(row => Date.parse(row?.at)).filter(Number.isFinite);
  if (!times.length) return rows;
  const cutoff = Math.max(...times) - 15 * 60000;
  const burst = rows.filter(row => {
    const time = Date.parse(row?.at);
    return Number.isFinite(time) && time >= cutoff;
  });
  return burst.length ? burst : rows;
}

function noteClause(status) {
  if (status === "awaiting_consent") return "An escalation request is waiting to be sent.";
  if (status === "pending") return "They sent an escalation request.";
  return "";
}

/** Repeated asks plus the searches around them. One ask stays a short recap. */
function interpretRepeatedInterest(rows, noteStatus = "") {
  const burst = recentBurst(rows);
  const asks = burst.filter(row => assistanceIntent(row));
  if (asks.length < 2) return null;
  const latest = assistanceIntent(asks.at(-1));
  const same = asks.filter(row => assistanceIntent(row)?.id === latest?.id);
  if (!latest || same.length < 2) return null;
  const searches = burst.filter(isCompanySearch);
  const topics = [];
  for (const gist of searches.map(eventGist)) {
    if (gist && !topics.includes(gist) && topics.length < 4) topics.push(gist);
  }
  const doing = searches.length
    ? `Browsing companies${topics.length ? ` for ${joinTopics(topics)}` : ""}.`
    : "Asking for a person, with no company search in this stretch.";
  const between = searchesBetweenAsks(searches, same);
  const signal = between
    ? `Asked ${same.length} times ${spanPhrase([...searches, ...same])}, with more searches in between.`
    : `Asked ${same.length} times ${spanPhrase(same)}.`;
  const waiting = noteClause(noteStatus);
  const intent = `${latest.label}. ${goalClause(latest).charAt(0).toUpperCase()}${goalClause(latest).slice(1)}. ${signal}${waiting ? ` ${waiting}` : ""}`;
  return {
    sentence: `${doing} ${intent}`,
    doing,
    intent,
    intentId: latest.id,
    stuck: false
  };
}

function trailingAssistance(rows) {
  let index = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (assistanceIntent(rows[i]) || intentById(rows[i]?.tokens?.intent)) index = i;
  }
  if (index < 0) return null;
  const laterSearch = rows.slice(index + 1).some(row => isCompanySearch(row) && !intentFromText(eventGist(row)));
  if (laterSearch) return null;
  return assistanceIntent(rows[index]) || intentById(rows[index]?.tokens?.intent);
}

/**
 * Deterministic job sentence from stored gists and assistance state.
 * Failures are not part of this sentence.
 */
export function customerContextJob(activity, options = {}) {
  const rows = (Array.isArray(activity) ? activity.filter(Boolean) : []).slice(-12);
  const noteStatus = options.noteStatus === "pending" || options.noteStatus === "awaiting_consent"
    ? options.noteStatus
    : "";
  const notedIntent = intentById(options.intentId);
  const repeated = interpretRepeatedInterest(rows, noteStatus);
  if (repeated) return repeated;
  if (noteStatus) {
    const intent = notedIntent || trailingAssistance(rows);
    return {
      sentence: noteSentence(noteStatus, intent),
      intentId: intent?.id || "",
      stuck: false
    };
  }
  if (!rows.length) {
    return { sentence: "No recent tool activity.", intentId: "", stuck: false };
  }
  const assist = trailingAssistance(rows);
  if (assist) return { sentence: askedSentence(assist), intentId: assist.id, stuck: false };
  const searches = rows.filter(isCompanySearch);
  const other = rows.filter(row => !isCompanySearch(row) && String(row?.toolName ?? "") !== "offer_assistance");
  if (searches.length && !other.length) {
    const search = describeSearches(searches);
    return { sentence: search.sentence, intentId: search.intent?.id || "", stuck: search.stuck };
  }
  if (searches.length && isCompanySearch(rows.at(-1))) {
    const search = describeSearches(searches);
    return { sentence: search.sentence, intentId: search.intent?.id || "", stuck: search.stuck };
  }
  return { sentence: titleSentence(other.length ? other : rows), intentId: "", stuck: false };
}

export function activityIntentSentence(activity, options = {}) {
  return customerContextJob(activity, options).sentence;
}

export function publicActivityEvent(event) {
  if (!event) return null;
  const tokens = event.tokens && typeof event.tokens === "object" && !Array.isArray(event.tokens)
    ? { ...event.tokens }
    : {};
  const row = {
    toolName: event.toolName,
    outcome: event.outcome,
    durationMs: event.durationMs ?? 0,
    at: event.at,
    tokens,
    summary: event.summary ?? summarizeArguments(tokens),
    description: event.description || undefined,
    title: event.title || undefined,
    count: Math.max(1, Number(event.count) || 1)
  };
  if (event.error) row.error = event.error;
  if (event.result) row.result = String(event.result).slice(0, 160);
  const gist = event.gistMixed ? "" : eventGist(event);
  if (gist) row.gist = gist;
  return row;
}

/** Public activity as collapsed beats for Context UI and lead lines. */
export function publicActivityBeats(activity) {
  return collapseActivityBeats(activity)
    .map(beat => {
      const row = publicActivityEvent(beat);
      if (!row) return null;
      row.count = beat.count;
      return row;
    })
    .filter(Boolean);
}
