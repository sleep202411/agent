/**
 * Content-policy detection shared by every provider error mapper.
 *
 * A provider that moderates the prompt (OpenAI via fal, ModelArk, Model Studio,
 * …) returns a 4xx that is NOT a caller mistake — the inputs are well-formed, the
 * content is refused. Collapsing it into VALIDATION_ERROR tells the user to
 * "check the inputs", which is misleading: the fix is to reword the prompt, not
 * to correct a parameter. We surface it as its own terminal code so the client
 * can say the true thing.
 *
 * Providers disagree on how they signal it, so this matches on the two stable
 * shapes we have evidence for, plus a conservative phrase fallback:
 *   - fal.ai: a documented `type: "content_policy_violation"` in the JSON body
 *     (https://docs.fal.ai/errors#content_policy_violation).
 *   - everyone else: a moderation phrase in the raw message. Kept deliberately
 *     tight — a false positive mislabels a genuine parameter error, so the list
 *     is only unambiguous moderation language, not every word that could appear
 *     in an unrelated validation message.
 */

/** Unambiguous moderation phrases. Lower-cased substring match on the raw body. */
const CONTENT_POLICY_PHRASES: readonly string[] = [
  'content_policy_violation',
  'content policy',
  'flagged by a content checker',
  'content moderation',
  'safety system',
  'sensitive content',
  'data may contain inappropriate content', // Alibaba Model Studio
  'data inspection failed', // ModelArk / DashScope moderation
  'input data may contain inappropriate content',
  'risk control', // ModelArk 内容风控
  'output data may contain sensitive information',
];

/**
 * True when a provider's 4xx is a content-moderation refusal rather than a
 * malformed request. `raw` is the provider's response body (any shape); we
 * stringify defensively because mappers hand us either a string or the parsed
 * object depending on the call site.
 */
export function isContentPolicyViolation(raw: unknown): boolean {
  const text = (
    typeof raw === 'string' ? raw : safeStringify(raw)
  ).toLowerCase();
  if (!text) return false;
  return CONTENT_POLICY_PHRASES.some((phrase) => text.includes(phrase));
}

function safeStringify(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    // A non-serializable body (circular ref) can't be scanned; treat as
    // "no moderation signal found" rather than coercing to "[object Object]".
    return '';
  }
}

/**
 * The user-facing message for a content-policy refusal. English here (the app's
 * default); the client remaps by error code to its own localized copy, so this
 * is only the fallback for a client that does not recognize the code.
 */
export const CONTENT_POLICY_USER_MESSAGE =
  'This request was blocked by content moderation. Avoid copyrighted characters, real people, or sensitive content, then adjust the prompt and try again.';
