"use client";

import { useMemo, useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";

import { useLocale, useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  StoryBibleEnding,
  StoryBibleStateVariable,
  StoryGraphNode,
} from "@/lib/story-projects-api";
import {
  MAX_STORY_CONDITION_LEAVES,
  MAX_STORY_EXIT_ROUTES,
  MAX_STORY_STATE_EFFECTS,
  MAX_STORY_STATE_VARIABLES,
  STORY_ENDING_KINDS,
  type StoryCompareOperator,
  type StoryCondition,
  type StoryEndingKind,
  type StoryExitRoute,
  type StoryRouteTarget,
  type StoryStateEffect,
  type StoryStateValueType,
} from "@repo/shared/story-stats";
import {
  formatStoryConditionChip,
  storyEffectKindOption,
  storyRetargetEffectKind,
} from "./story-stats-display";
import { StoryCanvasTextInput } from "./story-canvas-text-input";
import { cn } from "@/lib/utils";

const COMPARE_OPERATORS: StoryCompareOperator[] = [
  "equals",
  "not-equals",
  "greater-than",
  "at-least",
  "less-than",
  "at-most",
];
const NUMBER_ONLY_OPERATORS = new Set<StoryCompareOperator>([
  "greater-than",
  "at-least",
  "less-than",
  "at-most",
]);

export function StoryStateVariablesPanel({
  variables,
  locale,
  defaultLocale,
  canEdit,
  onChange,
}: {
  variables: StoryBibleStateVariable[];
  locale: string;
  defaultLocale: string;
  canEdit: boolean;
  onChange: (variables: StoryBibleStateVariable[]) => void;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.variables");
  const tStats = useTranslations("storyStudio.canvas.stats");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<StoryStateValueType>("number");
  const atLimit = variables.length >= MAX_STORY_STATE_VARIABLES;

  const addVariable = () => {
    const name = newName.trim();
    if (!canEdit || atLimit || !name) return;
    const draft: StoryBibleStateVariable = {
      key: allocateStateKey(variables.map((variable) => variable.key)),
      name: { [defaultLocale]: name, [locale]: name },
      valueType: newType,
      initialValue: newType === "boolean" ? false : 0,
    };
    onChange([...variables, draft]);
    setOpenKey(draft.key);
    setIsCreating(false);
    setNewName("");
    setNewType("number");
  };

  return (
    <section className="py-5" aria-labelledby="story-stats-variables">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="story-stats-variables" className="text-[13px] font-semibold text-white/88">
            {t("title")}
          </h3>
          <p className="mt-1 text-xs leading-4 text-white/48">{tStats("variablesHint")}</p>
        </div>
        <span className="shrink-0 text-xs text-white/38 tabular-nums">
          {variables.length}/{MAX_STORY_STATE_VARIABLES}
        </span>
      </div>

      {variables.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-white/[0.1] px-4 py-6 text-center text-[12px] text-white/42">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {variables.map((variable) => (
            <li key={variable.key}>
              <VariableCard
                variable={variable}
                locale={locale}
                canEdit={canEdit}
                open={openKey === variable.key}
                onToggle={() =>
                  setOpenKey((current) => (current === variable.key ? null : variable.key))
                }
                onChange={(next) =>
                  onChange(
                    variables.map((candidate) => (candidate.key === next.key ? next : candidate))
                  )
                }
                onRemove={() => {
                  if (openKey === variable.key) setOpenKey(null);
                  onChange(variables.filter((candidate) => candidate.key !== variable.key));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {isCreating ? (
        <form
          className="mt-3 rounded-2xl bg-white/[0.045] p-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            addVariable();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs font-semibold text-white/48">
              {t("name")}
              <Input
                autoFocus
                value={newName}
                disabled={!canEdit}
                maxLength={80}
                onChange={(event) => setNewName(event.target.value)}
                className="mt-1 h-8! rounded-lg bg-white/[0.05] px-2.5 text-xs"
              />
            </label>
            <label className="min-w-0 text-xs font-semibold text-white/48">
              {t("type")}
              <StatsSelect
                value={newType}
                disabled={!canEdit}
                onChange={(value) => setNewType(value as StoryStateValueType)}
                options={[
                  { value: "number", label: t("typeLabels.number") },
                  { value: "boolean", label: t("typeLabels.boolean") },
                ]}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                setNewName("");
                setNewType("number");
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/55 transition hover:bg-white/[0.06] hover:text-white"
            >
              {tStats("cancel")}
            </button>
            <Button type="submit" size="sm" disabled={!canEdit || atLimit || !newName.trim()}>
              {tStats("addVariable")}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          block
          disabled={!canEdit || atLimit}
          onClick={() => setIsCreating(true)}
          className="mt-3"
        >
          <IconPlus className="size-3.5" />
          {tStats("addVariable")}
        </Button>
      )}
    </section>
  );
}

function VariableCard({
  variable,
  locale,
  canEdit,
  open,
  onToggle,
  onChange,
  onRemove,
}: {
  variable: StoryBibleStateVariable;
  locale: string;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (variable: StoryBibleStateVariable) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.variables");
  const tStats = useTranslations("storyStudio.canvas.stats");
  const name = variable.name[locale] ?? "";
  const title = localizedText(variable.name, locale) || variable.key;
  const initialLabel =
    variable.valueType === "boolean"
      ? variable.initialValue
        ? t("boolean.true")
        : t("boolean.false")
      : String(variable.initialValue);
  return (
    <article className="overflow-hidden rounded-2xl bg-white/[0.045]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left transition hover:bg-white/[0.04]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white/88">{title}</span>
          <span className="mt-0.5 block truncate font-mono text-xs text-white/38">
            {variable.key}
          </span>
        </span>
        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-xs font-semibold tracking-[0.06em] text-white/48 uppercase">
          {t(`typeLabels.${variable.valueType}`)}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-white/55">{initialLabel}</span>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-white/32 transition",
            open && "rotate-180 text-white/55"
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-white/[0.06] px-3.5 pt-3 pb-3.5">
          <p className="mb-3 text-xs text-white/38">{tStats("cardHint")}</p>
          <label className="block">
            <span className="block text-xs font-semibold text-white/48">{t("name")}</span>
            <StoryCanvasTextInput
              value={name}
              disabled={!canEdit}
              maxLength={80}
              onValueChange={(next) =>
                onChange({ ...variable, name: { ...variable.name, [locale]: next } })
              }
              className="mt-1 block h-8! w-full rounded-lg bg-white/[0.05] px-2.5 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-white/25"
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-white/48">{t("type")}</span>
              <StatsSelect
                value={variable.valueType}
                disabled={!canEdit}
                onChange={(valueType) =>
                  onChange(retypeVariable(variable, valueType as StoryStateValueType))
                }
                options={[
                  { value: "number", label: t("typeLabels.number") },
                  { value: "boolean", label: t("typeLabels.boolean") },
                ]}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-white/48">{t("initialValue")}</span>
              {variable.valueType === "boolean" ? (
                <StatsSelect
                  value={variable.initialValue === true ? "true" : "false"}
                  disabled={!canEdit}
                  onChange={(value) => onChange({ ...variable, initialValue: value === "true" })}
                  options={[
                    { value: "true", label: t("boolean.true") },
                    { value: "false", label: t("boolean.false") },
                  ]}
                />
              ) : (
                <Input
                  type="number"
                  value={typeof variable.initialValue === "number" ? variable.initialValue : 0}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) onChange({ ...variable, initialValue: value });
                  }}
                  className="mt-1 h-8! rounded-lg bg-white/[0.05] px-2.5 text-xs"
                />
              )}
            </label>
          </div>
          <label className="mt-2 block">
            <span className="block text-xs font-semibold text-white/48">{t("description")}</span>
            <StoryCanvasTextInput
              multiline
              value={variable.note ?? ""}
              disabled={!canEdit}
              maxLength={2_000}
              rows={2}
              placeholder={t("descriptionPlaceholder")}
              onValueChange={(next) =>
                onChange({
                  ...variable,
                  note: next.trim() ? next : undefined,
                })
              }
              className="mt-1 block min-h-16 w-full resize-y rounded-lg bg-white/[0.05] px-2.5 py-2 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-white/25"
            />
          </label>
          <div className="mt-4 flex justify-end border-t border-white/[0.06] pt-3">
            <button
              type="button"
              disabled={!canEdit}
              onClick={onRemove}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
            >
              <IconTrash className="size-3.5" />
              {t("delete")}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function StoryEffectsEditor({
  effects,
  variables,
  canEdit,
  onChange,
  variant = "fields",
}: {
  effects: StoryStateEffect[];
  variables: StoryBibleStateVariable[];
  canEdit: boolean;
  onChange: (effects: StoryStateEffect[]) => void;
  variant?: "fields" | "table";
}) {
  const t = useTranslations("storyStudio.canvas.stats");
  const locale = useLocale();
  const table = variant === "table";
  if (variables.length === 0) {
    return (
      <p
        className={cn(
          "text-xs leading-4 text-white/42",
          table && "border-t border-white/[0.055] px-3 py-2"
        )}
      >
        {t("noVariables")}
      </p>
    );
  }
  return (
    <div className={table ? "flex flex-col" : undefined}>
      <div className={table ? "flex flex-col" : "space-y-1.5"}>
        {effects.map((effect, index) => {
          const variable = variables.find((candidate) => candidate.key === effect.key);
          const invalidBooleanAdd = variable?.valueType === "boolean" && effect.kind === "add";
          return (
            <div
              key={`${effect.key}:${index}`}
              className={
                table
                  ? "grid min-h-11 grid-cols-[minmax(0,1fr)_4.5rem_4.25rem_2rem] items-center gap-1.5 border-t border-white/[0.055] px-3"
                  : "grid grid-cols-[1fr_72px_1fr_28px] items-end gap-1.5"
              }
            >
              <StatsSelect
                value={effect.key}
                disabled={!canEdit}
                flush={table}
                onChange={(key) => {
                  const next = variables.find((candidate) => candidate.key === key);
                  onChange(
                    effects.map((candidate, at) =>
                      at === index ? defaultEffect(next ?? variable, effect) : candidate
                    )
                  );
                }}
                options={variables.map((candidate) => ({
                  value: candidate.key,
                  label: localizedText(candidate.name, locale) || candidate.key,
                }))}
              />
              <StatsSelect
                value={storyEffectKindOption(effect)}
                disabled={!canEdit || (variable?.valueType === "boolean" && effect.kind === "set")}
                invalid={invalidBooleanAdd}
                flush={table}
                onChange={(kind) =>
                  onChange(
                    effects.map((candidate, at) =>
                      at === index
                        ? retargetEffectKind(
                            candidate,
                            kind === "set" ? "set" : kind === "subtract" ? "subtract" : "add",
                            variable
                          )
                        : candidate
                    )
                  )
                }
                options={
                  variable?.valueType === "boolean"
                    ? [
                        ...(invalidBooleanAdd
                          ? [
                              {
                                value: storyEffectKindOption(effect),
                                label: t(effect.amount < 0 ? "effectSubtract" : "effectAdd"),
                                disabled: true,
                              },
                            ]
                          : []),
                        { value: "set", label: t("effectSet") },
                      ]
                    : [
                        { value: "add", label: t("effectAdd") },
                        { value: "subtract", label: t("effectSubtract") },
                        { value: "set", label: t("effectSet") },
                      ]
                }
              />
              <EffectValueField
                effect={effect}
                variable={variable}
                canEdit={canEdit}
                flush={table}
                onChange={(next) =>
                  onChange(effects.map((candidate, at) => (at === index ? next : candidate)))
                }
              />
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onChange(effects.filter((_, at) => at !== index))}
                className="grid size-8 place-items-center rounded-md text-white/34 transition hover:bg-white/[0.08] hover:text-[#ff9b9e] disabled:opacity-40"
                aria-label={t("removeEffect")}
              >
                <IconTrash className="size-3.5" />
              </button>
              {invalidBooleanAdd ? (
                <p className="col-span-4 pb-2 text-xs text-destructive">
                  {t("booleanEffectInvalid")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {effects.length < MAX_STORY_STATE_EFFECTS ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onChange([...effects, defaultEffect(variables[0])])}
          className="nodrag nopan mx-3 my-2 flex h-8 items-center justify-center gap-1 rounded-lg text-xs font-semibold text-brand-blue transition hover:bg-brand-blue/10 hover:text-[#a9ceff] disabled:opacity-40"
        >
          <IconPlus className="size-3.5" />
          {t("addEffect")}
        </button>
      ) : null}
    </div>
  );
}

export function StoryConditionEditor({
  condition,
  variables,
  canEdit,
  onChange,
  variant = "fields",
}: {
  condition: StoryCondition | undefined;
  variables: StoryBibleStateVariable[];
  canEdit: boolean;
  onChange: (condition: StoryCondition | undefined) => void;
  variant?: "fields" | "table";
}) {
  const t = useTranslations("storyStudio.canvas.stats");
  const locale = useLocale();
  const table = variant === "table";
  const draft = useMemo(() => flattenCondition(condition), [condition]);
  if (variables.length === 0) {
    return <p className="text-xs leading-4 text-white/42">{t("noVariables")}</p>;
  }
  if (!condition) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onChange(defaultCompare(variables[0]!))}
        className={cn(
          "nodrag nopan my-2 flex h-8 items-center justify-center gap-1 rounded-lg text-xs font-semibold text-brand-blue transition hover:bg-brand-blue/10 hover:text-[#a9ceff] disabled:opacity-40",
          table ? "mx-3" : "w-full"
        )}
      >
        <IconPlus className="size-3.5" />
        {t("addCondition")}
      </button>
    );
  }
  if (!draft) {
    const names = new Map(
      variables.map((variable) => [
        variable.key,
        localizedText(variable.name, locale) || variable.key,
      ])
    );
    return (
      <div className={cn("space-y-2 py-2", table && "px-3")}>
        <p className="text-xs leading-5 text-white/68 break-words">
          {formatStoryConditionChip(condition, names)}
        </p>
        <p className="text-[11px] leading-4 text-white/42">{t("complexConditionHint")}</p>
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onChange(undefined)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/50 transition hover:bg-white/[0.08] hover:text-[#ff9b9e] disabled:opacity-40"
        >
          <IconTrash className="size-3.5" />
          {t("removeCondition")}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className={cn("mb-1.5 flex gap-1", table && "px-3")}>
        {draft.compares.length > 1 ? (
          <>
            <ToggleChip
              active={draft.combinator === "all"}
              disabled={!canEdit}
              onClick={() => onChange(rebuildCondition({ ...draft, combinator: "all" }))}
            >
              {t("combinatorAll")}
            </ToggleChip>
            <ToggleChip
              active={draft.combinator === "any"}
              disabled={!canEdit}
              onClick={() => onChange(rebuildCondition({ ...draft, combinator: "any" }))}
            >
              {t("combinatorAny")}
            </ToggleChip>
            <ToggleChip
              active={draft.negated}
              disabled={!canEdit}
              onClick={() => onChange(rebuildCondition({ ...draft, negated: !draft.negated }))}
            >
              {t("combinatorNot")}
            </ToggleChip>
          </>
        ) : (
          <ToggleChip
            active={draft.negated}
            disabled={!canEdit}
            onClick={() => onChange(rebuildCondition({ ...draft, negated: !draft.negated }))}
          >
            {t("combinatorNot")}
          </ToggleChip>
        )}
      </div>
      <div className={table ? undefined : "space-y-1.5"}>
        {draft.compares.map((compare, index) => {
          const variable = variables.find((candidate) => candidate.key === compare.variableKey);
          const operators = COMPARE_OPERATORS.filter(
            (operator) => variable?.valueType !== "boolean" || !NUMBER_ONLY_OPERATORS.has(operator)
          );
          return (
            <div
              key={`${compare.variableKey}:${index}`}
              className={cn(
                "grid grid-cols-[1fr_88px_1fr_28px] gap-1.5",
                table ? "min-h-11 items-center border-t border-white/[0.055] px-3" : "items-end"
              )}
            >
              <StatsSelect
                value={compare.variableKey}
                disabled={!canEdit}
                onChange={(key) => {
                  const nextVariable = variables.find((candidate) => candidate.key === key);
                  const next = draft.compares.map((candidate, at) =>
                    at === index ? retargetCompare(candidate, nextVariable) : candidate
                  );
                  onChange(rebuildCondition({ ...draft, compares: next }));
                }}
                options={variables.map((candidate) => ({
                  value: candidate.key,
                  label: localizedText(candidate.name, locale) || candidate.key,
                }))}
              />
              <StatsSelect
                value={compare.operator}
                disabled={!canEdit}
                onChange={(operator) => {
                  const next = draft.compares.map((candidate, at) =>
                    at === index
                      ? { ...candidate, operator: operator as StoryCompareOperator }
                      : candidate
                  );
                  onChange(rebuildCondition({ ...draft, compares: next }));
                }}
                options={operators.map((operator) => ({
                  value: operator,
                  label: t(`operators.${operator}`),
                }))}
              />
              <CompareValueField
                compare={compare}
                variable={variable}
                canEdit={canEdit}
                onChange={(nextCompare) => {
                  const next = draft.compares.map((candidate, at) =>
                    at === index ? nextCompare : candidate
                  );
                  onChange(rebuildCondition({ ...draft, compares: next }));
                }}
              />
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  const next = draft.compares.filter((_, at) => at !== index);
                  // Removing the last row removes the whole condition.
                  onChange(
                    next.length ? rebuildCondition({ ...draft, compares: next }) : undefined
                  );
                }}
                className="grid size-7 place-items-center rounded-md text-white/34 transition hover:bg-white/[0.08] hover:text-[#ff9b9e] disabled:opacity-40"
                aria-label={t("removeCondition")}
              >
                <IconTrash className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      {draft.compares.length < MAX_STORY_CONDITION_LEAVES ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            onChange(
              rebuildCondition({
                ...draft,
                compares: [...draft.compares, defaultCompare(variables[0]!)],
              })
            )
          }
          className={cn(
            "nodrag nopan my-2 flex h-8 items-center justify-center gap-1 rounded-lg text-xs font-semibold text-brand-blue transition hover:bg-brand-blue/10 hover:text-[#a9ceff] disabled:opacity-40",
            table ? "mx-3" : "w-full"
          )}
        >
          <IconPlus className="size-3.5" />
          {t("addCondition")}
        </button>
      ) : null}
    </div>
  );
}

export function StoryChoiceAttachmentBar({
  effects,
  visibleWhen,
  variables,
  locale,
  canEdit,
  onEffectsChange,
  onVisibleWhenChange,
  target,
  nodes,
  endings,
  onTargetChange,
  onCreateEnding,
  onUpdateEnding,
  onDeleteEnding,
}: {
  effects: StoryStateEffect[];
  visibleWhen?: StoryCondition;
  variables: StoryBibleStateVariable[];
  locale: string;
  canEdit: boolean;
  onEffectsChange: (effects: StoryStateEffect[]) => void;
  onVisibleWhenChange?: (condition: StoryCondition | undefined) => void;
  target?: StoryRouteTarget | null;
  nodes?: Array<{ nodeId: string; title: string }>;
  endings?: StoryBibleEnding[];
  onTargetChange?: (target: StoryRouteTarget | null) => void;
  onCreateEnding?: () => void;
  onUpdateEnding?: EndingUpdate;
  onDeleteEnding?: (endingId: string) => void;
}) {
  const tStats = useTranslations("storyStudio.canvas.stats");
  return (
    <div className="nodrag nopan nowheel" onPointerDown={(event) => event.stopPropagation()}>
      <div className="mx-2 mb-2 overflow-hidden rounded-xl bg-white/[0.05]">
        {onTargetChange && onCreateEnding && onUpdateEnding && onDeleteEnding ? (
          <div className="border-b border-white/[0.055] px-3 py-2">
            <h4 className="text-xs font-semibold text-white/78">{tStats("choiceTarget")}</h4>
            <StoryRouteTargetPicker
              target={target ?? null}
              nodes={nodes ?? []}
              endings={endings ?? []}
              locale={locale}
              canEdit={canEdit}
              onChange={onTargetChange}
              onCreateEnding={onCreateEnding}
              onUpdateEnding={onUpdateEnding}
              onDeleteEnding={onDeleteEnding}
              emptyLabel={tStats("unconnectedTarget")}
            />
          </div>
        ) : null}
        <div className="px-3 pt-2">
          <h4 className="text-xs font-semibold text-white/78">{tStats("effectsTitle")}</h4>
          <p className="mt-0.5 text-[11px] leading-4 text-white/45">{tStats("effectsHint")}</p>
        </div>
        <StoryEffectsEditor
          variant="table"
          effects={effects}
          variables={variables}
          canEdit={canEdit}
          onChange={onEffectsChange}
        />
        {onVisibleWhenChange && variables.length > 0 ? (
          <div className="border-t border-white/[0.055] pt-2">
            <div className="px-3">
              <h4 className="text-xs font-semibold text-white/78">{tStats("visibleWhenTitle")}</h4>
              <p className="mt-0.5 text-[11px] leading-4 text-white/45">
                {tStats("visibleWhenHint")}
              </p>
            </div>
            <div className="mt-1.5">
              <StoryConditionEditor
                condition={visibleWhen}
                variables={variables}
                canEdit={canEdit}
                onChange={onVisibleWhenChange}
                variant="table"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StoryAutoRoutesEditor({
  routes,
  variables,
  endings,
  nodes,
  locale,
  canEdit,
  onChange,
  onCreateEnding,
  onUpdateEnding,
  onDeleteEnding,
}: {
  routes: StoryExitRoute[];
  variables: StoryBibleStateVariable[];
  endings: StoryBibleEnding[];
  nodes: Array<{ nodeId: string; title: string }>;
  locale: string;
  canEdit: boolean;
  onChange: (routes: StoryExitRoute[]) => void;
  onCreateEnding: (routeIndex: number) => void;
  onUpdateEnding: EndingUpdate;
  onDeleteEnding: (endingId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.stats");
  const conditionals = routes.slice(0, -1);
  const fallback = routes[routes.length - 1] ?? { target: null };
  return (
    <div>
      <p className="text-xs leading-4 text-white/42">{t("routesHint")}</p>
      <div className="mt-2 space-y-2">
        {conditionals.map((route, index) => (
          <div key={`route-${index}`} className="rounded-xl bg-white/[0.04] p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
                {t("routeIndex", { number: index + 1 })}
              </span>
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={!canEdit || index === 0}
                  onClick={() => onChange(moveRoute(routes, index, index - 1))}
                  className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20"
                  aria-label={t("moveRouteUp")}
                >
                  <IconArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={!canEdit || index === conditionals.length - 1}
                  onClick={() => onChange(moveRoute(routes, index, index + 1))}
                  className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-20"
                  aria-label={t("moveRouteDown")}
                >
                  <IconArrowDown className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    onChange([...conditionals.filter((_, at) => at !== index), fallback])
                  }
                  className="grid size-6 place-items-center rounded-md text-white/32 transition hover:bg-white/[0.08] hover:text-[#ff9b9e] disabled:opacity-40"
                  aria-label={t("removeRoute")}
                >
                  <IconTrash className="size-3" />
                </button>
              </span>
            </div>
            <StoryConditionEditor
              condition={route.when}
              variables={variables}
              canEdit={canEdit}
              onChange={(when) => {
                if (!when) {
                  onChange([...conditionals.filter((_, at) => at !== index), fallback]);
                  return;
                }
                onChange(
                  routes.map((candidate, at) => (at === index ? { ...candidate, when } : candidate))
                );
              }}
            />
            <div className="mt-2">
              <span className="text-xs font-semibold text-white/48">{t("target")}</span>
              <StoryRouteTargetPicker
                target={route.target}
                nodes={nodes}
                endings={endings}
                locale={locale}
                canEdit={canEdit}
                onChange={(target) =>
                  onChange(
                    routes.map((candidate, at) =>
                      at === index ? { ...candidate, target } : candidate
                    )
                  )
                }
                onCreateEnding={() => onCreateEnding(index)}
                onUpdateEnding={onUpdateEnding}
                onDeleteEnding={onDeleteEnding}
              />
            </div>
          </div>
        ))}
        <div className="rounded-xl bg-white/[0.04] p-2.5">
          <p className="text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
            {t("fallbackRoute")}
          </p>
          <div className="mt-2">
            <span className="text-xs font-semibold text-white/48">{t("target")}</span>
            <StoryRouteTargetPicker
              target={fallback.target}
              nodes={nodes}
              endings={endings}
              locale={locale}
              canEdit={canEdit}
              onChange={(target) => onChange([...conditionals, { target }])}
              onCreateEnding={() => onCreateEnding(conditionals.length)}
              onUpdateEnding={onUpdateEnding}
              onDeleteEnding={onDeleteEnding}
            />
          </div>
        </div>
      </div>
      {routes.length < MAX_STORY_EXIT_ROUTES && variables.length > 0 ? (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() =>
            onChange([
              ...conditionals,
              { when: defaultCompare(variables[0]!), target: null },
              fallback,
            ])
          }
          className="nodrag nopan mt-2 flex h-8 w-full items-center justify-center gap-1 rounded-lg text-xs font-semibold text-brand-blue transition hover:bg-brand-blue/10 hover:text-[#a9ceff] disabled:opacity-40"
        >
          <IconPlus className="size-3.5" />
          {t("addRoute")}
        </button>
      ) : null}
    </div>
  );
}

export function StoryRouteTargetPicker({
  target,
  nodes,
  endings,
  locale,
  canEdit,
  onChange,
  allowUnconnected = true,
  onCreateEnding,
  onUpdateEnding,
  onDeleteEnding,
  emptyLabel,
}: {
  target: StoryRouteTarget | null;
  nodes: Array<{ nodeId: string; title: string }>;
  endings: StoryBibleEnding[];
  locale: string;
  canEdit: boolean;
  onChange: (target: StoryRouteTarget | null) => void;
  allowUnconnected?: boolean;
  onCreateEnding: () => void;
  onUpdateEnding: EndingUpdate;
  onDeleteEnding: (endingId: string) => void;
  emptyLabel?: string;
}) {
  const t = useTranslations("storyStudio.canvas.stats");
  const selectedEnding = endings.find(
    (ending) => target?.kind === "ending" && ending.endingId === target.endingId
  );
  return (
    <div>
      <StatsSelect
        value={encodeTarget(target)}
        disabled={!canEdit}
        onChange={(value) =>
          value === "create-ending" ? onCreateEnding() : onChange(decodeTarget(value))
        }
        options={[
          ...(allowUnconnected ? [{ value: "null", label: emptyLabel ?? t("naturalEnd") }] : []),
          ...nodes.map((node) => ({
            value: `node:${node.nodeId}`,
            label: t("targetNode", { title: node.title }),
          })),
          ...endings.map((ending) => ({
            value: `ending:${ending.endingId}`,
            label: t("targetEnding", {
              title: localizedText(ending.title, locale) || ending.endingId,
            }),
          })),
          { value: "create-ending", label: t("createEndingHere") },
        ]}
      />
      {selectedEnding ? (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
          <label className="min-w-0 text-xs text-white/48">
            <span className="block">{t("endingTitle")}</span>
            <StoryCanvasTextInput
              value={selectedEnding.title[locale] ?? ""}
              disabled={!canEdit}
              maxLength={80}
              onValueChange={(next) =>
                onUpdateEnding(selectedEnding.endingId, {
                  title: { ...selectedEnding.title, [locale]: next },
                })
              }
              className="mt-1 block h-8! w-full rounded-lg bg-white/[0.05] px-2.5 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-white/25"
            />
          </label>
          <label className="min-w-0 text-xs text-white/48">
            {t("endingKind")}
            <StatsSelect
              value={selectedEnding.kind}
              disabled={!canEdit}
              onChange={(kind) =>
                onUpdateEnding(selectedEnding.endingId, { kind: kind as StoryEndingKind })
              }
              options={STORY_ENDING_KINDS.map((kind) => ({
                value: kind,
                label: t(`endingKinds.${kind}`),
              }))}
            />
          </label>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                disabled={!canEdit}
                className="grid size-8 place-items-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-[#ff9b9e] disabled:opacity-40"
                aria-label={t("deleteEnding")}
              >
                <IconTrash className="size-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteEnding")}</AlertDialogTitle>
                <AlertDialogDescription>{t("deleteEndingHint")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => onDeleteEnding(selectedEnding.endingId)}
                >
                  {t("deleteEnding")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}

type EndingUpdate = (
  endingId: string,
  patch: Partial<Pick<StoryBibleEnding, "title" | "kind">>
) => void;

export function storyGraphNodePickerItems(
  nodes: readonly StoryGraphNode[],
  currentNodeId: string,
  titles: ReadonlyMap<string, string>
): Array<{ nodeId: string; title: string }> {
  return nodes
    .filter((node) => node.nodeId !== currentNodeId)
    .map((node) => ({
      nodeId: node.nodeId,
      title:
        titles.get(node.nodeId) ||
        (node.kind === "decision" ? node.nodeId : node.name) ||
        node.nodeId,
    }));
}

export function storyGraphNodePickerTitles(
  nodes: readonly StoryGraphNode[],
  clipLabel: string,
  decisionLabel: string
): Map<string, string> {
  let clipOrdinal = 0;
  let decisionOrdinal = 0;
  return new Map(
    nodes.map((node) => {
      const fallback =
        node.kind === "clip"
          ? `${clipLabel} ${++clipOrdinal}`
          : node.kind === "decision"
            ? `${decisionLabel} ${++decisionOrdinal}`
            : node.nodeId;
      return [node.nodeId, (node.kind === "decision" ? "" : node.name?.trim()) || fallback];
    })
  );
}

function EffectValueField({
  effect,
  variable,
  canEdit,
  flush,
  onChange,
}: {
  effect: StoryStateEffect;
  variable: StoryBibleStateVariable | undefined;
  canEdit: boolean;
  flush?: boolean;
  onChange: (effect: StoryStateEffect) => void;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.variables");
  if (effect.kind === "add") {
    // Subtract is a UI presentation of a negative add amount; the stored
    // effect stays a plain negative increment.
    const subtract = effect.amount < 0;
    return (
      <Input
        type="number"
        value={subtract ? Math.abs(effect.amount) : effect.amount}
        disabled={!canEdit}
        onChange={(event) => {
          const next = Number(event.target.value) || 0;
          onChange({ ...effect, amount: subtract ? -Math.abs(next) || 0 : next });
        }}
        className={cn(
          "nodrag nopan nowheel h-8! rounded-lg bg-white/[0.05] px-2.5 text-xs",
          flush && "mt-0"
        )}
      />
    );
  }
  if (variable?.valueType === "boolean") {
    return (
      <StatsSelect
        value={effect.value === true ? "true" : "false"}
        disabled={!canEdit}
        flush={flush}
        onChange={(value) => onChange({ kind: "set", key: effect.key, value: value === "true" })}
        options={[
          { value: "true", label: t("boolean.true") },
          { value: "false", label: t("boolean.false") },
        ]}
      />
    );
  }
  return (
    <Input
      type="number"
      value={typeof effect.value === "number" ? effect.value : 0}
      disabled={!canEdit}
      onChange={(event) =>
        onChange({ kind: "set", key: effect.key, value: Number(event.target.value) || 0 })
      }
      className={cn(
        "nodrag nopan nowheel h-8! rounded-lg bg-white/[0.05] px-2.5 text-xs",
        flush && "mt-0"
      )}
    />
  );
}

function CompareValueField({
  compare,
  variable,
  canEdit,
  onChange,
}: {
  compare: Extract<StoryCondition, { kind: "compare" }>;
  variable: StoryBibleStateVariable | undefined;
  canEdit: boolean;
  onChange: (compare: Extract<StoryCondition, { kind: "compare" }>) => void;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.variables");
  if (variable?.valueType === "boolean") {
    return (
      <StatsSelect
        value={compare.value === true ? "true" : "false"}
        disabled={!canEdit}
        onChange={(value) => onChange({ ...compare, value: value === "true" })}
        options={[
          { value: "true", label: t("boolean.true") },
          { value: "false", label: t("boolean.false") },
        ]}
      />
    );
  }
  return (
    <Input
      type="number"
      value={typeof compare.value === "number" ? compare.value : 0}
      disabled={!canEdit}
      onChange={(event) => onChange({ ...compare, value: Number(event.target.value) || 0 })}
      className="h-8! rounded-lg bg-white/[0.05] px-2.5 text-xs"
    />
  );
}

function StatsSelect({
  value,
  disabled,
  invalid,
  onChange,
  options,
  flush,
}: {
  value: string;
  disabled: boolean;
  invalid?: boolean;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  flush?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-invalid={invalid || undefined}
        className={cn("nodrag nopan nowheel w-full", !flush && "mt-1 h-8 px-2.5 text-xs")}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ToggleChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-[0.08em] transition disabled:opacity-40",
        active
          ? "bg-white/[0.12] text-white/82"
          : "bg-white/[0.04] text-white/42 hover:text-white/68"
      )}
    >
      {children}
    </button>
  );
}

function allocateStateKey(existing: string[]): string {
  const values = new Set(existing);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `state_${suffix}`;
    if (!values.has(candidate)) return candidate;
  }
}

function retypeVariable(
  variable: StoryBibleStateVariable,
  valueType: StoryStateValueType
): StoryBibleStateVariable {
  if (variable.valueType === valueType) return variable;
  if (valueType === "boolean") {
    return {
      key: variable.key,
      name: variable.name,
      valueType,
      initialValue: false,
      ...(variable.note ? { note: variable.note } : {}),
    };
  }
  return {
    key: variable.key,
    name: variable.name,
    valueType,
    initialValue: 0,
    ...(variable.note ? { note: variable.note } : {}),
  };
}

function defaultEffect(
  variable: StoryBibleStateVariable | undefined,
  previous?: StoryStateEffect
): StoryStateEffect {
  const key = variable?.key ?? previous?.key ?? "stat";
  if (variable?.valueType === "boolean") return { kind: "set", key, value: true };
  if (previous?.kind === "set" && typeof previous.value === "number") {
    return { kind: "set", key, value: previous.value };
  }
  return { kind: "add", key, amount: previous?.kind === "add" ? previous.amount : 1 };
}

function retargetEffectKind(
  effect: StoryStateEffect,
  kind: "add" | "subtract" | "set",
  variable: StoryBibleStateVariable | undefined
): StoryStateEffect {
  return storyRetargetEffectKind(effect, kind, variable);
}

function defaultCompare(
  variable: StoryBibleStateVariable
): Extract<StoryCondition, { kind: "compare" }> {
  if (variable.valueType === "boolean") {
    return { kind: "compare", variableKey: variable.key, operator: "equals", value: true };
  }
  return { kind: "compare", variableKey: variable.key, operator: "at-least", value: 0 };
}

function retargetCompare(
  compare: Extract<StoryCondition, { kind: "compare" }>,
  variable: StoryBibleStateVariable | undefined
): Extract<StoryCondition, { kind: "compare" }> {
  if (!variable) return compare;
  if (variable.valueType === "boolean") {
    return { kind: "compare", variableKey: variable.key, operator: "equals", value: true };
  }
  return {
    kind: "compare",
    variableKey: variable.key,
    operator: NUMBER_ONLY_OPERATORS.has(compare.operator) ? compare.operator : "at-least",
    value: typeof compare.value === "number" ? compare.value : 0,
  };
}

type FlatCondition = {
  combinator: "all" | "any";
  negated: boolean;
  compares: Array<Extract<StoryCondition, { kind: "compare" }>>;
};

function flattenCondition(condition: StoryCondition | undefined): FlatCondition | null {
  if (!condition) return { combinator: "all", negated: false, compares: [] };
  let current = condition;
  let negated = false;
  if (current.kind === "not") {
    negated = true;
    current = current.condition;
  }
  if (current.kind === "compare") {
    return { combinator: "all", negated, compares: [current] };
  }
  if (current.kind === "all" || current.kind === "any") {
    if (!current.conditions.every((child) => child.kind === "compare")) return null;
    const compares = current.conditions as FlatCondition["compares"];
    return {
      combinator: current.kind,
      negated,
      compares,
    };
  }
  return null;
}

function rebuildCondition(draft: FlatCondition): StoryCondition | undefined {
  if (draft.compares.length === 0) return undefined;
  const core: StoryCondition =
    draft.compares.length === 1
      ? draft.compares[0]!
      : { kind: draft.combinator, conditions: draft.compares };
  return draft.negated ? { kind: "not", condition: core } : core;
}

function moveRoute(routes: StoryExitRoute[], from: number, to: number): StoryExitRoute[] {
  if (to < 0 || to >= routes.length - 1) return routes;
  const next = [...routes];
  const [moved] = next.splice(from, 1);
  if (!moved) return routes;
  next.splice(to, 0, moved);
  return next;
}

function encodeTarget(target: StoryRouteTarget | null): string {
  if (!target) return "null";
  return target.kind === "node" ? `node:${target.nodeId}` : `ending:${target.endingId}`;
}

function decodeTarget(value: string): StoryRouteTarget | null {
  if (value === "null" || value === "") return null;
  if (value.startsWith("node:")) return { kind: "node", nodeId: value.slice(5) };
  if (value.startsWith("ending:")) return { kind: "ending", endingId: value.slice(7) };
  return null;
}

function localizedText(text: Record<string, string> | undefined, locale: string): string {
  if (!text) return "";
  const exact = text[locale];
  if (exact?.trim()) return exact;
  const language = locale.split("-")[0]?.toLowerCase();
  const match = Object.entries(text).find(
    ([key, value]) => key.split("-")[0]?.toLowerCase() === language && value.trim()
  );
  return match?.[1] ?? Object.values(text).find((value) => value.trim()) ?? "";
}
