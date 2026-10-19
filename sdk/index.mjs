import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  cleanToolDescription,
  cleanToolTitle,
  argumentPreview,
  resultText,
  safeArgumentTokens,
  sanitizeError,
  summarizeArguments
} from "../activity.mjs";
import {
  ASSISTANCE_INTENT_IDS,
  intentById,
  normalizeOfferArgs
} from "../intents.mjs";

export {
  STANDARD_ASSISTANCE_INTENTS,
  ASSISTANCE_INTENT_IDS,
  normalizeAssistanceArgs,
  normalizeOfferArgs
} from "../intents.mjs";

/** Optional field that never schema-rejects (null, numbers, extras handled in normalizers). */
const looseField = (description) => z.any().optional().describe(description);

/** Loose connect-tool schema: offerId or offer_id, extras ignored (ChatGPT hosts reject strict schemas). */
const OFFER_CONNECT_INPUT = z.object({
  offer_id: looseField("Offer id from the assistance card or invitation"),
  offerId: looseField("Offer id (camelCase). Same as offer_id.")
}).passthrough();

export const SDK_VERSION = "0.1.1";
export const CHAT_RESOURCE = "ui://supportbridge/chat";
export const INTENT_OFFER_RESOURCE = "ui://supportbridge/intent-offer";
export const APP_MIME = "text/html;profile=mcp-app";

const SECURITY_CUES = intentById("security").words.join(", ");

export const SERVER_INSTRUCTIONS = `This connector has no public price list. Call get_vendor_answer for pricing or plans, an upgrade, limits, or seats, a demo, a trial or pilot, enterprise options, quotes, or contracts, implementation or onboarding, security or compliance (${SECURITY_CUES}), billing or refunds, cancellation or downgrades, a renewal, a competitive comparison, or budget and timing before answering from general knowledge. When a vendor answer card is shown, answer in two or three sentences and leave the card's wording as shown. On a live card, point the user to the representative for a quote. On an escalation, say nobody is online, point to the note on the card, and offer to keep helping. A note is not a chat. The vendor is contacted only after confirm_assistance or file_escalation succeeds. When the result includes assistance or escalation, also relay the suggested message. Calling get_vendor_answer does not contact anyone. When the user agrees to connect, call confirm_assistance with the offer id from that result. If a representative already offered help and there is no offer id, call confirm_assistance with no offer id. confirm_assistance and file_escalation run only after the user explicitly chooses. If get_vendor_answer fails, tell the user the company's answer could not be loaded. Do not guess a price or plan, and do not contact anyone. Data tool results may include an \`assistance\` object with a suggested message; if present, you can relay it to the user.`;
export const DISPLAY_INSTRUCTIONS = SERVER_INSTRUCTIONS;
export const RESULT_HINT_SENTENCE = "Pricing and commercial questions are answered by get_vendor_answer.";

export function vendorAnswerDescription(vendorName) {
  const vendor = String(vendorName ?? "").trim() || "this vendor";
  return `Use this whenever the user asks about ${vendor}'s pricing or plans, an upgrade, limits, or seats, a demo, a trial or pilot, enterprise options, quotes, or contracts, implementation or onboarding, security or compliance (${SECURITY_CUES}), billing or refunds, cancellation or downgrades, a renewal, a competitive comparison, or budget and timing. Returns ${vendor}'s current answer. Call it before answering such questions from general knowledge. Answer in two or three sentences and leave the card's wording as shown. When the card is a live offer, point the user to the representative for a quote. When the card is an escalation, say nobody is online, point to the note on the card, and offer to keep helping. A note is not a chat. The vendor is contacted only after confirm_assistance or file_escalation succeeds.`;
}
export const CONFIRM_ASSISTANCE_DESCRIPTION = "Opens the live chat after the user accepts. Pass the offerId from the assistance card or from the assistance object on an earlier tool result. With no offer id, accepts a pending manual offer for this session. Returns the conversation status.";
export const DECLINE_ASSISTANCE_DESCRIPTION = "Declines a live-assistance offer. Pass the offerId. Does not contact anyone.";

/** Copy a vendor tool without rewriting its description. Result interception stays on the installed wrapper. */
export function wrapTool(tool, options = {}) {
  const source = tool && typeof tool === "object" ? tool : {};
  const description = options.appendResultHint === true
    ? appendResultHint(source.description)
    : source.description;
  return { ...source, description };
}

function appendResultHint(description) {
  if (typeof description !== "string" || description.length === 0) return RESULT_HINT_SENTENCE;
  return description.endsWith(" ")
    ? `${description}${RESULT_HINT_SENTENCE}`
    : `${description} ${RESULT_HINT_SENTENCE}`;
}

function indefiniteArticle(phrase) {
  return /^[aeiou]/i.test(String(phrase ?? "").trim()) ? "an" : "a";
}

export function suggestedAssistanceMessage(offer) {
  const name = String(offer?.representativeName ?? "").trim();
  const role = String(offer?.representativeRole ?? "").trim();
  const vendor = String(offer?.vendorName ?? "").trim();
  if (name && role && vendor) {
    return `${name}, ${indefiniteArticle(role)} ${role} at ${vendor}, is available to help with this now. Want to connect?`;
  }
  if (name && vendor) return `${name} at ${vendor} is available to help with this now. Want to connect?`;
  if (name) return `${name} is available to help with this now. Want to connect?`;
  return "A representative is available to help with this now. Want to connect?";
}

export function invitationText(offer) {
  return suggestedAssistanceMessage(offer);
}

const INTENT_TOPIC = {
  pricing: "pricing",
  upgrade: "an upgrade",
  purchase: "an upgrade",
  demo: "a demo",
  demo_or_pilot: "a demo",
  trial: "a trial",
  enterprise: "enterprise terms",
  implementation: "implementation",
  security: "security and compliance",
  security_compliance: "security and compliance",
  billing: "billing",
  billing_payment: "billing",
  cancellation: "cancellation",
  cancellation_downgrade: "cancellation",
  renewal: "renewal",
  competitive: "a comparison",
  buying_process: "the buying process"
};

function consentNote(summary, acceptLabel) {
  const label = String(acceptLabel || "Chat with support").trim() || "Chat with support";
  const tail = `Nothing is sent until you choose ${label}.`;
  const text = String(summary || "").trim();
  return text ? `${text} ${tail}` : tail;
}

function topicPhrase(intent, label) {
  return INTENT_TOPIC[intent] || String(label || "this request").toLowerCase();
}

export function liveOfferCopy(offer) {
  const topic = topicPhrase(offer.intent, offer.intentLabel);
  const name = offer.representativeName || "A representative";
  const vendor = offer.vendorName || "the vendor";
  const summary = String(offer.issueSummary || "").trim();
  return {
    cardEyebrow: `${vendor} support available`,
    cardTitle: `${name} can help with ${topic}.`,
    cardNote: consentNote(summary, "Chat with support"),
    acceptLabel: "Chat with support",
    declineLabel: "Not now",
    acceptTool: "confirm_assistance",
    declineTool: "decline_assistance",
    suggestedMessage: `${name} can help with ${topic} now. Want to connect?`
  };
}

const DRAFT_ASK = {
  pricing: "Can you share current plans and rates?",
  upgrade: "Can you help them with an upgrade?",
  purchase: "Can you help them with an upgrade?",
  demo: "Can you arrange a demo?",
  demo_or_pilot: "Can you arrange a demo?",
  trial: "Can you arrange a trial or pilot?",
  enterprise: "Can you share enterprise terms?",
  implementation: "Can you help with implementation?",
  security: "Can you share your security and compliance details?",
  security_compliance: "Can you share your security and compliance details?",
  billing: "Can you look into a billing question?",
  billing_payment: "Can you look into a billing question?",
  cancellation: "Can you help with a cancellation?",
  cancellation_downgrade: "Can you help with a cancellation?",
  renewal: "Can you help with a renewal?",
  competitive: "Can you share a comparison?",
  buying_process: "Can you talk through budget and timing?"
};

export function assistanceDraft(note) {
  const topic = topicPhrase(note.intent, note.intentLabel);
  const vendor = note.vendorName || "the vendor";
  const summary = String(note.issueSummary || "").trim();
  const leaked = /^(user|the user|customer|the customer)\b/i.test(summary);
  const ask = !summary || leaked
    ? (DRAFT_ASK[note.intent] || "Can you follow up?")
    : (/[.?!]$/.test(summary) ? summary : `${summary}.`);
  return `A customer is asking about ${topic} for ${vendor}. ${ask}`;
}

export function asyncEscalationCopy(note) {
  const topic = topicPhrase(note.intent, note.intentLabel);
  const vendor = note.vendorName || "the vendor";
  return {
    cardEyebrow: "Human follow-up",
    cardEyebrowTone: "neutral",
    cardTitle: `Ask ${vendor} about ${topic}`,
    cardNote: "Nothing is sent until you confirm.",
    draftNote: assistanceDraft(note),
    acceptLabel: "Send note",
    declineLabel: "Not now",
    acceptTool: "file_escalation",
    declineTool: "decline_escalation",
    sentTitle: `Sent to ${vendor}.`,
    suggestedMessage: "I've drafted a note you can send with the button above."
  };
}

function answerSentences(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[A-Z])/).map(part => part.trim()).filter(Boolean);
}

function clipDirect(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 90) return text;
  const cut = text.slice(0, 90);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, "").trim();
}

export function splitVendorAnswer(text) {
  const full = String(text ?? "").replace(/\s+/g, " ").trim();
  const sentences = answerSentences(full);
  const direct = clipDirect(sentences[0] || full);
  const supporting = sentences.slice(1, 5);
  return {
    direct_answer: direct,
    context: supporting.join(" "),
    full_answer: full
  };
}

export function cardFacts(source) {
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source.facts : undefined;
  if (!Array.isArray(raw)) return [];
  const facts = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = String(item.label ?? "").trim();
    const value = String(item.value ?? "").trim();
    if (!label || !value) continue;
    const unit = String(item.unit ?? "").trim();
    facts.push(unit ? { label, value, unit } : { label, value });
    if (facts.length === 3) break;
  }
  return facts;
}

export function nameInitials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function titleCaseRole(role) {
  return String(role ?? "").trim().split(/\s+/).filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function repCard(name, role, available) {
  const cleaned = String(name ?? "").trim();
  if (!cleaned) return undefined;
  const first = cleaned.split(/\s+/)[0];
  const titled = titleCaseRole(role);
  return {
    name: cleaned,
    first_name: first,
    role: titled,
    title: titled,
    initials: nameInitials(cleaned),
    available: available === true,
    pronoun_subject: "they",
    pronoun_object: "them"
  };
}

function vendorCardFields(answer, subject) {
  const vendorName = subject.vendorName || "";
  const intentLabel = subject.intentLabel || "";
  const topic = subject.topic || (intentLabel ? intentLabel.toLowerCase() : "");
  const rep = repCard(subject.representativeName, subject.representativeRole, subject.available);
  const facts = cardFacts(answer);
  return {
    ...splitVendorAnswer(answer?.text ?? answer),
    source_label: intentLabel ? `${intentLabel} docs` : "Vendor docs",
    vendor_name: vendorName,
    vendor_initials: nameInitials(vendorName),
    topic,
    team: topic,
    ...(facts.length ? { facts } : {}),
    ...(rep ? { rep } : {}),
    user_question: subject.userQuestion || "",
    offer_id: subject.offerId || ""
  };
}

function consentMeta(meta, payload) {
  const nonce = typeof payload?.consentNonce === "string" ? payload.consentNonce.trim() : "";
  if (!nonce) return meta;
  return { ...meta, "supportbridge/consentNonce": nonce };
}

function vendorAnswerResult(payload) {
  const answer = payload.answer && typeof payload.answer === "object" ? payload.answer : { text: String(payload.answer ?? "") };
  if (payload.conversation?.id) {
    const conversation = payload.conversation;
    const spoken = splitVendorAnswer(answer?.text ?? answer);
    const name = conversation.representativeName || "support";
    return {
      content: [
        { type: "text", text: spoken.direct_answer || answer.text || "" },
        { type: "text", text: `You already have a live chat with ${name}. Opening that conversation.` }
      ],
      structuredContent: {
        answer,
        ...spoken,
        status: "accepted",
        offered: false,
        chatStarted: true,
        conversationId: conversation.id,
        conversation,
        representativeName: conversation.representativeName || "",
        representativeRole: conversation.representativeRole || "",
        vendorName: conversation.vendorName || "",
        offerId: conversation.offerId || "",
        offer_id: conversation.offerId || ""
      },
      _meta: uiMeta(CHAT_RESOURCE)
    };
  }
  if (payload.escalation && !payload.offer) {
    const note = payload.escalation;
    const copy = asyncEscalationCopy(note);
    const topic = topicPhrase(note.intent, note.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: note.vendorName,
      intentId: note.intent,
      intentLabel: note.intentLabel,
      topic,
      userQuestion: note.issueSummary,
      offerId: note.id,
      representativeName: payload.contact?.name,
      representativeRole: payload.contact?.role,
      available: payload.contact?.available === true
    });
    const known = fields.rep && fields.rep.available === false ? fields.rep : null;
    copy.suggestedMessage = known
      ? `${known.name} at ${note.vendorName || "the vendor"} is offline right now. You can leave them a note above and they'll follow up. In the meantime I can keep going on this.`
      : `Nobody from ${note.vendorName || "the vendor"}'s ${topic} team is online right now. You can leave them a note above and they'll follow up. In the meantime I can keep going on this.`;
    copy.acceptLabel = "Send note";
    return {
      content: [
        { type: "text", text: fields.direct_answer },
        { type: "text", text: copy.suggestedMessage }
      ],
      structuredContent: {
        answer,
        ...fields,
        kind: "escalation",
        state: "async",
        team: topic,
        assistance: { kind: "escalation", topic, ...(fields.rep ? { rep: fields.rep } : {}) },
        escalation: note,
        status: "awaiting_consent",
        offered: true,
        chatStarted: false,
        mode: "async_note",
        offerId: note.id,
        offer_id: note.id,
        escalationOfferId: note.id,
        intent: note.intent,
        intentLabel: note.intentLabel,
        issueSummary: note.issueSummary,
        vendorName: note.vendorName,
        expiresAt: note.expiresAt,
        ...copy
      },
      _meta: consentMeta(uiMeta(INTENT_OFFER_RESOURCE), payload)
    };
  }
  if (payload.offer?.source === "agent") {
    const offer = payload.offer;
    const topic = topicPhrase(offer.intent, offer.intentLabel);
    const fields = vendorCardFields(answer, {
      vendorName: offer.vendorName,
      intentId: offer.intent,
      intentLabel: offer.intentLabel,
      topic,
      userQuestion: offer.issueSummary,
      offerId: offer.id,
      available: false
    });
    const vendorLabel = offer.vendorName || "the vendor";
    const suggestedMessage = `Nobody from ${vendorLabel} is available right now. You can talk to the assistant if you want, and nothing starts until you choose to.`;
    return {
      content: [
        { type: "text", text: fields.direct_answer },
        { type: "text", text: suggestedMessage }
      ],
      structuredContent: {
        answer,
        ...fields,
        kind: "agent",
        assistance: { kind: "agent", topic },
        status: "offered",
        offered: true,
        chatStarted: false,
        offerId: offer.id,
        offer_id: offer.id,
        intent: offer.intent,
        intentLabel: offer.intentLabel,
        issueSummary: offer.issueSummary,
        vendorName: offer.vendorName,
        expiresAt: offer.expiresAt,
        acceptTool: "talk_to_vendor_agent",
        declineTool: "decline_assistance",
        acceptLabel: "Talk to the assistant",
        declineLabel: "Not now",
        suggestedMessage
      },
      _meta: uiMeta(INTENT_OFFER_RESOURCE)
    };
  }
  if (payload.offer) {
    const offer = payload.offer;
    const copy = liveOfferCopy(offer);
    const firstName = String(offer.representativeName || "").trim().split(/\s+/)[0];
    const topic = topicPhrase(offer.intent, offer.intentLabel);
    copy.acceptLabel = firstName ? `Chat with ${firstName}` : "Chat with support";
    copy.declineLabel = "Not now";
    copy.cardNote = consentNote(offer.issueSummary, copy.acceptLabel);
    const fields = vendorCardFields(answer, {
      vendorName: offer.vendorName,
      representativeName: offer.representativeName,
      representativeRole: offer.representativeRole,
      intentId: offer.intent,
      intentLabel: offer.intentLabel,
      topic,
      userQuestion: offer.issueSummary,
      offerId: offer.id,
      available: true
    });
    const assistance = assistanceFromOffer(offer);
    assistance.kind = "live";
    assistance.topic = topic;
    return {
      content: [
        { type: "text", text: fields.direct_answer },
        { type: "text", text: copy.suggestedMessage }
      ],
      structuredContent: {
        answer,
        ...fields,
        kind: "live",
        state: "live",
        ...(firstName ? { first_name: firstName } : {}),
        assistance,
        status: "offered",
        offered: true,
        chatStarted: false,
        offerId: offer.id,
        offer_id: offer.id,
        intent: offer.intent,
        intentLabel: offer.intentLabel,
        issueSummary: offer.issueSummary,
        representativeName: offer.representativeName,
        representativeRole: offer.representativeRole,
        vendorName: offer.vendorName,
        expiresAt: offer.expiresAt,
        ...copy
      },
      _meta: consentMeta({
        ...uiMeta(INTENT_OFFER_RESOURCE),
        "supportbridge/offer": {
          offerId: offer.id,
          offer_id: offer.id,
          vendorName: offer.vendorName,
          representativeName: offer.representativeName,
          representativeRole: offer.representativeRole
        }
      }, payload)
    };
  }
  const spoken = splitVendorAnswer(answer.text).direct_answer || answer.text;
  return {
    content: [{ type: "text", text: spoken }],
    structuredContent: { answer, full_answer: answer.text }
  };
}

export function assistanceFromOffer(offer) {
  const assistance = { offerId: offer.id };
  if (offer.intent) assistance.intent = offer.intent;
  assistance.representative = {
    name: offer.representativeName || "",
    role: offer.representativeRole || ""
  };
  assistance.vendor = offer.vendorName || "";
  assistance.status = "available";
  assistance.suggestedMessage = suggestedAssistanceMessage(offer);
  return assistance;
}

const STALE_PRICE_LIST = /This connector has no public price list\.[\s\S]*$/;
const PREVIOUS_CALL_INSTRUCTION = /Call offer_assistance when the user asks about a topic it covers\.[\s\S]*$/;

function publishServerInstructions(server) {
  const protocol = server?.server;
  if (!protocol || typeof protocol !== "object") return;
  let current = typeof protocol._instructions === "string" ? protocol._instructions.trim() : "";
  if (current.includes(SERVER_INSTRUCTIONS)) return;
  if (STALE_PRICE_LIST.test(current)) current = current.replace(STALE_PRICE_LIST, "").trim();
  if (PREVIOUS_CALL_INSTRUCTION.test(current)) current = current.replace(PREVIOUS_CALL_INSTRUCTION, "").trim();
  if (!current) {
    protocol._instructions = SERVER_INSTRUCTIONS;
    return;
  }
  if (/next tool call|Do not call|Do not ask|Do not say|Do not mention/.test(current)) {
    protocol._instructions = SERVER_INSTRUCTIONS;
    return;
  }
  protocol._instructions = `${current} ${SERVER_INSTRUCTIONS}`;
}

export function SupportBridge() {}

SupportBridge.install = function install(server, options) {
  if (!options?.apiKey) throw new Error("api_key_required");
  publishServerInstructions(server);
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  void serviceFetch(baseUrl, options.apiKey, "/v1/install", {
    method: "POST",
    body: { source: options.source ?? "mcp", sdkVersion: SDK_VERSION }
  });
  const vendorLabel = String(options.vendorName ?? "").trim() || "this vendor";
  const identify = options.identify ?? identifyFromContext;
  let mintedSessionId = "";
  const mintSessionId = () => {
    if (!mintedSessionId) mintedSessionId = `mcp_${randomUUID()}`;
    return mintedSessionId;
  };
  const callerIdentity = context => identityOf(identify, context, mintSessionId);
  const appHtml = options.appHtml ?? {};
  const toolMetaByName = new Map();
  if (typeof server.registerTool === "function") {
    const registerTool = server.registerTool.bind(server);
    server.registerTool = (name, config, handler) => {
      const toolName = String(name ?? "");
      if (toolName) {
        const title = cleanToolTitle(config?.title);
        const description = cleanToolDescription(config?.description);
        toolMetaByName.set(toolName, {
          ...(title ? { title } : {}),
          ...(description ? { description } : {})
        });
      }
      return registerTool(name, config, handler);
    };
  }

  const chatMeta = uiMeta(CHAT_RESOURCE);
  const intentOfferMeta = uiMeta(INTENT_OFFER_RESOURCE);
  const appOnlyChatMeta = appOnlyMeta();

  const answerTool = async (args, extra) => {
    const topic = String(args?.topic ?? args?.intent ?? "").trim();
    const question = String(args?.question ?? args?.issueSummary ?? args?.issue_summary ?? "").trim();
    if (!topic || !question) {
      return {
        isError: true,
        content: [{ type: "text", text: "Call get_vendor_answer with the topic and the user's question. Do not guess a price or plan, and do not contact anyone." }],
        structuredContent: { status: "question_required" }
      };
    }
    const body = {
      ...await callerIdentity(extra),
      topic,
      question,
      ...(args?.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : {})
    };
    let result = await serviceFetch(baseUrl, options.apiKey, "/v1/answers", { method: "POST", body });
    if (answerNeedsRetry(result)) {
      result = await serviceFetch(baseUrl, options.apiKey, "/v1/answers", { method: "POST", body });
    }
    if (result == null) return serviceUnreachableResult();
    if (!result?.answer) {
      return {
        isError: true,
        content: [{ type: "text", text: "The vendor answer could not be loaded. Tell the user the company's answer is unavailable right now. Do not guess a price or plan, and do not contact anyone." }],
        structuredContent: { status: result?.error ?? "answer_unavailable" }
      };
    }
    return vendorAnswerResult(result);
  };

  server.registerTool("get_vendor_answer", {
    title: "Vendor answer",
    description: vendorAnswerDescription(vendorLabel),
    inputSchema: z.object({
      topic: z.string().min(1).max(80).describe(`The closest topic to what the user asked. Preferred ids: ${ASSISTANCE_INTENT_IDS.join(", ")}.`),
      question: z.string().min(1).max(2_000).describe("The user's question, in a sentence or two."),
      intent: looseField("Alias of topic."),
      issueSummary: looseField("Alias of question.")
    }).passthrough(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: intentOfferMeta
  }, answerTool);

  server.registerTool("talk_to_vendor_agent", {
    title: "Talk to the vendor assistant",
    description: "Sends a message in the vendor assistant chat after the customer chooses Talk to the assistant. Pass the offer id and the message.",
    inputSchema: z.object({
      offerId: z.string().optional(),
      offer_id: z.string().optional(),
      text: z.string().max(2_000).optional()
    }).passthrough(),
    _meta: appOnlyMeta()
  }, async (args, extra) => {
    const result = await serviceFetch(baseUrl, options.apiKey, "/v1/agent-chat", {
      method: "POST",
      body: {
        ...await callerIdentity(extra),
        offerId: normalizeOfferArgs(args).offerId,
        text: args?.text
      }
    });
    if (result == null) return serviceUnreachableResult();
    if (!result?.reply) {
      return {
        isError: true,
        content: [{ type: "text", text: "The vendor assistant could not reply. No person was contacted." }],
        structuredContent: { status: result?.error ?? "agent_unavailable" }
      };
    }
    return {
      content: [{ type: "text", text: result.reply }],
      structuredContent: result
    };
  });

  server.registerTool("confirm_assistance", {
    title: "Confirm assistance",
    description: CONFIRM_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: chatMeta
  }, async (args, extra) => confirmAssistance(baseUrl, options.apiKey, await callerIdentity(extra), normalizeOfferArgs(args).offerId, noteArg(args), args?.consentNonce));

  server.registerTool("file_escalation", {
    title: "File escalation",
    description: "Files an async note the customer agreed to send when no representative was available. Pass the escalationOfferId from that offer. Does not start a chat.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyMeta()
  }, async (args, extra) => fileEscalation(baseUrl, options.apiKey, await callerIdentity(extra), normalizeOfferArgs(args).offerId, args?.note, args?.consentNonce));

  server.registerTool("decline_escalation", {
    title: "Decline escalation",
    description: "Declines an async note offer. Pass the escalationOfferId. Does not contact anyone.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyMeta()
  }, async (args, extra) => declineEscalation(baseUrl, options.apiKey, await callerIdentity(extra), normalizeOfferArgs(args).offerId));

  server.registerTool("decline_assistance", {
    title: "Decline assistance",
    description: DECLINE_ASSISTANCE_DESCRIPTION,
    inputSchema: OFFER_CONNECT_INPUT
  }, async (args, extra) => declineOffer(baseUrl, options.apiKey, await callerIdentity(extra), normalizeOfferArgs(args).offerId));

  server.registerTool("support_get_messages", {
    title: "Get assistance messages",
    description: "Reads assistance chat messages after a cursor. Used by the open chat.",
    inputSchema: {
      conversation_id: z.string(),
      after: z.number().optional()
    },
    _meta: appOnlyChatMeta
  }, async (args, extra) => pollMessages(baseUrl, options.apiKey, await callerIdentity(extra), args));

  server.registerTool("support_send_message", {
    title: "Send assistance message",
    description: "Sends a customer message in an accepted assistance conversation. Used by the open chat.",
    inputSchema: {
      conversation_id: z.string(),
      text: z.string(),
      client_message_id: z.string()
    },
    _meta: appOnlyChatMeta
  }, async (args, extra) => sendCustomerMessage(baseUrl, options.apiKey, await callerIdentity(extra), args));

  server.registerTool("support_end_session", {
    title: "End assistance session",
    description: "Ends an assistance conversation. Used by the open chat.",
    inputSchema: { conversation_id: z.string() },
    _meta: appOnlyChatMeta
  }, async (args, extra) => endCustomerConversation(baseUrl, options.apiKey, await callerIdentity(extra), args?.conversation_id));

  server.registerTool("support_get_offer", {
    title: "Get assistance offer",
    description: "Reads whether an assistance offer already has a chat. Used by the offer card when it reopens.",
    inputSchema: OFFER_CONNECT_INPUT,
    _meta: appOnlyChatMeta
  }, async (args, extra) => readCustomerOffer(baseUrl, options.apiKey, await callerIdentity(extra), normalizeOfferArgs(args).offerId));

  registerResource(server, "Within chat", CHAT_RESOURCE, appHtml.chat ?? chatHtml());
  registerResource(server, "Within assistance offer", INTENT_OFFER_RESOURCE, appHtml.intentOffer ?? intentOfferHtml());

  const preserveToolDescription = wrapTool;
  const installation = {
    instructions: SERVER_INSTRUCTIONS,
    instrumentTool(toolName, handler) {
      return async (args, extra) => {
        const started = Date.now();
        let result;
        let outcome = "success";
        let errorText = "";
        let thrown;
        try {
          result = await handler(args, extra);
          if (result?.isError) {
            outcome = "error";
            const part = Array.isArray(result.content) ? result.content.find(row => row?.type === "text" && row.text) : null;
            errorText = sanitizeError(part?.text ?? "tool_error");
          }
        } catch (cause) {
          outcome = "error";
          errorText = sanitizeError(cause?.message ?? "error");
          thrown = cause;
        }
        const identity = await callerIdentity(extra);
        const meta = toolMetaByName.get(String(toolName)) ?? {};
        const tokens = safeArgumentTokens(args);
        const preview = argumentPreview(args);
        const reply = outcome === "success" ? resultText(result) : "";
        const activity = reportActivity(baseUrl, options.apiKey, {
          source: options.source ?? "mcp",
          sdkVersion: SDK_VERSION,
          ...identity,
          toolName,
          outcome,
          durationMs: Date.now() - started,
          tokens,
          summary: summarizeArguments(tokens),
          ...(preview ? { argumentPreview: preview } : {}),
          ...(reply ? { resultText: reply } : {}),
          ...(meta.title ? { title: meta.title } : {}),
          ...(meta.description ? { description: meta.description } : {}),
          ...(errorText ? { error: errorText } : {})
        });
        if (thrown || result?.isError) {
          void activity;
          if (thrown) throw thrown;
          return result;
        }
        // Business-intent cards come only from get_vendor_answer. Do not scan
        // tool arguments here or attach an intent card onto a business result.
        const delivered = await deliverOffer(baseUrl, options.apiKey, identity);
        if (delivered == null) {
          void activity;
          return unreachableVendorResult(result);
        }
        await activity;
        if (!delivered.offer) return result;
        // Skip re-attach when deliver reports an already-presented offer (new servers).
        // Older servers omit newlyPresented; treat that as "attach once" like before.
        if (delivered.newlyPresented === false) return result;
        return attachInvitation(result, delivered.offer);
      };
    },
    wrapTool(tool, wrapOptions = {}) {
      const defined = preserveToolDescription(tool, wrapOptions);
      if (tool && typeof tool.handler === "function") {
        defined.handler = installation.instrumentTool(String(tool.name ?? ""), tool.handler);
      }
      return defined;
    }
  };
  return installation;
};

/** Manual offer: one text line plus structured assistance. No card and no buttons. */
export function attachInvitation(result, offer) {
  const assistance = assistanceFromOffer(offer);
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  content.push({ type: "text", text: assistance.suggestedMessage });
  const structuredContent = {
    ...(result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {}),
    assistance
  };
  const next = { ...result, content, structuredContent };
  delete next._meta;
  return next;
}

function uiMeta(resourceUri) {
  const offerFrame = resourceUri === INTENT_OFFER_RESOURCE ? { width: 480, height: 640 } : null;
  return {
    ui: {
      resourceUri,
      visibility: ["model", "app"],
      ...(offerFrame ? { preferredFrameSize: offerFrame } : {})
    },
    "ui/resourceUri": resourceUri,
    "openai/outputTemplate": resourceUri,
    "openai/widgetAccessible": true
  };
}

/** Callable from the open chat, with no transcript card of its own. */
function appOnlyMeta() {
  return {
    ui: { visibility: ["app"] },
    "openai/widgetAccessible": true
  };
}

function registerResource(server, name, uri, html) {
  const meta = resourceMeta(uri);
  server.registerResource(name, uri, {
    mimeType: APP_MIME,
    description: name,
    _meta: meta
  }, async () => ({
    contents: [{
      uri,
      mimeType: APP_MIME,
      text: html,
      _meta: meta
    }]
  }));
}

function resourceMeta(resourceUri) {
  const frame = { width: 480, height: resourceUri === INTENT_OFFER_RESOURCE ? 640 : 320 };
  return {
    ui: { preferredFrameSize: frame, prefersBorder: true },
    "ui/resourceUri": resourceUri,
    "openai/outputTemplate": resourceUri,
    "openai/widgetAccessible": true,
    "openai/widgetPrefersBorder": true
  };
}

const PLACEHOLDER_IDS = new Set(["anonymous", "customer-from-your-auth", "session-from-your-auth"]);
const PLACEHOLDER_NAMES = new Set(["customer name"]);

/** Read the signed-in person from an MCP tool context. A missing name stays unset. */
export function identifyFromContext(context) {
  const extra = context && typeof context === "object" ? context : {};
  const authExtra = extra.authInfo?.extra && typeof extra.authInfo.extra === "object" ? extra.authInfo.extra : {};
  const meta = extra._meta && typeof extra._meta === "object" ? extra._meta : {};
  const metaUser = meta["openai/user"] && typeof meta["openai/user"] === "object" ? meta["openai/user"] : {};
  const subject = firstText([authExtra.sub, authExtra.user_id, authExtra.userId, metaUser.id, meta["openai/subject"]]);
  return {
    userId: firstText([verifiedEmail(authExtra), subject]),
    authUserId: subject,
    sessionId: firstText([extra.sessionId, meta.sessionId]),
    displayName: firstText([authExtra.name, authExtra.preferred_username, metaUser.name])
  };
}

function verifiedEmail(authExtra) {
  const verified = authExtra.emailVerified === true
    || authExtra.email_verified === true
    || authExtra.email_verified === "true";
  if (!verified) return "";
  const email = firstText([authExtra.email]).toLowerCase();
  return email.includes("@") ? email : "";
}

function firstText(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function usableIdentity(value, placeholders) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || placeholders.has(text.toLowerCase())) return "";
  return text;
}

async function identityOf(identify, context, mintSessionId) {
  const provided = await identify(context ?? {}) ?? {};
  const fromContext = identify === identifyFromContext ? {} : identifyFromContext(context);
  const displayName = usableIdentity(provided.displayName, PLACEHOLDER_NAMES) || fromContext.displayName;
  const authUserId = usableIdentity(provided.authUserId, PLACEHOLDER_IDS) || usableIdentity(fromContext.authUserId, PLACEHOLDER_IDS);
  const customerUserId = usableIdentity(provided.userId ?? provided.customerUserId, PLACEHOLDER_IDS) || usableIdentity(fromContext.userId, PLACEHOLDER_IDS);
  const customerSessionId = usableIdentity(provided.sessionId ?? provided.customerSessionId, PLACEHOLDER_IDS)
    || usableIdentity(fromContext.sessionId, PLACEHOLDER_IDS)
    || (typeof mintSessionId === "function" ? mintSessionId() : `mcp_${randomUUID()}`);
  return {
    customerSessionId,
    ...(customerUserId ? { customerUserId } : {}),
    ...(authUserId ? { authUserId } : {}),
    ...(displayName ? { displayName } : {})
  };
}

async function reportActivity(baseUrl, apiKey, body) {
  await serviceFetch(baseUrl, apiKey, "/v1/activity", { method: "POST", body });
}

async function deliverOffer(baseUrl, apiKey, identity) {
  return serviceFetch(baseUrl, apiKey, "/v1/offers/deliver", { method: "POST", body: identity });
}

function answerNeedsRetry(result) {
  if (result?.answer) return false;
  if (result == null) return true;
  return Number(result.status) >= 500;
}

function noteArg(args) {
  const note = String(args?.note ?? "").trim();
  return note ? note.slice(0, 2000) : "";
}

function consentBody(value) {
  const nonce = typeof value === "string" ? value.trim() : "";
  return nonce ? { consentNonce: nonce } : {};
}

async function acceptOffer(baseUrl, apiKey, identity, offerId, note, consentNonce) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/offers/${encodeURIComponent(offerId)}/accept`, {
    method: "POST",
    body: { ...identity, ...consentBody(consentNonce), ...(note ? { note } : {}) }
  });
  if (result == null) return serviceUnreachableResult();
  if (!result?.conversation) {
    const status = result?.error ?? "offer_not_active";
    return {
      content: [{
        type: "text",
        text: status === "representative_unavailable"
          ? "No representative is available right now. No chat has started."
          : status === "offer_expired"
            ? "That assistance offer has expired. No chat has started. Ask to connect again if you still want support."
            : status === "offer_not_found"
              ? "That assistance offer was not found. No chat has started."
              : "The assistance offer could not be accepted. No chat has started."
      }],
      structuredContent: { status, chatStarted: false },
      isError: true
    };
  }
  return {
    content: [{
      type: "text",
      text: `You are connected with ${result.offer.representativeName || result.offer.vendorName || "support"}.`
    }],
    structuredContent: {
      status: "accepted",
      chatStarted: true,
      conversationId: result.conversation.id,
      representativeName: result.offer.representativeName,
      representativeRole: result.offer.representativeRole || result.conversation.representativeRole,
      vendorName: result.offer.vendorName || result.conversation.vendorName,
      messages: []
    }
  };
}

function needsOfferAssistanceResult(message) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { status: "offer_required", chatStarted: false, offered: false }
  };
}

async function confirmAssistance(baseUrl, apiKey, identity, offerId, note, consentNonce) {
  if (offerId) return acceptOffer(baseUrl, apiKey, identity, offerId, note, consentNonce);
  const delivered = await deliverOffer(baseUrl, apiKey, identity);
  if (delivered == null) return serviceUnreachableResult();
  const open = delivered?.offer;
  if (open && (open.status === "pending" || open.status === "presented") && open.source === "manual") {
    return acceptOffer(baseUrl, apiKey, identity, open.id, note, consentNonce);
  }
  return needsOfferAssistanceResult(
    "No pending assistance offer was found for this session. Call get_vendor_answer with the topic and the user's question first. Then confirm with that offer id."
  );
}

async function readCustomerOffer(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return { structuredContent: { status: "offer_id_required", chatStarted: false } };
  }
  const result = await serviceFetch(
    baseUrl,
    apiKey,
    `/v1/offers/${encodeURIComponent(offerId)}?${identityQuery(identity)}`
  );
  if (result == null) return serviceUnreachableResult();
  const conversation = result?.conversation;
  return {
    structuredContent: {
      status: result?.offer?.status ?? result?.error ?? "offer_not_found",
      offerId: result?.offer?.id ?? offerId,
      chatStarted: Boolean(conversation?.id),
      conversationId: conversation?.id,
      representativeName: conversation?.representativeName || result?.offer?.representativeName,
      conversation
    }
  };
}

async function declineOffer(baseUrl, apiKey, identity, offerId) {
  if (!offerId) {
    return {
      content: [{
        type: "text",
        text: "An offer id is required to decline assistance. Pass offerId or offer_id from the assistance card or invitation."
      }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const result = await serviceFetch(baseUrl, apiKey, `/v1/offers/${encodeURIComponent(offerId)}/decline`, {
    method: "POST",
    body: identity
  });
  if (result == null) return serviceUnreachableResult();
  if (!result?.offer || result.offer.status !== "declined") {
    return {
      content: [{ type: "text", text: "The assistance offer could not be declined." }],
      structuredContent: { status: result?.error ?? "offer_not_active", chatStarted: false },
      isError: true
    };
  }
  return {
    content: [{ type: "text", text: "Assistance declined. No chat was started." }],
    structuredContent: { status: "declined", chatStarted: false }
  };
}

async function fileEscalation(baseUrl, apiKey, identity, escalationId, note, consentNonce) {
  if (!escalationId) {
    return {
      content: [{ type: "text", text: "An escalation offer id is required to send the note." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const result = await serviceFetch(baseUrl, apiKey, `/v1/escalations/${encodeURIComponent(escalationId)}/file`, {
    method: "POST",
    body: { ...identity, ...consentBody(consentNonce), ...(note ? { note: String(note).slice(0, 2000) } : {}) }
  });
  if (result == null) return serviceUnreachableResult();
  if (result?.escalation?.status === "pending") {
    return {
      content: [{ type: "text", text: "Note sent. No chat was started." }],
      structuredContent: { status: "pending", chatStarted: false, mode: "async_note", escalation: result.escalation }
    };
  }
  const status = result?.error ?? "escalation_not_active";
  return {
    content: [{
      type: "text",
      text: status === "escalation_expired"
        ? "That note offer has expired. No note was sent."
        : "The note could not be sent."
    }],
    structuredContent: { status, chatStarted: false },
    isError: true
  };
}

async function declineEscalation(baseUrl, apiKey, identity, escalationId) {
  if (!escalationId) {
    return {
      content: [{ type: "text", text: "An escalation offer id is required to decline the note." }],
      structuredContent: { status: "offer_id_required", chatStarted: false }
    };
  }
  const result = await serviceFetch(baseUrl, apiKey, `/v1/escalations/${encodeURIComponent(escalationId)}/decline`, {
    method: "POST",
    body: identity
  });
  if (result == null) return serviceUnreachableResult();
  if (result?.escalation?.status === "declined") {
    return {
      content: [{ type: "text", text: "Note declined. No one was contacted." }],
      structuredContent: { status: "declined", chatStarted: false, mode: "async_note" }
    };
  }
  return {
    content: [{ type: "text", text: "The note offer could not be declined." }],
    structuredContent: { status: result?.error ?? "escalation_not_active", chatStarted: false },
    isError: true
  };
}

function identityQuery(identity) {
  const sessionId = encodeURIComponent(identity?.customerSessionId ?? "");
  const userId = encodeURIComponent(identity?.customerUserId ?? "");
  return `customerSessionId=${sessionId}&customerUserId=${userId}`;
}

function visibleMessage(message) {
  return {
    id: message?.id,
    sender: message?.sender,
    senderName: message?.senderName ?? null,
    text: message?.text,
    cursor: message?.cursor,
    createdAt: message?.createdAt,
    clientMessageId: message?.clientMessageId ?? null
  };
}

async function pollMessages(baseUrl, apiKey, identity, args) {
  const after = Number(args?.after) || 0;
  const result = await serviceFetch(
    baseUrl,
    apiKey,
    `/v1/conversations/${encodeURIComponent(args.conversation_id)}/messages?after=${after}&${identityQuery(identity)}`
  );
  if (result == null) {
    return {
      content: [{ type: "text", text: "The service is unreachable." }],
      structuredContent: {
        messages: [],
        cursor: 0,
        status: "service_unreachable",
        representativeName: "",
        conversationId: args.conversation_id,
        chatStarted: false
      }
    };
  }
  if (!Array.isArray(result.messages)) {
    return {
      content: [{ type: "text", text: "No conversation is available." }],
      structuredContent: {
        messages: [],
        cursor: 0,
        status: result.error || "unavailable",
        representativeName: "",
        conversationId: args.conversation_id,
        chatStarted: false
      }
    };
  }
  const conversation = result.conversation && typeof result.conversation === "object" ? result.conversation : {};
  const status = conversation.status || (typeof result.status === "string" ? result.status : "") || "";
  const representativeName = conversation.representativeName || "";
  const messages = result.messages.map(visibleMessage);
  const cursor = typeof result.cursor === "number" ? result.cursor : (messages.at(-1)?.cursor ?? after);
  return {
    content: [{ type: "text", text: transcript({ messages }) }],
    structuredContent: {
      messages,
      cursor,
      status,
      representativeName,
      conversationId: args.conversation_id,
      chatStarted: Boolean(conversation.id) && status !== "ended"
    }
  };
}

async function sendCustomerMessage(baseUrl, apiKey, identity, args) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/conversations/${encodeURIComponent(args.conversation_id)}/messages`, {
    method: "POST",
    body: { ...identity, text: args.text, clientMessageId: args.client_message_id }
  });
  if (result == null) return serviceUnreachableResult();
  if (!result?.message) {
    return {
      content: [{ type: "text", text: "The message was not sent." }],
      isError: true,
      structuredContent: { status: result?.error ?? "not_sent" }
    };
  }
  return {
    content: [{ type: "text", text: "Message sent." }],
    structuredContent: { status: "sent", message: result.message, created: result.created, conversationId: args.conversation_id }
  };
}

async function endCustomerConversation(baseUrl, apiKey, identity, conversationId) {
  const result = await serviceFetch(baseUrl, apiKey, `/v1/conversations/${encodeURIComponent(conversationId)}/end`, {
    method: "POST",
    body: identity
  });
  if (result == null) return serviceUnreachableResult();
  if (!result?.conversation) {
    return {
      content: [{ type: "text", text: "The conversation could not be ended." }],
      isError: true,
      structuredContent: { status: result?.error ?? "not_ended", conversationId }
    };
  }
  return {
    content: [{ type: "text", text: "The conversation has ended." }],
    structuredContent: { status: "ended", conversationId, conversation: result.conversation }
  };
}

function transcript(result) {
  if (!result?.messages) return "No conversation is available.";
  if (!result.messages.length) return "No new messages.";
  return result.messages.map(message => `${message.sender}: ${message.text}`).join("\n");
}

const SERVICE_TIMEOUT_MS = 5_000;

function serviceUnreachableResult() {
  return {
    isError: true,
    content: [{ type: "text", text: "The service is unreachable." }],
    structuredContent: { status: "service_unreachable", chatStarted: false }
  };
}

function unreachableVendorResult(result) {
  const content = Array.isArray(result?.content) ? [...result.content] : [];
  content.push({ type: "text", text: "The service is unreachable." });
  const structuredContent = {
    ...(result?.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : {}),
    status: "service_unreachable"
  };
  return {
    ...(result && typeof result === "object" ? result : {}),
    content,
    structuredContent
  };
}

async function serviceFetch(baseUrl, apiKey, path, { method = "GET", body } = {}) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { error: payload.error ?? "request_failed", status: response.status };
    return payload;
  } catch {
    return null;
  }
}

function chatPanelStyles() {
  return `#header{
  display:flex;align-items:center;gap:12px;flex:none;
  padding:16px 16px 12px;border-bottom:1px solid #E8E8E2;background:#FAFAF7;
}
.presence{
  width:8px;height:8px;border-radius:50%;flex:none;background:#2F7D4F;
  box-shadow:0 0 0 3px rgba(47,125,79,.16);
}
.presence.ended{background:#9A9A91;box-shadow:none}
.header-copy{min-width:0;flex:1}
#title{
  margin:0;font:600 15px/20px Inter,"Segoe UI",system-ui,sans-serif;
  letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#subtitle{
  margin:2px 0 0;color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
#end{
  flex:none;margin:0;padding:6px 8px;border:0;background:transparent;
  color:#6B6B62;font:500 13px/18px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;
}
#end:hover:not(:disabled){color:#1C1C19}
#end:disabled{opacity:.45;cursor:not-allowed}
#log{
  flex:1;min-height:160px;overflow:auto;overscroll-behavior:contain;
  padding:16px;display:flex;flex-direction:column;gap:0;
}
#send-status{margin:0;padding:0 16px;color:#A32D2D;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif}
#send-status:empty{display:none}
.chat-empty{
  margin:auto;max-width:28ch;text-align:center;color:#6B6B62;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
.message{display:flex;width:fit-content;max-width:78%;margin:0 0 12px}
.message.representative{margin-left:auto}
.message.system{width:100%;max-width:none;margin:16px 0;justify-content:center}
.message-content{display:flex;flex-direction:column;min-width:0;max-width:100%}
.message-who,.message-time{
  color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.message-who{margin:0 0 4px}
.message-time{margin:4px 0 0}
.message.representative .message-content{align-items:flex-end}
.bubble{
  width:fit-content;max-width:100%;margin:0;padding:10px 12px;
  border-radius:4px 16px 16px 16px;border:1px solid #E4D9C4;
  background:#FBF6EC;color:#1C1C19;white-space:pre-wrap;overflow-wrap:anywhere;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
.message.representative .bubble{
  border:0;border-radius:16px 4px 16px 16px;background:#2F7D4F;color:#fff;
}
.system-line{
  display:flex;align-items:center;gap:8px;width:100%;
  color:#6B6B62;text-align:center;
  font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.system-line::before,.system-line::after{content:"";flex:1;min-width:16px;height:1px;background:#E8E8E2}
.system-line span{max-width:70%;overflow-wrap:anywhere}
#composer{
  flex:none;padding:12px 16px 16px;border-top:1px solid #E8E8E2;background:#FAFAF7;
}
.composer-shell{
  display:flex;align-items:center;gap:8px;
  padding:4px 4px 4px 14px;border:1px solid #D5D5CD;border-radius:999px;background:#fff;
  transition:border-color .15s ease,box-shadow .15s ease;
}
.composer-shell:focus-within{border-color:#2F7D4F;box-shadow:0 0 0 3px rgba(47,125,79,.12)}
.composer-shell.disabled{opacity:.55;background:#F4F4F0}
#text{
  flex:1;min-width:0;margin:0;padding:8px 0;border:0;outline:0;background:transparent;
  color:#1C1C19;font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
#text::placeholder{color:#9A9A91}
#text:disabled{cursor:not-allowed}
#send{
  flex:none;display:inline-grid;place-items:center;width:36px;height:36px;margin:0;padding:0;
  border:0;border-radius:50%;background:#1C1C19;color:#fff;cursor:pointer;
}
#send:hover:not(:disabled){background:#3A3A35}
#send:disabled{opacity:.4;cursor:not-allowed}
#send svg{display:block}
:where(button,input):focus-visible{outline:2px solid #2F7D4F;outline-offset:2px}`;
}

function chatMarkup() {
  return `<header id="header">
  <span id="presence" class="presence" aria-hidden="true"></span>
  <div class="header-copy">
    <h1 id="title">Live chat</h1>
    <p id="subtitle">Connecting…</p>
  </div>
  <button id="end" type="button" aria-label="End chat">End</button>
</header>
<div id="log" role="log"></div>
<div id="chat-announcer" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"></div>
<div id="send-status" role="alert"></div>
<form id="composer" autocomplete="off">
  <div class="composer-shell" id="shell">
    <input id="text" name="text" autocomplete="off" placeholder="Write a message" aria-label="Message">
    <button id="send" type="submit" aria-label="Send">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</form>`;
}

function chatClientScript() {
  return `
let conversationId="";
let cursor=0;
let representativeName="";
let representativeRole="";
let vendorName="";
let ended=false;
let chatStarted=false;
let pollTimer=null;
let pollDelay=2000;
let threadMessages=[];
let paintSignature="";
let announcedIds="";
let sending=false;
let pendingClientId="";
let endArmed=false;
let logEl,titleEl,subtitleEl,presenceEl,textEl,sendEl,endEl,shellEl,sendStatusEl;
function bindChatElements(){
  logEl=document.getElementById("log");
  titleEl=document.getElementById("title");
  subtitleEl=document.getElementById("subtitle");
  presenceEl=document.getElementById("presence");
  textEl=document.getElementById("text");
  sendEl=document.getElementById("send");
  endEl=document.getElementById("end");
  shellEl=document.getElementById("shell");
  sendStatusEl=document.getElementById("send-status");
}
function stopPolling(){
  if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
}
function setSendStatus(text){
  if(sendStatusEl) sendStatusEl.textContent=text||"";
}
function escapeText(value){
  return String(value==null?"":value);
}
function formatTime(value){
  if(!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  return date.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
}
function headerSubtitle(){
  if(ended)return "Conversation ended";
  if(!representativeName)return "Connecting…";
  const role=String(representativeRole||"").trim();
  const company=String(vendorName||"").trim();
  const roleLabel=role?role.charAt(0).toUpperCase()+role.slice(1):"";
  if(roleLabel&&company)return roleLabel+" | "+company;
  if(roleLabel)return roleLabel;
  if(company)return company;
  return "Live assistance";
}
function rememberPerson(source){
  if(!source)return;
  if(source.representativeName)representativeName=source.representativeName;
  if(source.representativeRole)representativeRole=source.representativeRole;
  if(source.vendorName)vendorName=source.vendorName;
}
function setHeader(){
  titleEl.textContent=representativeName||"Live chat";
  subtitleEl.textContent=headerSubtitle();
  presenceEl.classList.toggle("ended",ended);
}
function setComposerEnabled(enabled){
  textEl.disabled=!enabled;
  sendEl.disabled=!enabled;
  endEl.disabled=!enabled||!conversationId;
  shellEl.classList.toggle("disabled",!enabled);
  textEl.placeholder=enabled?"Write a message":"Conversation ended";
}
function paint(messages){
  const rows=Array.isArray(messages)?messages:[];
  const signature=rows.map((message,index)=>(message.id||index)+"|"+(message.sender||"")+"|"+(message.text||"")).join("\\n");
  const nearBottom=!logEl.scrollHeight||logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight<48;
  if(signature===paintSignature) return;
  paintSignature=signature;
  logEl.replaceChildren();
  if(!rows.length){
    const empty=document.createElement("p");
    empty.className="chat-empty";
    empty.textContent=representativeName?"You're connected. Send a message to begin.":"No messages yet.";
    logEl.append(empty);
    return;
  }
  for(const message of rows){
    const sender=message.sender||"";
    if(sender==="system"){
      const row=document.createElement("div");
      row.className="message system";
      const line=document.createElement("div");
      line.className="system-line";
      const span=document.createElement("span");
      span.textContent=escapeText(String(message.text||"").replace(/^(.*? is connected)\\. No messages were sent before you accepted\\. You can end this chat at any time\\.$/,"$1."));
      line.append(span);
      row.append(line);
      logEl.append(row);
      continue;
    }
    const isRep=sender==="representative";
    const previous=rows[rows.indexOf(message)-1];
    const next=rows[rows.indexOf(message)+1];
    const sameSender=(other)=>other&&other.sender===sender&&other.sender!=="system";
    const row=document.createElement("div");
    row.className="message "+(isRep?"representative":"customer");
    const content=document.createElement("div");
    content.className="message-content";
    if(!sameSender(previous)){
      const who=document.createElement("div");
      who.className="message-who";
      const fallback=isRep?(representativeName||vendorName||"Support"):"You";
      who.textContent=escapeText(message.senderName)||fallback;
      content.append(who);
    }
    const bubble=document.createElement("div");
    bubble.className="bubble";
    bubble.textContent=escapeText(message.text);
    content.append(bubble);
    if(!sameSender(next)){
      const time=formatTime(message.createdAt);
      if(time){
        const stamp=document.createElement("div");
        stamp.className="message-time";
        stamp.textContent=time;
        content.append(stamp);
      }
    }
    row.append(content);
    logEl.append(row);
  }
  if(nearBottom) logEl.scrollTop=logEl.scrollHeight;
  const ids=rows.map(message=>String(message.id||"")).join(",");
  const previous=announcedIds?announcedIds.split(","):[];
  const fresh=previous.length?rows.filter(message=>message.id&&message.sender!=="system"&&!previous.includes(String(message.id))):[];
  announcedIds=ids;
  const live=document.getElementById("chat-announcer");
  if(live&&fresh.length){
    const note=fresh.length===1?"New message":fresh.length+" new messages";
    live.textContent=live.textContent===note?note+".":note;
  }
}
function mergeMessages(incoming){
  for(const message of incoming){
    if(message.id&&threadMessages.some(row=>row.id===message.id)) continue;
    threadMessages.push(message);
  }
  paint(threadMessages);
}
function applyResult(data){
  const payload=data||{};
  conversationId=payload.conversationId||payload.conversation&&payload.conversation.id||conversationId;
  rememberPerson(payload);
  rememberPerson(payload.conversation);
  const status=payload.status||payload.conversation&&payload.conversation.status||"";
  if(status==="ended"||payload.conversation&&payload.conversation.endedAt)ended=true;
  if(Array.isArray(payload.messages)){
    cursor=Number(payload.cursor)||cursor;
    if(!ended&&payload.messages.some(m=>m.sender==="system"&&/conversation has ended/i.test(m.text||"")))ended=true;
    if(!payload.messages.length&&!threadMessages.length) paint([]);
    else mergeMessages(payload.messages);
  }else if(payload.chatStarted){
    if(payload.representativeName)representativeName=payload.representativeName;
    if(!threadMessages.length) paint([]);
  }
  if(ended) stopPolling();
  setHeader();
  setComposerEnabled(!ended&&!!conversationId);
}
async function refresh(){
  if(!conversationId||ended)return;
  try{
    const result=await callTool("support_get_messages",{conversation_id:conversationId,after:cursor||0});
    const payload=result&&(result.structuredContent||result)||{};
    if(result&&result.isError) throw new Error("poll");
    applyResult(payload);
    pollDelay=2000;
  }catch(error){
    if(subtitleEl&&!ended) subtitleEl.textContent="Reconnecting…";
    pollDelay=Math.min(pollDelay*2,15000);
  }
}
function schedulePoll(){
  stopPolling();
  if(ended||!conversationId) return;
  pollTimer=setTimeout(async()=>{
    await refresh();
    schedulePoll();
  },pollDelay);
}
function startChatSession(initial){
  if(chatStarted){
    applyResult(initial||{});
    return;
  }
  chatStarted=true;
  bindChatElements();
  document.getElementById("composer").onsubmit=async event=>{
    event.preventDefault();
    const text=textEl.value.trim();
    if(!text||!conversationId||ended||sending)return;
    sending=true;
    sendEl.disabled=true;
    if(!pendingClientId) pendingClientId=crypto.randomUUID();
    setSendStatus("");
    try{
      const result=await callTool("support_send_message",{conversation_id:conversationId,text,client_message_id:pendingClientId});
      const payload=result&&(result.structuredContent||result)||{};
      if(!result||result.isError||payload.status!=="sent"){
        setSendStatus("Message not sent. Try again.");
        return;
      }
      textEl.value="";
      pendingClientId="";
      await refresh();
    }catch(error){
      setSendStatus("Message not sent. Try again.");
    }finally{
      sending=false;
      setComposerEnabled(!ended&&!!conversationId);
    }
  };
  endEl.onclick=async()=>{
    if(!conversationId||ended)return;
    if(!endArmed){
      endArmed=true;
      endEl.textContent="End chat?";
      setTimeout(()=>{ if(endArmed){ endArmed=false; endEl.textContent="End"; } },4000);
      return;
    }
    endArmed=false;
    endEl.textContent="End";
    endEl.disabled=true;
    try{
      const result=await callTool("support_end_session",{conversation_id:conversationId});
      const payload=result&&(result.structuredContent||result)||{};
      if(!result||result.isError||payload.status!=="ended"){
        setSendStatus("The chat could not be ended. Try again.");
        endEl.disabled=false;
        return;
      }
      ended=true;
      stopPolling();
      setHeader();
      setComposerEnabled(false);
    }catch(error){
      setSendStatus("The chat could not be ended. Try again.");
      endEl.disabled=false;
    }
  };
  onToolResult(result=>applyResult(result.structuredContent||result));
  setHeader();
  setComposerEnabled(false);
  applyResult(initial||{});
  if(typeof fitFrame==="function") fitFrame();
  stopPolling();
  schedulePoll();
}
`;
}

/** Offer card for business intents. The chat resource starts already in the chat. */
function supportAppHtml(startInChat = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Within assistance</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{
  padding:4px 2px 8px;color:#1C1C19;
  font:400 15px/22px Inter,"Segoe UI",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
#offer-root.card{
  width:100%;padding:16px 16px 14px;border:1px solid #E6E6E6;border-radius:16px;background:#fff;
}
.eyebrow{
  margin:0 0 8px;color:#2F7D4F;letter-spacing:.04em;text-transform:uppercase;
  font:700 12px/16px Inter,"Segoe UI",system-ui,sans-serif;
}
.eyebrow.neutral{color:#6B6B62}
#offer-root h1{margin:0 0 8px;font:500 16px/22px Inter,"Segoe UI",system-ui,sans-serif}
.note{margin:0;color:#8A8A82;font:400 13px/18px Inter,"Segoe UI",system-ui,sans-serif}
#draft{
  display:none;margin:12px 0 0;padding:10px 12px;border:0;border-left:3px solid #E0E0E0;
  background:#F6F6F4;color:#3F3F38;font:400 13px/18px Inter,"Segoe UI",system-ui,sans-serif;
}
#draft.visible{display:block}
.actions{display:flex;gap:8px;margin-top:14px}
#offer-root button{
  flex:none;min-height:36px;margin:0;padding:8px 14px;border-radius:8px;
  font:600 14px/20px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;
}
#accept{border:1px solid #2F7D4F;background:#2F7D4F;color:#fff}
#accept:hover:not(:disabled){background:#2F7D4F}
#decline{border:1px solid #E0E0E0;background:#fff;color:#1C1C19}
#decline:hover:not(:disabled){background:#F6F6F4}
#offer-root button:disabled{opacity:.5;cursor:not-allowed}
#status{margin:8px 0 0;min-height:0;color:#6B6B62;font:400 12px/16px Inter,"Segoe UI",system-ui,sans-serif}
#status:empty{display:none}
#status.error{color:#A32D2D}
#chat-root{display:none}
body.sb-chat-mode{
  display:flex;flex-direction:column;height:auto;min-height:280px;max-height:70vh;padding:0;overflow:hidden;
  background:#FAFAF7;color:#1C1C19;
  font:400 14px/20px Inter,"Segoe UI",system-ui,sans-serif;
}
body.sb-chat-mode #offer-root,body.sb-chat-mode #vendor-card{display:none}
body.sb-chat-mode #chat-root{
  display:flex;flex-direction:column;flex:1;height:auto;min-height:280px;max-height:70vh;overflow:hidden;
}
${chatPanelStyles()}
:where(button):focus-visible{outline:2px solid #2F7D4F;outline-offset:2px}
#offer-root[hidden]{display:none}
#vendor-card{
  display:block; width:100%; border:1px solid #d9ded9; border-radius:14px;
  background:#fff; color:#1f2a24;
  font:400 14px/1.45 system-ui,"Segoe UI",sans-serif;
}
#vendor-card[hidden]{display:none}
.va-region{padding:17px 20px}
.va-region+.va-region{border-top:1px solid #e3e7e3}
.va-head{display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0}
.va-badge{
  display:grid; place-items:center; flex:none; width:24px; height:24px; border-radius:6px; background:#2F7D4F; color:#fff;
  font:600 11px/1 system-ui,"Segoe UI",sans-serif;
}
#va-vendor-name{font:600 15px/1.35 system-ui,"Segoe UI",sans-serif}
.va-dot-sep{color:#a0a8a3; font-size:15px; line-height:1}
.va-source{margin:0; color:#5f6a64; font:400 14px/1.35 system-ui,"Segoe UI",sans-serif}
.va-answer{display:flex; flex-direction:column; align-items:flex-start; gap:12px}
.va-answer[hidden]{display:none}
.va-facts{display:flex; flex-wrap:wrap; gap:8px}
.va-facts[hidden]{display:none}
.va-chip{border:1px solid #dfe4df; border-radius:8px; padding:6px 10px; color:#1f2a24; font-size:13px; line-height:1.3}
.va-chip-label,.va-chip-unit{color:#5f6a64}
.va-chip strong{font-size:14px; font-weight:600}
#va-body{
  margin:0; color:#2b3630; font:400 15px/1.55 system-ui,"Segoe UI",sans-serif;
  display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden;
}
#va-body.is-open{display:block; -webkit-line-clamp:unset; overflow:visible}
#va-more{
  min-height:44px; margin:0; padding:10px 0; border:0; background:transparent; color:#2F7D4F;
  font:600 14px/1.3 system-ui,"Segoe UI",sans-serif; cursor:pointer;
}
#va-more[hidden]{display:none}
.va-offer{display:flex; flex-direction:column; gap:10px; margin:0; background:transparent}
.va-offer[hidden]{display:none}
.va-rep{display:flex; flex-wrap:wrap; align-items:flex-start; gap:12px}
.va-avatar-wrap{position:relative; flex:none; width:36px; height:36px}
.va-avatar{
  display:grid; place-items:center; width:36px; height:36px; border-radius:50%;
  font:600 13px/1 system-ui,"Segoe UI",sans-serif;
}
.va-avatar.live{background:#e3ebe3; color:#2d5a3e}
.va-avatar.async,.va-avatar.agent{background:#eef0ee; color:#5f6a64}
#va-bubble{display:none}
.va-avatar.async #va-bubble{display:block}
.va-avatar.async #va-initials{display:none}
.va-dot{
  position:absolute; right:-1px; bottom:-1px; width:11px; height:11px; border-radius:50%; background:#2F7D4F;
  box-shadow:0 0 0 2px #fff;
}
.va-dot[hidden]{display:none}
.va-person-copy{flex:1 1 200px; min-width:0}
.va-name-line{display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:0}
#va-rep-heading{margin:0; color:#1f2a24; font:600 15px/1.35 system-ui,"Segoe UI",sans-serif}
.va-pill{border-radius:999px; padding:2px 8px; font:600 11px/1.4 system-ui,"Segoe UI",sans-serif}
.va-pill.live{background:#e4f3e9; color:#0a5a2e}
.va-pill.async,.va-pill.agent{background:#eef0ee; color:#5f6a64}
.va-pill[hidden]{display:none}
#va-rep-sub{margin:2px 0 0; color:#5f6a64; font:400 13px/1.4 system-ui,"Segoe UI",sans-serif}
.va-sr{position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0}
.va-note[hidden]{display:none}
#va-note-text{
  display:block; width:100%; min-height:44px; box-sizing:border-box; resize:vertical; margin:0;
  padding:10px 12px; border:1px solid #d9ded9; border-radius:8px; background:#fff; color:#1f2a24;
  font:400 14px/1.45 system-ui,"Segoe UI",sans-serif;
}
#va-helper{margin:0; color:#5f6a64; font:400 12.5px/1.4 system-ui,"Segoe UI",sans-serif}
#va-helper:empty{display:none}
.va-actions{display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; margin:0}
.va-actions[hidden]{display:none}
#va-accept,#va-decline,#va-agent-send{min-height:44px; border:0; cursor:pointer; font-family:system-ui,"Segoe UI",sans-serif}
#va-accept,#va-agent-send{
  padding:11px 18px; border-radius:8px; background:#2F7D4F; color:#fff; font-size:14px; font-weight:600;
}
#va-decline{padding:11px 8px; background:transparent; color:#5f6a64; font-size:14px; font-weight:500}
#va-accept:disabled,#va-decline:disabled{opacity:.5; cursor:not-allowed}
#va-status{margin:0; color:#5f6a64; font:400 12.5px/1.4 system-ui,"Segoe UI",sans-serif}
#va-status:empty{display:none}
#va-status.error{color:#8a2a2a}
#va-agent[hidden]{display:none}
#va-agent-log{display:flex; flex-direction:column; gap:12px}
.va-msg{display:flex; flex-direction:column; gap:4px; max-width:85%}
.va-msg.user{align-self:flex-end; align-items:flex-end}
.va-msg.assistant{align-self:flex-start; align-items:flex-start}
.va-who{margin:0; color:#5f6a64; font:400 12.5px/1.3 system-ui,"Segoe UI",sans-serif}
.va-bubble{margin:0; padding:10px 12px; border-radius:8px; font:400 14px/1.5 system-ui,"Segoe UI",sans-serif}
.va-msg.assistant .va-bubble{border:1px solid #dfe4df; background:#fff; color:#2b3630}
.va-msg.user .va-bubble{background:#e4f3e9; color:#1f2a24}
#va-agent-form{display:flex; flex-direction:column; gap:6px}
#va-agent-form[hidden]{display:none}
.va-compose{display:flex; flex-wrap:wrap; align-items:center; gap:8px}
#va-agent-input{
  flex:1 1 180px; min-width:0; min-height:44px; margin:0; padding:10px 12px; border:1px solid #d9ded9; border-radius:8px;
  background:#fff; color:#1f2a24; font:400 14px/1.4 system-ui,"Segoe UI",sans-serif;
}
#va-agent-foot{margin:0; color:#5f6a64; font:400 12.5px/1.4 system-ui,"Segoe UI",sans-serif}
@media (prefers-color-scheme: dark){
  body,body.sb-chat-mode{background:#1C1C19;color:#F4F4F0}
  #offer-root.card,#vendor-card,#header{background:#262622;color:#F4F4F0;border-color:#3A3A35}
  .note,#subtitle,.message-who,.message-time,.chat-empty,#status,.va-source,.va-chip-label,.va-chip-unit,.va-who,#va-agent-foot{color:#C8C8C0}
  #draft,.composer-shell,.va-chip,.va-msg.assistant .va-bubble,#va-agent-input{background:#1C1C19;color:#F4F4F0;border-color:#3A3A35}
  #decline{background:#262622;color:#F4F4F0;border-color:#3A3A35}
  .bubble,.va-msg.user .va-bubble{background:#24362C;color:#F4F4F0}
  #title,#va-vendor-name,#offer-root h1,#va-body{color:#F4F4F0}
}
</style></head>
<body${startInChat ? ' class="sb-chat-mode"' : ""}>
  <article id="vendor-card" hidden>
    <header class="va-region va-head">
      <span id="va-vendor-badge" class="va-badge" aria-hidden="true"></span>
      <strong id="va-vendor-name"></strong>
      <span class="va-dot-sep" aria-hidden="true">·</span>
      <p id="va-source" class="va-source">from <span id="va-source-text"></span></p>
    </header>
    <div id="va-answer" class="va-region va-answer">
      <div id="va-facts" class="va-facts" hidden></div>
      <p id="va-body"></p>
      <button id="va-more" type="button" hidden aria-expanded="false">Show full answer</button>
    </div>
    <section id="va-offer" class="va-region va-offer" hidden>
      <div class="va-rep">
        <span class="va-avatar-wrap"><span id="va-avatar" class="va-avatar" aria-hidden="true"><span id="va-initials"></span><svg id="va-bubble" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3.2 4.2h11.6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.4L5 14.6V12.2H3.2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span><span id="va-dot" class="va-dot" hidden></span></span>
        <div class="va-person-copy">
          <p class="va-name-line"><span id="va-rep-heading"></span> <span id="va-pill" class="va-pill" hidden></span></p>
          <p id="va-rep-sub"></p>
        </div>
      </div>
      <div id="va-note" class="va-note" hidden>
        <label id="va-note-label" class="va-sr" for="va-note-text">Note</label>
        <textarea id="va-note-text" rows="2"></textarea>
      </div>
      <p id="va-helper"></p>
      <div id="va-actions" class="va-actions">
        <button id="va-accept" type="button"><span id="va-accept-label">Chat with support</span></button>
        <button id="va-decline" type="button">Not now</button>
      </div>
      <p id="va-status" role="status"></p>
      <div id="va-agent" hidden>
        <div id="va-agent-log" role="log" aria-live="polite"></div>
      </div>
    </section>
    <form id="va-agent-form" class="va-region va-composer" hidden>
      <div class="va-compose">
        <label class="va-sr" for="va-agent-input">Follow-up</label>
        <input id="va-agent-input" type="text" maxlength="2000" placeholder="Ask a follow-up">
        <button id="va-agent-send" type="submit">Send</button>
      </div>
      <p id="va-agent-foot">A person is not in this chat.</p>
    </form>
  </article>
  <section id="offer-root" class="card" hidden aria-labelledby="offer-title">
    <p class="eyebrow" id="eyebrow"></p>
    <h1 id="offer-title"></h1>
    <p class="note" id="note"></p>
    <blockquote id="draft" hidden></blockquote>
    <div class="actions" id="actions">
      <button id="accept" type="button">Chat with support</button>
      <button id="decline" type="button">Not now</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
  <div id="chat-root">${chatMarkup()}</div>
<script>${bridgeScript()}${chatClientScript()}
/* sb-state-machine: offer → connecting → chat → ended */
/* initial-chatStarted-renders-chat */
let offerId="";
let acceptTool="confirm_assistance";
let declineTool="decline_assistance";
let sentTitle="";
let settled=false;
let pendingAction=false;
let offerClosed=false;
const eyebrowEl=document.getElementById("eyebrow");
const offerTitleEl=document.getElementById("offer-title");
const noteEl=document.getElementById("note");
const draftEl=document.getElementById("draft");
const actionsEl=document.getElementById("actions");
const statusEl=document.getElementById("status");
const acceptEl=document.getElementById("accept");
const declineEl=document.getElementById("decline");
const offerRootEl=document.getElementById("offer-root");
const vaCard=document.getElementById("vendor-card");
const vaVendorBadge=document.getElementById("va-vendor-badge");
const vaVendorName=document.getElementById("va-vendor-name");
const vaSourceText=document.getElementById("va-source-text");
const vaAnswer=document.getElementById("va-answer");
const vaFacts=document.getElementById("va-facts");
const vaBody=document.getElementById("va-body");
const vaMore=document.getElementById("va-more");
const vaOffer=document.getElementById("va-offer");
const vaAvatar=document.getElementById("va-avatar");
const vaInitials=document.getElementById("va-initials");
const vaDot=document.getElementById("va-dot");
const vaRepHeading=document.getElementById("va-rep-heading");
const vaPill=document.getElementById("va-pill");
const vaRepSub=document.getElementById("va-rep-sub");
const vaNote=document.getElementById("va-note");
const vaNoteLabel=document.getElementById("va-note-label");
const vaNoteText=document.getElementById("va-note-text");
const vaHelper=document.getElementById("va-helper");
const vaActions=document.getElementById("va-actions");
const vaAccept=document.getElementById("va-accept");
const vaAcceptLabel=document.getElementById("va-accept-label");
const vaDecline=document.getElementById("va-decline");
const vaStatus=document.getElementById("va-status");
const vaAgent=document.getElementById("va-agent");
const vaAgentLog=document.getElementById("va-agent-log");
const vaAgentForm=document.getElementById("va-agent-form");
const vaAgentInput=document.getElementById("va-agent-input");
let vaFull="";
let vaExpanded=false;
function resultBags(result){
  if(!result||typeof result!=="object")return [];
  return [result.structuredContent,result.toolOutput,result.toolResponseMetadata,result.result,result].filter(bag=>bag&&typeof bag==="object");
}
function conversationIdOf(result){
  for(const bag of resultBags(result)){
    const id=bag.conversationId||bag.conversation&&bag.conversation.id;
    if(id)return String(id);
  }
  return "";
}
function chatStartedOf(result){
  for(const bag of resultBags(result)){
    if(bag.chatStarted===true)return true;
  }
  return false;
}
function statusOf(result){
  for(const bag of resultBags(result)){
    if(typeof bag.status==="string"&&bag.status)return bag.status;
  }
  return "";
}
function mountPayload(result){
  const bags=resultBags(result);
  return Object.assign({},...bags.reverse());
}
function mountChat(payload){
  settled=true;
  document.body.classList.add("sb-chat-mode");
  startChatSession(payload||{});
  fitFrame();
}
function alreadyChatting(payload){
  return Boolean(conversationIdOf(payload)&&(chatStartedOf(payload)||Array.isArray(payload.messages)||(payload.conversation&&payload.conversation.id)));
}
function apply(data){
  const payload=flattenAssistance(data||{});
  if(alreadyChatting(payload)){
    if(vaCard) vaCard.hidden=true;
    if(offerRootEl) offerRootEl.hidden=true;
    mountChat(mountPayload(payload));
    return;
  }
  if(payload.direct_answer){
    renderVendor(payload);
    return;
  }
  if(vaCard) vaCard.hidden=true;
  if(offerRootEl) offerRootEl.hidden=true;
  if(payload.status==="representative_unavailable"||payload.available===false){
    if(offerRootEl) offerRootEl.hidden=false;
    settled=true;
    offerClosed=true;
    offerId="";
    eyebrowEl.textContent="SUPPORT UNAVAILABLE";
    offerTitleEl.textContent="No representative is available right now.";
    noteEl.textContent="Nothing was sent. Try again later.";
    statusEl.classList.add("error");
    statusEl.textContent="No one is available.";
    setBusy(true);
    fitFrame();
    return;
  }
  offerId=payload.offerId||payload.offer_id||payload.escalationOfferId||offerId;
  if(payload.acceptTool) acceptTool=payload.acceptTool;
  if(payload.declineTool) declineTool=payload.declineTool;
  if(payload.cardTitle){
    if(offerRootEl) offerRootEl.hidden=false;
    eyebrowEl.textContent=payload.cardEyebrow||eyebrowEl.textContent;
    eyebrowEl.classList.toggle("neutral", payload.cardEyebrowTone==="neutral");
    offerTitleEl.textContent=payload.cardTitle;
    if(payload.cardNote) noteEl.textContent=payload.cardNote;
    if(payload.draftNote){
      draftEl.hidden=false;
      draftEl.classList.add("visible");
      draftEl.textContent=payload.draftNote;
    }else{
      draftEl.hidden=true;
      draftEl.classList.remove("visible");
      draftEl.textContent="";
    }
    if(payload.acceptLabel) acceptEl.textContent=payload.acceptLabel;
    if(payload.declineLabel) declineEl.textContent=payload.declineLabel;
    if(payload.sentTitle) sentTitle=payload.sentTitle;
    if(!pendingAction) setBusy(false);
    fitFrame();
    return;
  }
  if(!pendingAction) setBusy(false);
  fitFrame();
}
function setBusy(busy){
  pendingAction=busy;
  const locked=busy||settled||offerClosed||!offerId;
  acceptEl.disabled=locked;
  declineEl.disabled=locked;
  if(vaAccept) vaAccept.disabled=locked;
  if(vaDecline) vaDecline.disabled=locked;
}
function renderFacts(facts){
  vaFacts.replaceChildren();
  const items=Array.isArray(facts)?facts.slice(0,3):[];
  const usable=items.filter(item=>item&&String(item.label||"").trim()&&String(item.value||"").trim());
  vaFacts.hidden=!usable.length;
  for(const item of usable){
    const chip=document.createElement("span");
    chip.className="va-chip";
    const label=document.createElement("span");
    label.className="va-chip-label";
    label.textContent=String(item.label).trim();
    const value=document.createElement("strong");
    value.textContent=String(item.value).trim();
    chip.append(label, document.createTextNode(" "), value);
    const unit=String(item.unit||"").trim();
    if(unit){
      const unitEl=document.createElement("span");
      unitEl.className="va-chip-unit";
      unitEl.textContent=" "+unit;
      chip.append(unitEl);
    }
    vaFacts.append(chip);
  }
}
function setPill(mode,text){
  vaPill.hidden=!text;
  vaPill.textContent=text||"";
  vaPill.classList.remove("live","async","agent");
  if(text) vaPill.classList.add(mode);
}
function renderVendor(payload){
  offerRootEl.hidden=true;
  vaCard.hidden=false;
  const rep=payload.rep&&typeof payload.rep==="object"?payload.rep:{};
  const vendorName=payload.vendor_name||payload.vendorName||"";
  const topic=payload.topic||String(payload.intentLabel||"this").toLowerCase();
  const team=payload.team||topic;
  vaVendorBadge.textContent=payload.vendor_initials||"";
  vaVendorName.textContent=vendorName;
  vaSourceText.textContent=payload.source_label||"Vendor docs";
  renderFacts(payload.facts);
  vaFull=payload.full_answer||payload.direct_answer||"";
  vaExpanded=false;
  vaBody.classList.remove("is-open");
  vaBody.textContent=vaFull;
  vaMore.hidden=true;
  requestAnimationFrame(()=>{ vaMore.hidden=vaExpanded?false:vaBody.scrollHeight<=vaBody.clientHeight+1; });
  vaMore.textContent="Show full answer";
  vaMore.setAttribute("aria-expanded","false");
  vaAnswer.hidden=false;
  offerId=payload.offer_id||payload.offerId||payload.escalationOfferId||"";
  if(payload.acceptTool) acceptTool=payload.acceptTool;
  if(payload.declineTool) declineTool=payload.declineTool;
  const assistance=payload.assistance&&typeof payload.assistance==="object"?payload.assistance:{};
  const kind=payload.state==="async"?"escalation":(payload.state==="live"?"live":(assistance.kind||payload.kind||(acceptTool==="request_assistance"||acceptTool==="confirm_assistance"?"live":"escalation")));
  const mode=kind==="agent"?"agent":(kind==="escalation"?"async":"live");
  vaOffer.hidden=!offerId;
  vaAgent.hidden=true;
  vaAgentForm.hidden=true;
  vaActions.hidden=false;
  vaAccept.hidden=false;
  vaDecline.hidden=false;
  vaDecline.textContent="Not now";
  vaAvatar.classList.remove("live","async","agent");
  vaAvatar.classList.add(mode);
  const first=payload.first_name||rep.first_name||String(rep.name||"").split(" ")[0];
  if(mode==="agent"){
    vaInitials.textContent=payload.vendor_initials||"A";
    vaDot.hidden=true;
    vaRepHeading.textContent="Vendor assistant";
    setPill("agent","Assistant");
    vaRepSub.textContent="No one from the team is taking this. The assistant answers from the saved context.";
    vaNote.hidden=true;
    vaHelper.textContent="Nothing starts until you choose Talk to the assistant.";
    vaAcceptLabel.textContent=payload.acceptLabel||"Talk to the assistant";
  }else if(mode==="async"){
    vaInitials.textContent="";
    vaDot.hidden=true;
    vaRepHeading.textContent=(vendorName||"The vendor")+" "+team+" team";
    setPill("async","Follow-up");
    vaRepSub.textContent="No one is online right now. Leave a note and they will follow up.";
    vaNote.hidden=false;
    vaNoteLabel.textContent="Note to "+(vendorName||"the vendor");
    if(document.activeElement!==vaNoteText) vaNoteText.value=payload.user_question||"";
    vaHelper.textContent=(vendorName||"The vendor")+" sees only this note and your name. Nothing is sent until you click.";
    vaAcceptLabel.textContent="Send note";
  }else{
    vaInitials.textContent=rep.initials||payload.vendor_initials||"";
    vaDot.hidden=false;
    vaRepHeading.textContent=rep.name||first||"Support";
    setPill("live","Online");
    vaRepSub.textContent="Representative at "+(vendorName||"the vendor")+", can help with "+topic;
    vaNote.hidden=false;
    vaNoteLabel.textContent="Note to "+(first||vendorName||"support");
    if(document.activeElement!==vaNoteText) vaNoteText.value=payload.user_question||"";
    vaHelper.textContent=(first?first+" sees":"They see")+" only this note and your name. Nothing is sent until you click.";
    vaAcceptLabel.textContent=payload.acceptLabel||(first?"Chat with "+first:"Chat with support");
  }
  if(!pendingAction) setBusy(false);
  fitFrame();
}
function customerFailure(status){
  if(status==="representative_unavailable") return "No representative is available right now.";
  if(status==="offer_expired"||status==="escalation_expired") return "This offer has expired. Ask for help again if you still want support.";
  if(status==="offer_not_found"||status==="offer_not_active") return "This offer is no longer available.";
  if(status==="conversation_already_open") return "You already have a chat open.";
  return "Could not start this chat.";
}
function acceptFailed(status,message){
  const terminal=status==="offer_expired"||status==="offer_not_active"||status==="offer_not_found";
  statusEl.classList.add("error");
  statusEl.textContent=message||"Could not accept this offer.";
  if(terminal){
    offerClosed=true;
    setBusy(true);
  }else{
    setBusy(false);
  }
}
onToolResult(result=>apply(result.structuredContent||result));
readHostOutput().then(apply).then(()=>{ if(!pendingAction&&!settled) setBusy(false); return resumeAcceptedOffer(); });
async function resumeAcceptedOffer(){
  if(settled||!offerId)return;
  try{
    const result=await callTool("support_get_offer",{offer_id:offerId,offerId:offerId});
    if(settled)return;
    const payload=mountPayload(result&&(result.structuredContent||result));
    const conversationId=conversationIdOf(payload);
    if(conversationId&&chatStartedOf(payload)){
      mountChat(Object.assign(payload,{conversationId:conversationId,chatStarted:true}));
    }
  }catch(error){}
}
acceptEl.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent=acceptTool==="file_escalation"?"Sending…":"Connecting…";
  try{
    const result=await callTool(acceptTool,withConsent({offer_id:offerId,offerId:offerId}));
    if(acceptTool==="file_escalation"){
      const filed=statusOf(result);
      if(filed==="pending"){
        settled=true;
        offerClosed=true;
        offerTitleEl.textContent=sentTitle||"Sent.";
        noteEl.textContent="";
        noteEl.hidden=true;
        draftEl.hidden=true;
        draftEl.classList.remove("visible");
        actionsEl.hidden=true;
        statusEl.textContent="";
        setBusy(true);
        fitFrame();
        return;
      }
      acceptFailed(filed,filed==="escalation_expired"?"This note offer has expired. Ask again if you still want to send it.":"Could not send this note.");
      return;
    }
    const conversationId=conversationIdOf(result);
    if(chatStartedOf(result)&&conversationId){
      mountChat(Object.assign(mountPayload(result),{conversationId,chatStarted:true}));
      return;
    }
    const status=statusOf(result);
    if(status==="representative_unavailable"){
      acceptFailed(status,"No representative is available right now.");
    }else if(status==="offer_expired"){
      acceptFailed(status,"This offer has expired. Ask for help again if you still want support.");
    }else if(status==="offer_not_found"||status==="offer_not_active"){
      acceptFailed(status,"This offer is no longer available.");
    }else{
      acceptFailed(status,customerFailure(status));
    }
  }catch(error){
    acceptFailed("",customerFailure(""));
  }
};
declineEl.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  statusEl.classList.remove("error");
  statusEl.textContent="Declining…";
  try{
    await callTool(declineTool,{offer_id:offerId,offerId:offerId});
    settled=true;
    offerClosed=true;
    stopPolling();
    statusEl.textContent=declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
  }catch(error){
    statusEl.classList.add("error");
    statusEl.textContent=error.message||"Could not decline this offer.";
    setBusy(false);
  }
};
vaMore.onclick=()=>{
  vaExpanded=!vaExpanded;
  vaBody.classList.toggle("is-open", vaExpanded);
  vaMore.textContent=vaExpanded?"Show less":"Show full answer";
  vaMore.setAttribute("aria-expanded", vaExpanded?"true":"false");
  fitFrame();
};
function openAgentChat(){
  vaAnswer.hidden=true;
  vaNote.hidden=true;
  vaHelper.textContent="";
  vaActions.hidden=true;
  vaAgent.hidden=false;
  vaAgentForm.hidden=false;
}
async function sendAgent(text){
  const cleaned=String(text||"").trim();
  if(!cleaned){
    vaStatus.classList.add("error");
    vaStatus.textContent="Type a message first.";
    setBusy(false);
    return;
  }
  const result=await callTool("talk_to_vendor_agent",{offer_id:offerId,offerId:offerId,text:cleaned});
  const payload=mountPayload(result);
  const messages=Array.isArray(payload.messages)?payload.messages:[];
  if(!messages.length){
    vaStatus.classList.add("error");
    vaStatus.textContent="Could not reach the assistant.";
    setBusy(false);
    return;
  }
  vaAgentLog.replaceChildren();
  for(const message of messages){
    const row=document.createElement("div");
    const mine=message.role==="user";
    row.className="va-msg "+(mine?"user":"assistant");
    const who=document.createElement("p");
    who.className="va-who";
    who.textContent=mine?"You":"Vendor assistant";
    const bubble=document.createElement("p");
    bubble.className="va-bubble";
    bubble.textContent=String(message.text||"");
    row.append(who, bubble);
    vaAgentLog.append(row);
  }
  openAgentChat();
  vaStatus.classList.remove("error");
  vaStatus.textContent=payload.configured===false?"Repeating the saved answer.":"";
  vaAgentInput.value="";
  settled=false;
  offerClosed=false;
  setBusy(false);
  fitFrame();
}
vaAccept.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent=acceptTool==="file_escalation"?"Sending…":"Connecting…";
  try{
    if(acceptTool==="talk_to_vendor_agent"){
      openAgentChat();
      vaStatus.textContent="";
      setBusy(false);
      vaAgentInput.focus();
      fitFrame();
      return;
    }
    const args=withConsent({offer_id:offerId,offerId:offerId});
    if(!vaNote.hidden) args.note=vaNoteText.value.trim();
    const result=await callTool(acceptTool,args);
    if(acceptTool==="file_escalation"){
      const filed=statusOf(result);
      if(filed==="pending"){
        settled=true;
        offerClosed=true;
        vaRepHeading.textContent=sentTitle||"Sent.";
        setPill("","");
        vaRepSub.textContent="";
        vaNote.hidden=true;
        vaHelper.textContent="";
        vaActions.hidden=true;
        vaStatus.textContent="";
        setBusy(true);
        fitFrame();
        return;
      }
      vaStatus.classList.add("error");
      vaStatus.textContent=filed==="escalation_expired"?"This note offer has expired. Ask again if you still want to send it.":"Could not send this note.";
      setBusy(false);
      return;
    }
    const conversationId=conversationIdOf(result);
    if(chatStartedOf(result)&&conversationId){
      mountChat(Object.assign(mountPayload(result),{conversationId:conversationId,chatStarted:true}));
      return;
    }
    vaStatus.classList.add("error");
    vaStatus.textContent=customerFailure(statusOf(result));
    setBusy(false);
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=customerFailure("");
    setBusy(false);
  }
};
vaDecline.onclick=async()=>{
  if(!offerId||settled||pendingAction||offerClosed)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent="Declining…";
  try{
    await callTool(declineTool,{offer_id:offerId,offerId:offerId});
    settled=true;
    offerClosed=true;
    stopPolling();
    vaStatus.textContent=declineTool==="decline_escalation"?"Not sent.":"Declined. No one was contacted.";
    vaAccept.disabled=true;
    vaDecline.disabled=true;
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=error.message||"Could not decline this offer.";
    setBusy(false);
  }
};
vaAgentForm.onsubmit=async(event)=>{
  event.preventDefault();
  if(!offerId||pendingAction)return;
  setBusy(true);
  vaStatus.classList.remove("error");
  vaStatus.textContent="Sending…";
  try{
    await sendAgent(vaAgentInput.value);
  }catch(error){
    vaStatus.classList.add("error");
    vaStatus.textContent=error.message||"Could not reach the assistant.";
    setBusy(false);
  }
};
function fitFrame(){
  if(document.body.classList.contains("sb-chat-mode")){
    const cap=Math.max(320, Math.round((window.innerHeight||800)*0.7));
    requestFrame(Math.min(Math.max(document.documentElement.scrollHeight, 280), cap));
    return;
  }
  requestFrame(Math.ceil(Math.max(document.documentElement.scrollHeight, 280)));
}
setBusy(false);
fitFrame();
requestAnimationFrame(fitFrame);
</script></body></html>`;
}

function chatHtml() {
  return supportAppHtml(true);
}

function intentOfferHtml() {
  return supportAppHtml(false);
}

export function previewIntentOfferHtml(payload) {
  const sample = JSON.stringify(payload ?? {});
  return intentOfferHtml().replace(
    "function readHostOutput(){\n  try{captureConsent(window.openai||{});}catch(e){}\n  return Promise.resolve(hostOutput()||{});\n}",
    `function readHostOutput(){captureConsent(${sample});return Promise.resolve(${sample});}\n`
  );
}

function bridgeScript() {
  return `
const pending=new Map();
let nextId=1;
let toolHandler=()=>{};
let handlerReady=false;
let pendingResult=null;
function onToolResult(fn){
  toolHandler=fn;
  handlerReady=true;
  if(pendingResult){const result=pendingResult;pendingResult=null;fn(result);}
}
let consentNonce="";
function readConsentBag(bag){
  if(!bag||typeof bag!=="object")return "";
  const nonce=bag["supportbridge/consentNonce"];
  return typeof nonce==="string"?nonce.trim():"";
}
function captureConsent(source){
  const root=source&&typeof source==="object"?source:{};
  const found=readConsentBag(root)||readConsentBag(root._meta)||readConsentBag(root.meta)||readConsentBag(root.toolResponseMetadata);
  if(found)consentNonce=found;
  try{
    const openai=window.openai||{};
    const hostNonce=readConsentBag(openai.toolResponseMetadata)||readConsentBag(openai._meta)||readConsentBag(openai.toolOutput&&openai.toolOutput._meta);
    if(hostNonce)consentNonce=hostNonce;
  }catch(e){}
}
function withConsent(args){
  const next=Object.assign({},args||{});
  if(consentNonce)next.consentNonce=consentNonce;
  return next;
}
function deliverResult(params){
  captureConsent(params);
  if(!handlerReady)pendingResult=params||{};
  else toolHandler(params||{});
}
function flattenAssistance(payload){
  if(!payload||typeof payload!=="object")return payload;
  const assistance=payload.assistance;
  if(!assistance||typeof assistance!=="object")return payload;
  const person=assistance.representative&&typeof assistance.representative==="object"?assistance.representative:{};
  return Object.assign({}, payload, {
    offerId: payload.offerId||assistance.offerId||"",
    offer_id: payload.offer_id||assistance.offerId||"",
    vendorName: payload.vendorName||assistance.vendor||"",
    representativeName: payload.representativeName||person.name||"",
    representativeRole: payload.representativeRole||person.role||""
  });
}
function payloadFrom(value){
  if(!value||typeof value!=="object")return null;
  const nested=value.structuredContent||value["supportbridge/offer"];
  const payload=flattenAssistance(nested&&typeof nested==="object"?nested:value);
  if(payload.offerId||payload.offer_id||payload.escalationOfferId||payload.cardTitle||payload.vendorName||payload.representativeName||payload.chatStarted||payload.conversationId||payload.direct_answer||(payload.conversation&&payload.conversation.id))return payload;
  return null;
}
function hostOutput(){
  try{
    const openai=window.openai||{};
    return payloadFrom(openai.toolOutput)||payloadFrom(openai.toolResponseMetadata)||payloadFrom(openai.toolResponse)||null;
  }catch(e){return null;}
}
function readHostOutput(){
  try{captureConsent(window.openai||{});}catch(e){}
  return Promise.resolve(hostOutput()||{});
}
window.addEventListener("openai:set_globals",(event)=>{
  const globals=event&&event.detail&&event.detail.globals;
  captureConsent(globals);
  captureConsent(globals&&globals.toolResponseMetadata);
  const output=payloadFrom(globals&&globals.toolOutput)||payloadFrom(globals&&globals.toolResponseMetadata)||hostOutput();
  if(output)deliverResult({structuredContent:output,_meta:globals&&globals.toolResponseMetadata});
});
window.addEventListener("message",event=>{
  const msg=event.data;
  if(!msg||msg.jsonrpc!=="2.0")return;
  if(msg.id!=null&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);return;}
  if(msg.method==="ui/notifications/tool-result")deliverResult(msg.params||{});
});
let frameHeight=0;
function requestFrame(height){
  frameHeight=height;
  const size={width:480,height};
  parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:size},"*");
  try{
    if(window.openai&&typeof window.openai.notifyIntrinsicHeight==="function") window.openai.notifyIntrinsicHeight(height);
  }catch(e){}
}
function rpc(method,params){
  const id=nextId++;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("The host did not respond."));},15000);
    pending.set(id,message=>{clearTimeout(timer);resolve(message);});
    parent.postMessage({jsonrpc:"2.0",id,method,params},"*");
  });
}
async function callTool(name,args){
  if(window.openai&&typeof window.openai.callTool==="function"){
    try{
      return await window.openai.callTool(name,args);
    }catch(error){
      if(!(error&&/not implemented|unsupported/i.test(String(error.message||error)))) throw error;
    }
  }
  const response=await rpc("tools/call",{name,arguments:args});
  return response.result||{};
}
rpc("ui/initialize",{protocolVersion:"2026-01-26",appCapabilities:{availableDisplayModes:["inline"]}}).then(()=>{
  parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/initialized"},"*");
  if(frameHeight) requestFrame(frameHeight);
}).catch(()=>{});
`;
}
