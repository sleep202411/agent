import { z } from "zod";
import { ApiRequestError } from "@/lib/api-client";
import type { useTranslations } from "@/i18n";
const qualification = z.object({
  code: z.literal("CREW_QUALIFICATIONS_REQUIRED"),
  requiredFdRank: z.number().int().nonnegative(),
  missingSkills: z.array(z.string().trim().min(1).max(64)).max(20),
});
/** Only interpret the server's explicit qualification denial; never infer eligibility. */
export function crewApplicationError(error: unknown, t: ReturnType<typeof useTranslations>) {
  const message =
    error instanceof Error && error.message.trim() ? error.message : t("crewDetail.applyFailed");
  if (!(error instanceof ApiRequestError) || error.status !== 403 || !error.responseBody)
    return message;
  try {
    const parsed = qualification.safeParse(JSON.parse(error.responseBody));
    if (!parsed.success) return message;
    const { requiredFdRank, missingSkills } = parsed.data;
    return [
      message,
      t("crewSkills.qualificationTitle"),
      missingSkills.length
        ? `${t("crewSkills.label")}: ${[...new Set(missingSkills)].join(", ")}`
        : "",
      requiredFdRank > 0
        ? t("crewSkills.minimumRank").replace("{rank}", String(requiredFdRank))
        : "",
      t("crewSkills.qualificationHint"),
    ]
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return message;
  }
}
