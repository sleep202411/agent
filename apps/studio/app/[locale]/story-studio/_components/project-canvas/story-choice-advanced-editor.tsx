"use client";

import type { ReactNode } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InteractiveFilmDraftContent, StoryGraphChoice } from "@/lib/story-projects-api";
import { StoryConditionEditor } from "./story-condition-editor";

type StoryEffect = StoryGraphChoice["effects"][number];
type StoryEffectKind = StoryEffect["kind"];
type StoryEffectValue = Extract<StoryEffect, { kind: "set_variable" }>["value"];
type StateVariable = InteractiveFilmDraftContent["storyBible"]["stateVariables"][number];
type StoryCharacter = InteractiveFilmDraftContent["storyBible"]["characters"][number];
type StoryEnding = InteractiveFilmDraftContent["storyBible"]["endings"][number];

const EFFECT_KINDS: StoryEffectKind[] = [
  "set_variable",
  "increment_variable",
  "set_flag",
  "adjust_relationship",
  "unlock_ending",
];

const MAX_EFFECTS = 30;
const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/u;

export interface StoryChoiceAdvancedEditorProps {
  choice: StoryGraphChoice;
  content: InteractiveFilmDraftContent;
  locale: string;
  canEdit: boolean;
  onChange: (
    patch: Partial<
      Pick<StoryGraphChoice, "accessibilityLabel" | "visibleWhen" | "effects" | "afterSelect">
    >
  ) => void;
}

export function StoryChoiceAdvancedEditor({
  choice,
  content,
  locale,
  canEdit,
  onChange,
}: StoryChoiceAdvancedEditorProps) {
  const t = useTranslations("storyStudio.canvas.choiceAdvanced");
  const stateVariables = content.storyBible.stateVariables;
  const numberVariables = stateVariables.filter(
    (variable): variable is Extract<StateVariable, { type: "number" }> => variable.type === "number"
  );
  const characters = content.storyBible.characters;
  const endings = content.storyBible.endings;
  const reactionClips = content.graph.nodes.filter((node) => node.kind === "clip");
  const reactionClipKey =
    choice.afterSelect.kind === "play" ? choice.afterSelect.reactionClipKey : null;

  const updateAccessibilityLabel = (value: string) => {
    const localized = { ...choice.accessibilityLabel };
    if (value) localized[locale] = value;
    else delete localized[locale];
    onChange({
      accessibilityLabel: Object.keys(localized).length > 0 ? localized : undefined,
    });
  };

  const updateEffect = (index: number, effect: StoryEffect) => {
    onChange({
      effects: choice.effects.map((candidate, candidateIndex) =>
        candidateIndex === index ? effect : candidate
      ),
    });
  };

  const addEffect = (kind: StoryEffectKind) => {
    const effect = createDefaultEffect(kind, content);
    if (!effect) return;
    onChange({ effects: [...choice.effects, effect] });
  };

  const removeEffect = (index: number) => {
    onChange({ effects: choice.effects.filter((_, candidateIndex) => candidateIndex !== index) });
  };

  return (
    <div className="mt-3 space-y-4 rounded-[16px] bg-black/18 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <label className="block">
        <FieldLabel>{t("accessibilityLabel")}</FieldLabel>
        <Input
          value={choice.accessibilityLabel?.[locale] ?? ""}
          maxLength={4_000}
          disabled={!canEdit}
          placeholder={t("accessibilityPlaceholder")}
          onChange={(event) => updateAccessibilityLabel(event.target.value)}
          className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3"
        />
      </label>

      <section>
        <FieldLabel>{t("visibility")}</FieldLabel>
        <div className="mt-1.5">
          {choice.visibleWhen ? (
            <StoryConditionEditor
              value={choice.visibleWhen}
              content={content}
              canEdit={canEdit}
              onChange={(visibleWhen) => onChange({ visibleWhen })}
              onRemove={() => onChange({ visibleWhen: undefined })}
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canEdit}
              onClick={() =>
                onChange({
                  visibleWhen: {
                    kind: "flag",
                    flag: "flag:new",
                    equals: true,
                  },
                })
              }
              className="w-full"
            >
              <IconPlus />
              {t("addVisibilityCondition")}
            </Button>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{t("effects")}</FieldLabel>
          <Select
            value=""
            disabled={!canEdit || choice.effects.length >= MAX_EFFECTS}
            onValueChange={(value) => addEffect(value as StoryEffectKind)}
          >
            <SelectTrigger className="h-7! min-w-32 rounded-lg bg-white/[0.055] px-2">
              <SelectValue placeholder={t("addEffect")} />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {EFFECT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind} disabled={!canCreateEffect(kind, content)}>
                  {t(`effectKinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {choice.effects.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-[10px] leading-4 text-white/32">
            {t("noEffects")}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {choice.effects.map((effect, index) => (
              <div key={`${effect.kind}:${index}`} className="rounded-xl bg-white/[0.045] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold text-white/58">
                    {t(`effectKinds.${effect.kind}`)}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!canEdit}
                    onClick={() => removeEffect(index)}
                    aria-label={t("removeEffect")}
                    title={t("removeEffect")}
                    className="text-white/34 hover:text-destructive"
                  >
                    <IconTrash />
                  </Button>
                </div>
                <EffectFields
                  effect={effect}
                  stateVariables={stateVariables}
                  numberVariables={numberVariables}
                  characters={characters}
                  endings={endings}
                  locale={locale}
                  canEdit={canEdit}
                  onChange={(nextEffect) => updateEffect(index, nextEffect)}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <FieldLabel>{t("afterSelect")}</FieldLabel>
        <Select
          value={choice.afterSelect.kind}
          disabled={!canEdit}
          onValueChange={(kind) => {
            if (kind === "immediate") {
              onChange({ afterSelect: { kind: "immediate" } });
              return;
            }
            const firstClip = reactionClips[0];
            if (firstClip) {
              onChange({
                afterSelect: { kind: "play", reactionClipKey: firstClip.clipKey },
              });
            }
          }}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-white/[0.055] px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="immediate">{t("afterSelectKinds.immediate")}</SelectItem>
            <SelectItem value="play" disabled={reactionClips.length === 0}>
              {t("afterSelectKinds.play")}
            </SelectItem>
          </SelectContent>
        </Select>

        {reactionClipKey !== null ? (
          <label className="mt-2 block">
            <FieldLabel>{t("reactionClip")}</FieldLabel>
            <Select
              value={reactionClipKey}
              disabled={!canEdit || reactionClips.length === 0}
              onValueChange={(reactionClipKey) =>
                onChange({ afterSelect: { kind: "play", reactionClipKey } })
              }
            >
              <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-white/[0.055] px-3 font-mono">
                <SelectValue placeholder={t("selectReactionClip")} />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {!reactionClips.some((node) => node.clipKey === reactionClipKey) ? (
                  <SelectItem value={reactionClipKey} disabled>
                    {reactionClipKey}
                  </SelectItem>
                ) : null}
                {reactionClips.map((node) => (
                  <SelectItem key={node.nodeId} value={node.clipKey}>
                    {node.clipKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}
      </section>
    </div>
  );
}

function EffectFields({
  effect,
  stateVariables,
  numberVariables,
  characters,
  endings,
  locale,
  canEdit,
  onChange,
}: {
  effect: StoryEffect;
  stateVariables: StateVariable[];
  numberVariables: Array<Extract<StateVariable, { type: "number" }>>;
  characters: StoryCharacter[];
  endings: StoryEnding[];
  locale: string;
  canEdit: boolean;
  onChange: (effect: StoryEffect) => void;
}) {
  const t = useTranslations("storyStudio.canvas.choiceAdvanced");

  if (effect.kind === "set_variable") {
    const variable = stateVariables.find((candidate) => candidate.key === effect.key);
    return (
      <div className="mt-3 grid gap-2">
        <label>
          <FieldLabel>{t("variable")}</FieldLabel>
          <Select
            value={effect.key}
            disabled={!canEdit || stateVariables.length === 0}
            onValueChange={(key) => {
              const nextVariable = stateVariables.find((candidate) => candidate.key === key);
              if (nextVariable) {
                onChange({ kind: "set_variable", key, value: nextVariable.initialValue });
              }
            }}
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3 font-mono">
              <SelectValue placeholder={t("selectVariable")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {!variable && effect.key ? (
                <SelectItem value={effect.key} disabled>
                  {effect.key}
                </SelectItem>
              ) : null}
              {stateVariables.map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <VariableValueEditor
          variable={variable}
          value={effect.value}
          canEdit={canEdit}
          onChange={(value) => onChange({ ...effect, value })}
        />
      </div>
    );
  }

  if (effect.kind === "increment_variable") {
    const variable = numberVariables.find((candidate) => candidate.key === effect.key);
    return (
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <label>
          <FieldLabel>{t("variable")}</FieldLabel>
          <Select
            value={effect.key}
            disabled={!canEdit || numberVariables.length === 0}
            onValueChange={(key) => onChange({ ...effect, key })}
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3 font-mono">
              <SelectValue placeholder={t("selectVariable")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {!variable && effect.key ? (
                <SelectItem value={effect.key} disabled>
                  {effect.key}
                </SelectItem>
              ) : null}
              {numberVariables.map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label={t("amount")}
          value={effect.amount}
          disabled={!canEdit || !variable}
          onChange={(amount) => onChange({ ...effect, amount })}
        />
      </div>
    );
  }

  if (effect.kind === "set_flag") {
    return (
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <label>
          <FieldLabel>{t("flag")}</FieldLabel>
          <StableIdInput
            value={effect.flag}
            disabled={!canEdit}
            onChange={(flag) => onChange({ ...effect, flag })}
          />
        </label>
        <label>
          <FieldLabel>{t("value")}</FieldLabel>
          <BooleanSelect
            value={effect.value}
            disabled={!canEdit}
            onChange={(value) => onChange({ ...effect, value })}
          />
        </label>
      </div>
    );
  }

  if (effect.kind === "adjust_relationship") {
    const character = characters.find((candidate) => candidate.id === effect.characterId);
    return (
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_96px] gap-2">
        <label>
          <FieldLabel>{t("character")}</FieldLabel>
          <Select
            value={effect.characterId}
            disabled={!canEdit || characters.length === 0}
            onValueChange={(characterId) => onChange({ ...effect, characterId })}
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
              <SelectValue placeholder={t("selectCharacter")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {!character && effect.characterId ? (
                <SelectItem value={effect.characterId} disabled>
                  {effect.characterId}
                </SelectItem>
              ) : null}
              {characters.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {localizedValue(candidate.name, locale) || candidate.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label={t("amount")}
          value={effect.amount}
          disabled={!canEdit || !character}
          onChange={(amount) => onChange({ ...effect, amount })}
        />
      </div>
    );
  }

  const ending = endings.find((candidate) => candidate.id === effect.endingId);
  return (
    <label className="mt-3 block">
      <FieldLabel>{t("ending")}</FieldLabel>
      <Select
        value={effect.endingId}
        disabled={!canEdit || endings.length === 0}
        onValueChange={(endingId) => onChange({ ...effect, endingId })}
      >
        <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
          <SelectValue placeholder={t("selectEnding")} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {!ending && effect.endingId ? (
            <SelectItem value={effect.endingId} disabled>
              {effect.endingId}
            </SelectItem>
          ) : null}
          {endings.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {localizedValue(candidate.title, locale) || candidate.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function VariableValueEditor({
  variable,
  value,
  canEdit,
  onChange,
}: {
  variable?: StateVariable;
  value: StoryEffectValue;
  canEdit: boolean;
  onChange: (value: StoryEffectValue) => void;
}) {
  const t = useTranslations("storyStudio.canvas.choiceAdvanced");

  if (variable?.type === "boolean") {
    return (
      <label>
        <FieldLabel>{t("value")}</FieldLabel>
        <BooleanSelect
          value={typeof value === "boolean" ? value : false}
          disabled={!canEdit}
          onChange={onChange}
        />
      </label>
    );
  }

  if (variable?.type === "number") {
    return (
      <NumberField
        label={t("value")}
        value={typeof value === "number" ? value : 0}
        disabled={!canEdit}
        onChange={onChange}
      />
    );
  }

  if (variable?.type === "string" && variable.allowedValues?.length) {
    const currentValue = typeof value === "string" ? value : "";
    const currentIndex = variable.allowedValues.indexOf(currentValue);
    return (
      <label>
        <FieldLabel>{t("value")}</FieldLabel>
        <Select
          value={currentIndex >= 0 ? `allowed:${currentIndex}` : "current"}
          disabled={!canEdit}
          onValueChange={(selectedValue) => {
            const selectedIndex = Number(selectedValue.slice("allowed:".length));
            const allowedValue = variable.allowedValues?.[selectedIndex];
            if (allowedValue !== undefined) onChange(allowedValue);
          }}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {currentIndex < 0 ? (
              <SelectItem value="current" disabled>
                {JSON.stringify(currentValue)}
              </SelectItem>
            ) : null}
            {variable.allowedValues.map((allowedValue, index) => (
              <SelectItem key={`${allowedValue}:${index}`} value={`allowed:${index}`}>
                {JSON.stringify(allowedValue)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  return (
    <label>
      <FieldLabel>{t("value")}</FieldLabel>
      <Input
        value={typeof value === "string" ? value : ""}
        maxLength={2_000}
        disabled={!canEdit || !variable}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-9 rounded-xl bg-black/18 px-3"
      />
    </label>
  );
}

function BooleanSelect({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTranslations("storyStudio.canvas.choiceAdvanced");
  return (
    <Select
      value={value ? "true" : "false"}
      disabled={disabled}
      onValueChange={(nextValue) => onChange(nextValue === "true")}
    >
      <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value="true">{t("booleans.true")}</SelectItem>
        <SelectItem value="false">{t("booleans.false")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        step="any"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const nextValue = event.target.valueAsNumber;
          if (Number.isFinite(nextValue)) onChange(nextValue);
        }}
        className="mt-1.5 h-9 rounded-xl bg-black/18 px-3 tabular-nums"
      />
    </label>
  );
}

function StableIdInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      key={value}
      defaultValue={value}
      disabled={disabled}
      maxLength={120}
      pattern="[A-Za-z][A-Za-z0-9._:-]*"
      onBlur={(event) => {
        const nextValue = event.currentTarget.value;
        if (STABLE_ID_PATTERN.test(nextValue) && nextValue.length <= 120) {
          if (nextValue !== value) onChange(nextValue);
        } else {
          event.currentTarget.value = value;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      className="mt-1.5 h-9 rounded-xl bg-black/18 px-3 font-mono"
    />
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[9px] font-semibold text-white/34">{children}</span>;
}

function canCreateEffect(kind: StoryEffectKind, content: InteractiveFilmDraftContent): boolean {
  if (kind === "set_variable") return content.storyBible.stateVariables.length > 0;
  if (kind === "increment_variable") {
    return content.storyBible.stateVariables.some((variable) => variable.type === "number");
  }
  if (kind === "adjust_relationship") return content.storyBible.characters.length > 0;
  if (kind === "unlock_ending") return content.storyBible.endings.length > 0;
  return true;
}

function createDefaultEffect(
  kind: StoryEffectKind,
  content: InteractiveFilmDraftContent
): StoryEffect | null {
  if (kind === "set_variable") {
    const variable = content.storyBible.stateVariables[0];
    return variable
      ? { kind: "set_variable", key: variable.key, value: variable.initialValue }
      : null;
  }
  if (kind === "increment_variable") {
    const variable = content.storyBible.stateVariables.find(
      (candidate) => candidate.type === "number"
    );
    return variable ? { kind: "increment_variable", key: variable.key, amount: 1 } : null;
  }
  if (kind === "set_flag") {
    return { kind: "set_flag", flag: "flag:new", value: true };
  }
  if (kind === "adjust_relationship") {
    const character = content.storyBible.characters[0];
    return character ? { kind: "adjust_relationship", characterId: character.id, amount: 1 } : null;
  }
  const ending = content.storyBible.endings[0];
  return ending ? { kind: "unlock_ending", endingId: ending.id } : null;
}

function localizedValue(value: Record<string, string>, locale: string): string {
  return value[locale] ?? Object.values(value).find((candidate) => candidate.trim()) ?? "";
}
