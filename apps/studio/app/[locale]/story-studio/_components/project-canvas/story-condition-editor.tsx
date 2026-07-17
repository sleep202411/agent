"use client";

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
import type {
  StoryCondition,
  InteractiveFilmDraftContent,
  StoryScalarValue,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

type ConditionKind = StoryCondition["kind"];
type VariableCondition = Extract<StoryCondition, { kind: "variable" }>;
type StateVariable = InteractiveFilmDraftContent["storyBible"]["stateVariables"][number];

const CONDITION_KINDS: ConditionKind[] = [
  "flag",
  "variable",
  "relationship-at-least",
  "all",
  "any",
  "not",
];
const NUMBER_OPERATORS: VariableCondition["operator"][] = [
  "equals",
  "not_equals",
  "greater_than",
  "at_least",
  "less_than",
  "at_most",
];
const EQUALITY_OPERATORS: VariableCondition["operator"][] = ["equals", "not_equals"];
const STABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]*$/u;
const MAX_STABLE_ID_LENGTH = 120;
const MAX_SCALAR_STRING_LENGTH = 2_000;
const MAX_GROUP_CONDITIONS = 50;
const MAX_EDITOR_DEPTH = 6;

export interface StoryConditionEditorProps {
  value: StoryCondition;
  content: InteractiveFilmDraftContent;
  canEdit: boolean;
  onChange: (value: StoryCondition) => void;
  onRemove?: () => void;
  depth?: number;
}

export function StoryConditionEditor({
  value,
  content,
  canEdit,
  onChange,
  onRemove,
  depth = 0,
}: StoryConditionEditorProps) {
  const t = useTranslations("storyStudio.canvas.condition");
  const variables = content.storyBible.stateVariables;
  const characters = content.storyBible.characters;
  const mayNest = depth < MAX_EDITOR_DEPTH;
  const kindAvailable = (kind: ConditionKind) =>
    kind === value.kind ||
    (kind === "variable"
      ? variables.length > 0
      : kind === "relationship-at-least"
        ? characters.length > 0
        : kind === "all" || kind === "any" || kind === "not"
          ? mayNest
          : true);

  const changeKind = (kind: ConditionKind) => {
    const replacement = createCondition(kind, content, depth);
    if (replacement) onChange(replacement);
  };

  return (
    <section
      className={cn(
        "rounded-[16px] bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]",
        depth > 0 && "bg-black/15"
      )}
      aria-label={t("title")}
    >
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("kindLabel")}</span>
          <Select
            value={value.kind}
            disabled={!canEdit}
            onValueChange={(kind) => changeKind(kind as ConditionKind)}
          >
            <SelectTrigger className="h-9! w-full rounded-xl bg-white/[0.055] px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {CONDITION_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind} disabled={!kindAvailable(kind)}>
                  {t(`kinds.${kind}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {onRemove ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={onRemove}
            aria-label={t("removeCondition")}
            title={t("removeCondition")}
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/36 transition hover:bg-white/[0.1] hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconTrash className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {value.kind === "flag" ? (
          <FlagConditionFields value={value} canEdit={canEdit} onChange={onChange} />
        ) : null}
        {value.kind === "variable" ? (
          <VariableConditionFields
            value={value}
            variables={variables}
            canEdit={canEdit}
            onChange={onChange}
          />
        ) : null}
        {value.kind === "relationship-at-least" ? (
          <RelationshipConditionFields
            value={value}
            content={content}
            canEdit={canEdit}
            onChange={onChange}
          />
        ) : null}
        {value.kind === "all" || value.kind === "any" ? (
          <ConditionGroupFields
            value={value}
            content={content}
            canEdit={canEdit}
            onChange={onChange}
            depth={depth}
          />
        ) : null}
        {value.kind === "not" ? (
          <StoryConditionEditor
            value={value.condition}
            content={content}
            canEdit={canEdit}
            onChange={(condition) => onChange({ kind: "not", condition })}
            depth={depth + 1}
          />
        ) : null}
      </div>
    </section>
  );
}

function FlagConditionFields({
  value,
  canEdit,
  onChange,
}: {
  value: Extract<StoryCondition, { kind: "flag" }>;
  canEdit: boolean;
  onChange: (value: StoryCondition) => void;
}) {
  const t = useTranslations("storyStudio.canvas.condition");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
      <label className="min-w-0">
        <span className="text-[10px] font-semibold text-white/42">{t("flagLabel")}</span>
        <Input
          value={value.flag}
          disabled={!canEdit}
          maxLength={MAX_STABLE_ID_LENGTH}
          onChange={(event) => {
            const flag = event.target.value.trim();
            if (STABLE_ID_PATTERN.test(flag)) onChange({ ...value, flag });
          }}
          className="mt-1.5 h-9 rounded-xl bg-black/18 px-3 font-mono text-[10px]"
        />
      </label>
      <BooleanSelect
        label={t("equalsLabel")}
        value={value.equals}
        canEdit={canEdit}
        onChange={(equals) => onChange({ ...value, equals })}
      />
    </div>
  );
}

function VariableConditionFields({
  value,
  variables,
  canEdit,
  onChange,
}: {
  value: VariableCondition;
  variables: StateVariable[];
  canEdit: boolean;
  onChange: (value: StoryCondition) => void;
}) {
  const t = useTranslations("storyStudio.canvas.condition");
  const variable = variables.find((candidate) => candidate.key === value.key);
  const operators = variable?.type === "number" ? NUMBER_OPERATORS : EQUALITY_OPERATORS;
  const visibleOperators = operators.includes(value.operator)
    ? operators
    : [value.operator, ...operators];

  return (
    <div className="grid gap-3">
      <label>
        <span className="text-[10px] font-semibold text-white/42">{t("variableLabel")}</span>
        <Select
          value={value.key}
          disabled={!canEdit || variables.length === 0}
          onValueChange={(key) => {
            const selected = variables.find((candidate) => candidate.key === key);
            if (!selected) return;
            onChange({
              kind: "variable",
              key: selected.key,
              operator: normalizeOperator(value.operator, selected),
              value: selected.initialValue,
            });
          }}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3 font-mono">
            <SelectValue placeholder={t("noVariables")} />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {!variable ? (
              <SelectItem value={value.key} disabled>
                {t("missingReference", { id: value.key })}
              </SelectItem>
            ) : null}
            {variables.map((candidate) => (
              <SelectItem key={candidate.key} value={candidate.key}>
                {candidate.key}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="text-[10px] font-semibold text-white/42">{t("operatorLabel")}</span>
          <Select
            value={value.operator}
            disabled={!canEdit}
            onValueChange={(operator) =>
              onChange({ ...value, operator: operator as VariableCondition["operator"] })
            }
          >
            <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {visibleOperators.map((operator) => (
                <SelectItem
                  key={operator}
                  value={operator}
                  disabled={!operators.includes(operator)}
                >
                  {t(`operators.${operator}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <ScalarValueField
          label={t("valueLabel")}
          value={value.value}
          variable={variable}
          canEdit={canEdit}
          onChange={(scalar) => onChange({ ...value, value: scalar })}
        />
      </div>
    </div>
  );
}

function RelationshipConditionFields({
  value,
  content,
  canEdit,
  onChange,
}: {
  value: Extract<StoryCondition, { kind: "relationship-at-least" }>;
  content: InteractiveFilmDraftContent;
  canEdit: boolean;
  onChange: (value: StoryCondition) => void;
}) {
  const t = useTranslations("storyStudio.canvas.condition");
  const characters = content.storyBible.characters;
  const character = characters.find((candidate) => candidate.id === value.characterId);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
      <label className="min-w-0">
        <span className="text-[10px] font-semibold text-white/42">{t("characterLabel")}</span>
        <Select
          value={value.characterId}
          disabled={!canEdit || characters.length === 0}
          onValueChange={(characterId) => {
            if (characters.some((candidate) => candidate.id === characterId)) {
              onChange({ ...value, characterId });
            }
          }}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
            <SelectValue placeholder={t("noCharacters")} />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {!character ? (
              <SelectItem value={value.characterId} disabled>
                {t("missingReference", { id: value.characterId })}
              </SelectItem>
            ) : null}
            {characters.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {localizedName(candidate.name, candidate.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <NumberField
        label={t("valueLabel")}
        value={value.value}
        canEdit={canEdit}
        onChange={(nextValue) => onChange({ ...value, value: nextValue })}
      />
    </div>
  );
}

function ConditionGroupFields({
  value,
  content,
  canEdit,
  onChange,
  depth,
}: {
  value: Extract<StoryCondition, { kind: "all" | "any" }>;
  content: InteractiveFilmDraftContent;
  canEdit: boolean;
  onChange: (value: StoryCondition) => void;
  depth: number;
}) {
  const t = useTranslations("storyStudio.canvas.condition");
  const child = createDefaultLeafCondition(content);
  const canAdd =
    canEdit &&
    depth < MAX_EDITOR_DEPTH &&
    value.conditions.length < MAX_GROUP_CONDITIONS &&
    child !== null;

  return (
    <div className="grid gap-2">
      {value.conditions.map((condition, index) => (
        <StoryConditionEditor
          key={index}
          value={condition}
          content={content}
          canEdit={canEdit}
          onChange={(nextCondition) =>
            onChange({
              ...value,
              conditions: value.conditions.map((candidate, candidateIndex) =>
                candidateIndex === index ? nextCondition : candidate
              ),
            })
          }
          onRemove={
            value.conditions.length > 1
              ? () =>
                  onChange({
                    ...value,
                    conditions: value.conditions.filter(
                      (_candidate, candidateIndex) => candidateIndex !== index
                    ),
                  })
              : undefined
          }
          depth={depth + 1}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        disabled={!canAdd}
        onClick={() => {
          if (child) onChange({ ...value, conditions: [...value.conditions, child] });
        }}
        className="h-9 w-full rounded-xl bg-white/[0.045] text-white/54 hover:bg-white/[0.08] hover:text-white"
      >
        <IconPlus className="size-3.5" />
        {depth >= MAX_EDITOR_DEPTH ? t("maxDepth") : t("addCondition")}
      </Button>
    </div>
  );
}

function ScalarValueField({
  label,
  value,
  variable,
  canEdit,
  onChange,
}: {
  label: string;
  value: StoryScalarValue;
  variable: StateVariable | undefined;
  canEdit: boolean;
  onChange: (value: StoryScalarValue) => void;
}) {
  if (variable?.type === "boolean") {
    return (
      <BooleanSelect
        label={label}
        value={typeof value === "boolean" ? value : variable.initialValue}
        canEdit={canEdit}
        onChange={onChange}
      />
    );
  }
  if (variable?.type === "number") {
    return (
      <NumberField
        label={label}
        value={typeof value === "number" && Number.isFinite(value) ? value : variable.initialValue}
        minimum={variable.minimum}
        maximum={variable.maximum}
        canEdit={canEdit}
        onChange={onChange}
      />
    );
  }
  if (variable?.type === "string" && variable.allowedValues?.length) {
    const selected = typeof value === "string" ? value : variable.initialValue;
    return (
      <label>
        <span className="text-[10px] font-semibold text-white/42">{label}</span>
        <Select
          value={scalarSelectToken(selected)}
          disabled={!canEdit}
          onValueChange={(token) => onChange(scalarFromSelectToken(token))}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {!variable.allowedValues.includes(selected) ? (
              <SelectItem value={scalarSelectToken(selected)} disabled>
                {selected}
              </SelectItem>
            ) : null}
            {variable.allowedValues.map((allowedValue) => (
              <SelectItem
                key={scalarSelectToken(allowedValue)}
                value={scalarSelectToken(allowedValue)}
              >
                {allowedValue}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }
  return (
    <label>
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Input
        value={typeof value === "string" ? value : (variable?.initialValue ?? "")}
        disabled={!canEdit}
        maxLength={MAX_SCALAR_STRING_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 h-9 rounded-xl bg-black/18 px-3"
      />
    </label>
  );
}

function BooleanSelect({
  label,
  value,
  canEdit,
  onChange,
}: {
  label: string;
  value: boolean;
  canEdit: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTranslations("storyStudio.canvas.condition");
  return (
    <label>
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Select
        value={value ? "true" : "false"}
        disabled={!canEdit}
        onValueChange={(nextValue) => onChange(nextValue === "true")}
      >
        <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-black/18 px-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="true">{t("boolean.true")}</SelectItem>
          <SelectItem value="false">{t("boolean.false")}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

function NumberField({
  label,
  value,
  minimum,
  maximum,
  canEdit,
  onChange,
}: {
  label: string;
  value: number;
  minimum?: number;
  maximum?: number;
  canEdit: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="text-[10px] font-semibold text-white/42">{label}</span>
      <Input
        type="number"
        value={value}
        min={minimum}
        max={maximum}
        disabled={!canEdit}
        onChange={(event) => {
          const parsed = event.target.valueAsNumber;
          if (!Number.isFinite(parsed)) return;
          onChange(clamp(parsed, minimum, maximum));
        }}
        className="mt-1.5 h-9 rounded-xl bg-black/18 px-3 tabular-nums"
      />
    </label>
  );
}

function createCondition(
  kind: ConditionKind,
  content: InteractiveFilmDraftContent,
  depth: number
): StoryCondition | null {
  if (kind === "flag") return { kind: "flag", flag: "flag:condition", equals: true };
  if (kind === "variable") {
    const variable = content.storyBible.stateVariables[0];
    return variable
      ? { kind: "variable", key: variable.key, operator: "equals", value: variable.initialValue }
      : null;
  }
  if (kind === "relationship-at-least") {
    const character = content.storyBible.characters[0];
    return character
      ? { kind: "relationship-at-least", characterId: character.id, value: 0 }
      : null;
  }
  if (depth >= MAX_EDITOR_DEPTH) return null;
  const child = createDefaultLeafCondition(content);
  if (!child) return null;
  if (kind === "not") return { kind: "not", condition: child };
  return { kind, conditions: [child] };
}

function createDefaultLeafCondition(content: InteractiveFilmDraftContent): StoryCondition | null {
  const variable = content.storyBible.stateVariables[0];
  if (variable) {
    return {
      kind: "variable",
      key: variable.key,
      operator: "equals",
      value: variable.initialValue,
    };
  }
  const character = content.storyBible.characters[0];
  if (character) {
    return { kind: "relationship-at-least", characterId: character.id, value: 0 };
  }
  return { kind: "flag", flag: "flag:condition", equals: true };
}

function normalizeOperator(
  operator: VariableCondition["operator"],
  variable: StateVariable
): VariableCondition["operator"] {
  return variable.type === "number" || EQUALITY_OPERATORS.includes(operator) ? operator : "equals";
}

function clamp(value: number, minimum?: number, maximum?: number): number {
  return Math.min(
    maximum ?? Number.POSITIVE_INFINITY,
    Math.max(minimum ?? Number.NEGATIVE_INFINITY, value)
  );
}

function localizedName(name: Record<string, string>, fallback: string): string {
  return (
    Object.values(name)
      .find((candidate) => candidate.trim())
      ?.trim() || fallback
  );
}

function scalarSelectToken(value: string): string {
  return JSON.stringify(value);
}

function scalarFromSelectToken(token: string): string {
  const parsed: unknown = JSON.parse(token);
  return typeof parsed === "string" ? parsed : "";
}
