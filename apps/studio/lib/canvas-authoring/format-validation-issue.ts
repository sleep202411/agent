import type { ValidationIssue } from "@repo/shared";

/** Compatible with next-intl `useTranslations(...)` return type. */
type Translate = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Map catalog ValidationIssue codes to studio i18n. Falls back to the
 * English `message` from the shared kernel when a code has no translation.
 *
 * Namespace: callers pass a `t` bound to `canvasOps` or `generation`.
 * Keys live under `validation.<CODE>` with params matching issue.params.
 */
export function formatValidationIssue(t: Translate, issue: ValidationIssue): string {
  const key = `validation.${issue.code}`;
  const params = paramsForI18n(issue);
  try {
    const translated = t(key, params);
    // next-intl returns the key path when missing — treat that as a miss.
    if (!translated || translated === key || translated.endsWith(`.${issue.code}`)) {
      return issue.message;
    }
    return translated;
  } catch {
    return issue.message;
  }
}

export function formatValidationIssues(t: Translate, issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => formatValidationIssue(t, issue));
}

function paramsForI18n(issue: ValidationIssue): Record<string, string | number | Date> {
  const raw = issue.params ?? {};
  const out: Record<string, string | number | Date> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number") {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value ? "true" : "false";
    } else if (value != null) {
      out[key] = String(value);
    }
  }
  // Round duration-ish floats for display.
  for (const key of ["actual", "max", "min"] as const) {
    const v = out[key];
    if (typeof v === "number" && !Number.isInteger(v)) {
      out[key] = Math.round(v * 10) / 10;
    }
  }
  return out;
}
