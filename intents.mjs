/** Standard business intents for optional live-assistance offers. */
export const STANDARD_ASSISTANCE_INTENTS = [
  { id: "pricing", label: "Pricing", description: "Prices, plans, discounts, promotions, volume or usage pricing, and multi-year commitments", words: ["price", "prices", "pricing", "cost", "costs", "rate", "rates", "plan", "plans", "discount", "discounts", "promotion", "promotions", "comparison", "volume", "commitment", "multi-year", "usage pricing"] },
  { id: "upgrade", label: "Upgrade", description: "Upgrades, limits, overages, feature gates, seats, and add-ons", words: ["upgrade", "upgrades", "purchase", "purchasing", "buy", "buying", "limit", "limits", "overage", "overages", "seat", "seats", "add-on", "add-ons", "module", "modules", "feature gate", "feature gating"] },
  { id: "demo", label: "Demo", description: "A request for a demo or to talk with a person", words: ["demo", "demos", "walkthrough", "walkthroughs"] },
  { id: "trial", label: "Trial", description: "Trials, pilots, and sandboxes", words: ["trial", "trials", "pilot", "pilots", "sandbox", "sandboxes", "evaluation", "evaluations"] },
  { id: "enterprise", label: "Enterprise", description: "Enterprise terms, quotes, contracts, procurement, and invoicing", words: ["enterprise", "quote", "quotes", "proposal", "proposals", "contract", "contracts", "procurement", "invoicing", "legal", "SLA", "SLAs", "payment terms", "vendor onboarding", "custom terms"] },
  { id: "security", label: "Security", description: "Security, compliance, SSO, SCIM, and data residency", words: ["security", "compliance", "SOC 2", "ISO 27001", "HIPAA", "GDPR", "SSO", "SCIM", "DPA", "DPAs", "residency", "retention", "deletion"] },
  { id: "implementation", label: "Implementation", description: "Implementation, onboarding, integrations, and migration", words: ["implementation", "setup", "onboarding", "migration", "training", "integration", "switching"] },
  { id: "billing", label: "Billing", description: "Billing disputes, refunds, and invoice questions", words: ["billing", "bill", "bills", "invoice", "invoices", "refund", "refunds", "tax", "taxes", "payment", "payments", "dispute", "disputes"] },
  { id: "cancellation", label: "Cancellation", description: "Cancellation, downgrades, pauses, and consolidation", words: ["cancellation", "cancel", "downgrade", "downgrades", "pause", "freeze", "consolidation", "close account"] },
  { id: "renewal", label: "Renewal", description: "Renewal terms, usage concerns, and admin changes", words: ["renewal", "renewals", "renew", "admin change", "ownership change"] },
  { id: "competitive", label: "Competitive", description: "Competitive comparisons, business case, and references", words: ["competitive", "competitor", "competitors", "ROI", "business case", "reference", "proof"] },
  { id: "buying_process", label: "Buying process", description: "Who else is involved, budget, and timing", words: ["budget", "timing", "timeline", "stakeholder", "stakeholders", "champion", "decision maker", "who else"] }
];

export const ASSISTANCE_INTENT_IDS = STANDARD_ASSISTANCE_INTENTS.map(intent => intent.id);

/** Previous ids still accepted from stored rules and older tool calls. */
export const INTENT_ALIASES = {
  purchase: "upgrade",
  security_compliance: "security",
  billing_payment: "billing",
  cancellation_downgrade: "cancellation"
};

const TOPIC_PATTERNS = [
  ["security", /secur|complian|scim|residenc|retention|\bdelet|\bsso\b|hipaa|gdpr|\bsoc\b|\bdpa|iso\s*27001|encrypt|privacy|certif|\baudit|penet|\bmfa\b|questionnaire|subprocessor|vulnerab|access control|data residency/],
  ["cancellation", /\bcancel|\bdowngrad|\bpause|\bfreez|\bconsolidat|\bchurn|close account/],
  ["renewal", /\brenew|admin change|ownership change|usage concern|value concern/],
  ["trial", /\btrials?\b|\bpilots?\b|\bsandbox|\bevaluat/],
  ["competitive", /\bcompetit|\broi\b|business case|\breference\b|\bproof\b|\balternative\b/],
  ["upgrade", /\bupgrad|\blimits?\b|\boverages?\b|\bseats?\b|\badd-ons?\b|\bmodules?\b|feature gat|\bpurchas|\bbuy/],
  ["enterprise", /\benterprise\b|\bquotes?\b|\bproposals?\b|\bcontracts?\b|\bprocurement\b|\binvoicing\b|\blegal\b|\bslas?\b|payment terms|vendor onboarding|custom terms/],
  ["demo", /\bdemos?\b|\bwalkthroughs?\b|\bdemonstration\b/],
  ["implementation", /\bimplement|\bsetup\b|\bonboard|\bmigrat|\btrain|\bintegration|\bswitching\b|professional service/],
  ["billing", /\bbills?\b|\bbilling\b|\binvoices?\b|\brefunds?\b|\btaxes?\b|\bpayments?\b|\bdisputes?\b/],
  ["pricing", /\bprices?\b|\bpricing\b|\bcosts?\b|\brates?\b|\bplans?\b|\bdiscounts?\b|\bpromotions?\b|\bcommitment\b|multi-year|\bvolume\b|\bcomparison\b|usage pricing/]
];

export function intentById(id) {
  if (id == null || id === "") return undefined;
  const normalized = String(id).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const canonical = INTENT_ALIASES[normalized] || (normalized === "demo_or_pilot" ? "demo" : normalized);
  return STANDARD_ASSISTANCE_INTENTS.find(intent => intent.id === canonical);
}

export function defaultIntentToggles(enabled) {
  return Object.fromEntries(ASSISTANCE_INTENT_IDS.map(intentId => [intentId, Boolean(enabled)]));
}

const DEFAULT_SUMMARIES = {
  pricing: "Customer asked about pricing or plans.",
  upgrade: "Customer asked about an upgrade or a higher limit.",
  demo: "Customer asked for a demo or to talk with a person.",
  trial: "Customer asked about a trial or pilot.",
  enterprise: "Customer asked about enterprise terms.",
  implementation: "Customer asked about implementation or onboarding.",
  security: "Customer asked about security or compliance.",
  billing: "Customer asked about billing or a refund.",
  cancellation: "Customer asked about cancellation or a downgrade.",
  renewal: "Customer asked about renewal.",
  competitive: "Customer asked for a comparison.",
  buying_process: "Customer asked about budget or timing."
};

/**
 * Normalize host/model tool args into a known intent id and issue summary.
 * Accepts loose values like "Pricing", "support", missing summaries, and extra fields.
 */
export function normalizeAssistanceArgs(args = {}) {
  const rawIntent = String(args.intent ?? args.Intent ?? "").trim();
  const rawSummary = String(args.issueSummary ?? args.issue_summary ?? args.summary ?? "").trim().slice(0, 2_000);
  const haystack = `${rawIntent} ${rawSummary}`.toLowerCase();
  const intent = resolveAssistanceIntent(rawIntent, haystack);
  const issueSummary = rawSummary || DEFAULT_SUMMARIES[intent] || "Customer asked for live assistance.";
  return { intent, issueSummary };
}

/**
 * Normalize connect/decline tool args to a single offer id.
 * Accepts offerId or offer_id; ignores name, email, user id, and other extras.
 */
export function normalizeOfferArgs(args = {}) {
  const raw = args.offerId ?? args.offer_id ?? args.offerID;
  if (raw == null || raw === "") return { offerId: "" };
  const offerId = String(raw).trim();
  if (!offerId || offerId === "null" || offerId === "undefined") return { offerId: "" };
  return { offerId };
}

/** Copy retired topic ids onto the current ids when the new value is still unset. */
export function copyLegacyIntentSettings(intents, answers = {}) {
  const copyToggle = (from, to) => {
    if (typeof intents?.[from] === "boolean" && typeof intents?.[to] !== "boolean") intents[to] = intents[from];
  };
  const copyAnswer = (from, to) => {
    if (answers?.[from] != null && (answers[to] == null || answers[to] === "")) answers[to] = answers[from];
  };
  for (const [from, to] of Object.entries(INTENT_ALIASES)) {
    copyToggle(from, to);
    copyAnswer(from, to);
  }
  copyToggle("demo_or_pilot", "demo");
  copyToggle("demo_or_pilot", "trial");
  copyAnswer("demo_or_pilot", "demo");
  copyAnswer("demo_or_pilot", "trial");
}

/** Accept retired ids on a rules save without overriding an explicit new id. */
export function expandLegacyIntentToggles(incoming) {
  const source = incoming && typeof incoming === "object" ? { ...incoming } : {};
  for (const [from, to] of Object.entries(INTENT_ALIASES)) {
    if (typeof source[from] === "boolean" && typeof source[to] !== "boolean") source[to] = source[from];
  }
  if (typeof source.demo_or_pilot === "boolean") {
    if (typeof source.demo !== "boolean") source.demo = source.demo_or_pilot;
    if (typeof source.trial !== "boolean") source.trial = source.demo_or_pilot;
  }
  return source;
}

export function expandLegacyAnswers(incoming) {
  if (!incoming || typeof incoming !== "object") return incoming;
  const source = { ...incoming };
  for (const [from, to] of Object.entries(INTENT_ALIASES)) {
    if (source[from] != null && source[to] == null) source[to] = source[from];
  }
  if (source.demo_or_pilot != null) {
    if (source.demo == null) source.demo = source.demo_or_pilot;
    if (source.trial == null) source.trial = source.demo_or_pilot;
  }
  return source;
}

/** A topic argument that is already a catalog id or a retired alias. Loose wording returns null. */
export function exactStandardIntent(raw) {
  const normalized = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  if (ASSISTANCE_INTENT_IDS.includes(normalized)) return normalized;
  if (INTENT_ALIASES[normalized]) return INTENT_ALIASES[normalized];
  return null;
}

/** Known topic id, or null when the phrase does not match the catalog. */
export function matchAssistanceIntent(rawIntent, haystack = "") {
  const normalized = String(rawIntent ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const summary = String(haystack ?? "").toLowerCase();
  if (STANDARD_ASSISTANCE_INTENTS.some(intent => intent.id === normalized)) return normalized;
  if (INTENT_ALIASES[normalized]) return INTENT_ALIASES[normalized];
  if (normalized === "demo_or_pilot") {
    return /\b(trial|trials|pilot|pilots|sandbox|sandboxes|evaluation|evaluations)\b/.test(summary) ? "trial" : "demo";
  }
  const blob = `${normalized.replace(/_/g, " ")} ${summary}`.trim();
  return matchTopic(blob) || personRequest(blob, normalized);
}

export function classifyTopicText(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text.trim()) return null;
  return matchTopic(text);
}

function matchTopic(blob) {
  if (/\b(stakeholder|stakeholders|champion|decision maker)\b|\bwho else\b|\bbuying process\b/.test(blob)) return "buying_process";
  for (const [id, pattern] of TOPIC_PATTERNS) {
    if (id === "pricing") {
      if (matchBuyingProcess(blob)) return "buying_process";
    }
    if (pattern.test(blob)) return id;
  }
  if (matchBuyingProcess(blob)) return "buying_process";
  return null;
}

function matchBuyingProcess(blob) {
  if (/\b(stakeholder|stakeholders|champion|decision maker)\b|\bwho else\b/.test(blob)) return true;
  const budget = /\bbudget\b/.test(blob);
  const timing = /\b(timing|timeline)\b/.test(blob);
  if (budget && timing) return true;
  if ((budget || timing) && !/\b(price|prices|pricing|cost|costs|plan|plans)\b/.test(blob)) return true;
  return false;
}

function personRequest(blob, normalized) {
  if (/\b(support|talk|speak|chat|help|human|representative|agent|person)\b/.test(blob) || /support|talk|help/.test(normalized)) {
    return "demo";
  }
  return null;
}

function resolveAssistanceIntent(rawIntent, haystack) {
  return matchAssistanceIntent(rawIntent, haystack) ?? ASSISTANCE_INTENT_IDS[0];
}
