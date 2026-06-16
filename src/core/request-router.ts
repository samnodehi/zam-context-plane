/**
 * Phase 3: Deterministic Request Router (classifier).
 *
 * Pure, offline, deterministic classification of a raw request string into one of
 * the 10 canonical prompt families. Replaces the always-`general_default` stub on
 * the no-signals path (C1). No model/network calls — same input always yields the
 * same output.
 *
 * Design (docs/33):
 *   - SAFETY BIAS (DQ-4): the router asserts a narrowing family ONLY on a strong,
 *     unambiguous signal. Any ambiguity (≥2 families) or weak/no signal resolves to
 *     `general_default` — the safe, fuller-context floor. This mirrors the project
 *     invariant: smaller context only when safe.
 *   - `simple_greeting` (the most omit-heavy family) is asserted ONLY when the ENTIRE
 *     trimmed request is a greeting/acknowledgement — never on a partial/substring match.
 *   - Families the router will assert (DQ-2): simple_greeting, coding_build_debug,
 *     research_investigation, ops_security_change_risk, history_sensitive.
 *   - Families the router NEVER asserts (not reliably text-detectable; left to caller/
 *     model signals or the default): heartbeat_proactive, group_chat_behavior,
 *     lifecycle_internal, tool_use_required.
 *   - Confidence (DQ-3): a confident classification is ≥ the default failOpenThreshold
 *     (0.7) so selectors use the family; `general_default` is returned with 0.0 so
 *     selectors stay in the safe default behavior.
 *
 * Canonical: docs/33; docs/06 §2.1–§2.2.
 */

/** Result of a deterministic classification pass. */
export interface RouterResult {
  /** A PromptFamilyValue enum string (always schema-valid). */
  promptFamily: string;
  /** Float 0.0–1.0. ≥0.7 for a confident family; 0.0 for general_default fallback. */
  familyConfidence: number;
  /** True when the router fell back to general_default (no confident classification). */
  defaulted: boolean;
}

const GENERAL_DEFAULT = 'general_default';

/** Confidence for a confident single-family classification (≥ default failOpenThreshold). */
const CONFIDENT = 0.85;
/** Confidence for a whole-string greeting/acknowledgement match. */
const GREETING_CONFIDENCE = 0.9;

/**
 * Whole-string greeting/acknowledgement. The ENTIRE trimmed request must be a
 * greeting or short ack — a substantive request that merely begins with "hi" does
 * not match (DQ-4). Anchored at both ends.
 */
const GREETING_WHOLE_STRING =
  /^(hi|hello|hey|howdy|greetings|yo|sup|hola|salam|salaam|good\s+(morning|afternoon|evening|day)|thanks|thank\s+you|thx|ty|ok|okay|k|got\s+it|sure|alright|yes|yep|yeah|no|nope|understood|roger|cool|great|fine|np)[\s!?.…]*$/i;

/**
 * Strong, specific signal patterns per detectable family. Kept deliberately narrow
 * to minimize spurious ambiguity — a family is only a candidate when a clear,
 * domain-specific term appears. Order is irrelevant (set membership only).
 */
const FAMILY_SIGNALS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'coding_build_debug',
    /\b(code|coding|debug(?:ging)?|stack\s?trace|exception|compile|compiler|refactor|npm|git|typescript|javascript|python|lint(?:er)?|unit\s+test|syntax\s+error|build\s+error|null\s+pointer|segfault)\b/i,
  ],
  [
    'research_investigation',
    /\b(research|investigate|look\s+up|compare|summari[sz]e|analy[sz]e|literature|cite|sources?)\b/i,
  ],
  [
    'ops_security_change_risk',
    /\b(deploy(?:ment)?|production|prod\b|delete|drop\s+table|truncate|credential|secret|password|api\s+key|permission|vulnerab|migrate|migration|rollback|sudo|rm\s+-rf|firewall|infrastructure)\b/i,
  ],
  [
    'history_sensitive',
    /\b(as\s+i\s+(said|mentioned)|as\s+we\s+discussed|earlier\s+you|previously|last\s+time|you\s+said|going\s+back\s+to)\b/i,
  ],
];

/**
 * Classify a raw request string deterministically. Pure function — no I/O, no
 * randomness, no locale-dependent operations.
 *
 * Algorithm (docs/33 DQ-1..4):
 *   1. Empty/whitespace → general_default (0.0, defaulted).
 *   2. Whole-string greeting/ack → simple_greeting (0.9).
 *   3. Collect the set of detectable families with a strong signal.
 *      - Exactly one family → that family (0.85).
 *      - Zero or ≥2 families (ambiguous) → general_default (0.0, defaulted).
 *
 * Canonical: docs/33.
 */
export function classifyRequest(requestText: string): RouterResult {
  const trimmed = (requestText ?? '').trim();

  // 1. Empty / whitespace-only.
  if (trimmed.length === 0) {
    return { promptFamily: GENERAL_DEFAULT, familyConfidence: 0.0, defaulted: true };
  }

  // 2. Whole-string greeting/acknowledgement (most omit-heavy family — strict match).
  if (GREETING_WHOLE_STRING.test(trimmed)) {
    return { promptFamily: 'simple_greeting', familyConfidence: GREETING_CONFIDENCE, defaulted: false };
  }

  // 3. Collect distinct detectable families with a strong signal.
  const matched: string[] = [];
  for (const [family, pattern] of FAMILY_SIGNALS) {
    if (pattern.test(trimmed)) {
      matched.push(family);
    }
  }

  // Exactly one unambiguous family → assert it. Otherwise fail open to general_default.
  if (matched.length === 1) {
    return { promptFamily: matched[0]!, familyConfidence: CONFIDENT, defaulted: false };
  }

  return { promptFamily: GENERAL_DEFAULT, familyConfidence: 0.0, defaulted: true };
}
