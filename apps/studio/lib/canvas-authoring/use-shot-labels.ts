"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { SHOT_MOVEMENT_OPTIONS, SHOT_PERSPECTIVE_OPTIONS, SHOT_SIZE_OPTIONS } from "./shot-node";

const OPTION_GROUPS = {
  size: SHOT_SIZE_OPTIONS,
  angle: SHOT_PERSPECTIVE_OPTIONS,
  movement: SHOT_MOVEMENT_OPTIONS,
} as const;

export type ShotOptionGroup = keyof typeof OPTION_GROUPS;

export function shotOptionValues(group: ShotOptionGroup): readonly string[] {
  return OPTION_GROUPS[group];
}

/**
 * Translates a stored option key (`closeUp`) into its display label. The CRDT
 * holds locale-free keys, so the same board reads correctly in every language —
 * and a key this build doesn't know (written by a newer client) renders verbatim
 * instead of throwing the row away.
 */
export function useShotOptionLabel() {
  const t = useTranslations("storyboard");
  return useCallback(
    (group: ShotOptionGroup, value: string | undefined | null): string | null => {
      if (!value) return null;
      return OPTION_GROUPS[group].includes(value as never) ? t(`option.${group}.${value}`) : value;
    },
    [t]
  );
}
