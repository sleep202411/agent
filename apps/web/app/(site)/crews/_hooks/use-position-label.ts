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
 *   - `useTranslatedOwnerLabel()` — ownership label (not a position)
 */

import { useMemo } from "react";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { useTranslations } from "@/src/i18n/i18n";
import type { CrewMemberDTO } from "@repo/shared/crew";

export function useTranslatePositionValue() {
  const t = useTranslations("crewRoles");
  return (value: string): string => {
    if (!value) return "";
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

export function useCrewMemberPositionLabel() {
  const translate = useTranslatePositionValue();
  const t = useTranslations("workspace");
  return (member: CrewMemberDTO): string => {
    const position =
      member.positions.find((candidate) => candidate.isPrimary) ?? member.positions[0];
    return (
      position?.title ||
      (position?.categoryKey ? translate(position.categoryKey) : t("memberRoleMember"))
    );
  };
}
