import type { CrewPolicyKey } from "@repo/shared/crew";

/**
 * UI presets for the crew's additive access policies.
 *
 * These are deliberately presentation-layer shortcuts, not authorization
 * roles. The API and database continue to store atomic `policyKeys` so an
 * administrator never silently inherits finance access.
 */
export const CREW_ACCESS_PRESETS = ["standard", "finance", "admin", "admin_finance"] as const;
export const CREW_INVITE_ACCESS_PRESETS = ["standard", "finance", "admin"] as const;

export type CrewAccessPreset = (typeof CREW_ACCESS_PRESETS)[number];
export type CrewInviteAccessPreset = (typeof CREW_INVITE_ACCESS_PRESETS)[number];

const CREW_ACCESS_PRESET_SET = new Set<string>(CREW_ACCESS_PRESETS);
const CREW_INVITE_ACCESS_PRESET_SET = new Set<string>(CREW_INVITE_ACCESS_PRESETS);

const POLICY_KEYS_BY_PRESET: Record<CrewAccessPreset, readonly CrewPolicyKey[]> = {
  standard: [],
  finance: ["finance"],
  admin: ["admin"],
  admin_finance: ["admin", "finance"],
};

export function isCrewAccessPreset(value: string): value is CrewAccessPreset {
  return CREW_ACCESS_PRESET_SET.has(value);
}

export function isCrewInviteAccessPreset(value: string): value is CrewInviteAccessPreset {
  return CREW_INVITE_ACCESS_PRESET_SET.has(value);
}

export function policyKeysForAccessPreset(preset: CrewAccessPreset): CrewPolicyKey[] {
  return [...POLICY_KEYS_BY_PRESET[preset]];
}

export function accessPresetForPolicyKeys(policyKeys: readonly CrewPolicyKey[]): CrewAccessPreset {
  const hasAdmin = policyKeys.includes("admin");
  const hasFinance = policyKeys.includes("finance");

  if (hasAdmin && hasFinance) return "admin_finance";
  if (hasAdmin) return "admin";
  if (hasFinance) return "finance";
  return "standard";
}
