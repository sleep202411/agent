import type { AnyExportedSpan, CustomSpanFormatter } from "@mastra/core/observability";

const PRIVATE_ATTRIBUTE_KEYS = new Set([
  "instructions",
  "providerOptions",
  "prompt",
  "completion",
  "input",
  "output",
]);

/**
 * The OTLP exporter maps span input/output into GenAI content attributes.
 * FizzDragon exports operational metadata only: prompts, model output, tool
 * payloads, provider options, and stack traces stay inside the execution
 * boundary.
 */
export const privacyPreservingSpanFormatter: CustomSpanFormatter = (span) => {
  const attributes = sanitizeAttributes(span.attributes);
  const errorInfo = span.errorInfo
    ? {
        id: span.errorInfo.id,
        name: span.errorInfo.name,
        domain: span.errorInfo.domain,
        category: span.errorInfo.category,
        message: span.errorInfo.id
          ? `Operation failed with ${span.errorInfo.id}.`
          : "Operation failed.",
      }
    : undefined;

  return {
    ...span,
    attributes,
    input: undefined,
    output: undefined,
    errorInfo,
  } as AnyExportedSpan;
};

function sanitizeAttributes<T>(attributes: T): T {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return attributes;
  }

  const sanitized = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !PRIVATE_ATTRIBUTE_KEYS.has(key))
  );
  return sanitized as T;
}
