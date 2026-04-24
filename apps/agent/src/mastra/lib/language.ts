/**
 * Language-control helpers for persona prompts.
 *
 * Why this exists:
 *   Supervisor + persona system prompts are authored in Chinese, so DeepSeek /
 *   Qwen / Claude default to Chinese output even when the user is working in
 *   an English UI. Chrome (buttons, labels) is i18n-covered, but story
 *   content (outline titles, role names, scripts, storyboards) still leaks.
 *
 *   This helper lets any call site append a strict "output language" footer
 *   to the user-prompt, which the model follows more reliably than a system-
 *   prompt rule. Append-at-end is intentional: LLMs bias hardest to the
 *   most recent instruction in the user message.
 *
 * Resolution order (the caller decides, this file just formats):
 *   1. project's `dialogLanguage` (from configure_params)  — strongest intent
 *   2. frontend `userLocale`                                — UI hint
 *   3. `"en-US"`                                            — default
 */
const LANGUAGE_NAMES: Record<string, string> = {
  "zh-CN": "Simplified Chinese (简体中文)",
  "zh-HK": "Traditional Chinese (繁體中文)",
  "en-US": "English",
};

export type SupportedLanguage = "zh-CN" | "zh-HK" | "en-US";

/**
 * Resolve the effective content language from a bag of possibly-undefined
 * hints. Empty strings and unknown codes are treated as unset so a downstream
 * caller that blindly forwards `inputData.dialogLanguage` never produces
 * garbage.
 */
export function resolveContentLanguage(
  ...hints: Array<string | null | undefined>
): SupportedLanguage {
  for (const h of hints) {
    if (typeof h === "string" && h in LANGUAGE_NAMES) return h as SupportedLanguage;
  }
  return "en-US";
}

/**
 * Return a block of text suitable to append at the END of a persona's user
 * prompt. Kept short and assertive; mixed-language output is explicitly
 * called out because that's the common failure mode (system prompt in
 * Chinese → model sprinkles Chinese into otherwise-English output).
 */
export function contentLanguageInstruction(code: string): string {
  const label = LANGUAGE_NAMES[code] ?? LANGUAGE_NAMES["en-US"];
  return [
    "",
    "—— OUTPUT LANGUAGE ——",
    `Write ALL generated content — role names, scene names, prop names, episode titles, descriptions, outlines, dialog, narration, stage directions — in ${label}.`,
    "Do NOT mix languages. Do NOT translate proper nouns the user already wrote in another language.",
    "This rule overrides any language preference suggested by the system prompt.",
  ].join("\n");
}
