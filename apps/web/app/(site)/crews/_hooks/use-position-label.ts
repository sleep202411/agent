"use client";

/**
 * Translation helpers for the canonical `PRESET_POSITIONS` list.
 *
 * Why a hook (not a static map): the `crewRoles.*` keys live in
 * locale JSON, and `useTranslations` is reactive — switching language
 * automatically re-renders consumers without each component plumbing
 * the locale around.
 *
 * Three exports:
 *   - `useTranslatePositionValue(value)` — single value → label
 *     (falls back to the value itself if the key is missing, so
 *     non-preset role types from Java don't render blank)
 *   - `useTranslatedPresetPositions()` — full list { value, label }[]
 *     drop-in replacement for `PRESET_POSITIONS` in <Select> menus
 *   - `useTranslatedOwnerLabel()` — translation for `OWNER_ROLE`
 */

import { useMemo } from "react";
import { OWNER_ROLE, PRESET_POSITIONS } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";

export function useTranslatePositionValue() {
  const t = useTranslations("crewRoles");
  return (value: string): string => {
    if (!value) return "";
    if (value === OWNER_ROLE) return t("owner");
    const translated = t(value);
    // `useTranslations` returns the raw key when missing → fall back
    // to the canonical English label so unknown role types from Java
    // never render as the bare key.
    if (translated === value) {
      const preset = PRESET_POSITIONS.find((p) => p.value === value);
      return preset?.label ?? value;
    }
    return translated;
  };
}

export function useTranslatedPresetPositions() {
  const translate = useTranslatePositionValue();
  return useMemo(
    () => PRESET_POSITIONS.map((p) => ({ value: p.value, label: translate(p.value) })),
    [translate]
  );
}

export function useTranslatedOwnerLabel(): string {
  const t = useTranslations("crewRoles");
  return t("owner");
}
