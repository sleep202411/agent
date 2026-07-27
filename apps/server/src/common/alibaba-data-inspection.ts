/**
 * DashScope's built-in input/output content inspection ("绿网") hard-rejects
 * sensitive creator source material — a film screenplay dealing with death or
 * violence, for instance — with "Input text data may contain inappropriate
 * content", which brings down the copilot stream and the story-patch author
 * before either can produce a single token.
 *
 * This header tells DashScope to skip that inspection — the exact header the
 * Bailian image/video provider and the Java backend already send on their 万相
 * calls. It is gated by `ALIBABA_DISABLE_DATA_INSPECTION` (default: skip) so a
 * region/cell that must keep provider-side moderation (e.g. a CN-mainland
 * deployment) can force it back on with `=false`.
 *
 * Matches the `BAILIAN_DISABLE_DATA_INSPECTION` gate on the generation side.
 */
const DATA_INSPECTION_DISABLE_HEADER = {
  'X-DashScope-DataInspection': '{"input":"disable","output":"disable"}',
} as const;

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Extra headers for every `@ai-sdk/alibaba` provider the platform builds
 * (copilot, story-patch author, …). Empty when inspection stays enabled.
 */
export function alibabaProviderHeaders(): Record<string, string> {
  const skipInspection = boolEnv(
    process.env.ALIBABA_DISABLE_DATA_INSPECTION,
    true,
  );
  return skipInspection ? { ...DATA_INSPECTION_DISABLE_HEADER } : {};
}
