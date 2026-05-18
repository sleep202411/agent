"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { PERSONA_TONE_CLASSES, getPersonaFromForcedKey } from "@/src/lib/assistant/personas";
import type { ForcedPersonaKey } from "@repo/shared";

/** Re-export so chat-composer / message-bubble / etc. can import from
 *  this file without pulling in @repo/shared directly. */
export type { ForcedPersonaKey };

/**
 * Personas the user can pin via the composer's quick-action pills.
 * Selecting a pill makes the next message bypass supervisor routing
 * and dispatch directly to the matching `ask_*` tool. The chip in the
 * input + tone-coloured ring + this pill row all read from the same
 * Redux field (`conversation.forcedPersona`) — single source of truth.
 */
const FORCED_PERSONAS: { key: ForcedPersonaKey; labelKey: string }[] = [
  // Writing roles first (upstream of the pipeline), then visual asset
  // designers in the order they appear in the production flow.
  { key: "episode_planner", labelKey: "forcePersonaEpisodePlanner" },
  { key: "scriptwriter", labelKey: "forcePersonaScriptwriter" },
  { key: "character_designer", labelKey: "forcePersonaCharacter" },
  { key: "scene_designer", labelKey: "forcePersonaScene" },
  { key: "prop_designer", labelKey: "forcePersonaProp" },
  { key: "storyboard_designer", labelKey: "forcePersonaStoryboard" },
];

interface ForcePersonaPillsProps {
  value: ForcedPersonaKey | null;
  onChange: (next: ForcedPersonaKey | null) => void;
  disabled?: boolean;
}

export function ForcePersonaPills({ value, onChange, disabled }: ForcePersonaPillsProps) {
  const t = useTranslations("ai");
  return (
    // overflow-x-auto + flex-nowrap so the row scrolls horizontally
    // when the count exceeds composer width. `[scrollbar-width:none]`
    // hides the native scrollbar (Firefox); the webkit pseudo-rule
    // covers Chromium / Safari. Touch devices keep momentum scroll.
    <div
      className={cn(
        "flex items-center gap-1.5 overflow-x-auto",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
    >
      {FORCED_PERSONAS.map(({ key, labelKey }) => {
        const persona = getPersonaFromForcedKey(key);
        const active = value === key;
        const tone = PERSONA_TONE_CLASSES[persona.tone];
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? null : key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? tone
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
            title={t(`personas.${persona.nameKey}`)}
          >
            <persona.icon className="size-3" />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
