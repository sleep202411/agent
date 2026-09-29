import { isPresetPosition } from "@repo/shared/crew";
import type { MessageKey } from "@/i18n";

/** Translate only canonical role codes; custom job titles are user content. */
export function crewPositionLabel(value: string, t: (key: MessageKey) => string): string {
  return isPresetPosition(value) ? t(`crewRoles.${value}`) : value;
}
