"use client";

import { useState, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconPlus,
  IconTrash,
  IconVariable,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { InteractiveFilmDraftContent } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import { countStateVariableReferences } from "./story-world-mutations";

type CollectionKind = "locations" | "props" | "storyRules";
type StateVariable = InteractiveFilmDraftContent["storyBible"]["stateVariables"][number];
type StateVariableType = StateVariable["type"];

const COLLECTION_LIMITS: Record<CollectionKind, { items: number; text: number }> = {
  locations: { items: 200, text: 500 },
  props: { items: 200, text: 500 },
  storyRules: { items: 100, text: 2_000 },
};
const STATE_VARIABLE_TYPES: StateVariableType[] = ["boolean", "number", "string"];
const MAX_ALLOWED_VALUES = 100;
const MAX_SCALAR_TEXT = 2_000;
const MAX_ACCESSIBLE_VALUE_PREVIEW = 80;

export interface StoryTextCollectionEditorProps {
  kind: CollectionKind;
  values: string[];
  canEdit: boolean;
  onAdd: () => void;
  onUpdate: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}

export function StoryTextCollectionEditor({
  kind,
  values,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
}: StoryTextCollectionEditorProps) {
  const t = useTranslations("storyStudio.canvas.world.collections");
  const limits = COLLECTION_LIMITS[kind];

  return (
    <section className="rounded-[18px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-white/76">{t(`kinds.${kind}`)}</h3>
          <p className="mt-1 text-[9px] tabular-nums text-white/30">
            {values.length}/{limits.items}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canEdit || values.length >= limits.items}
          onClick={onAdd}
        >
          <IconPlus />
          {t("add")}
        </Button>
      </div>

      {values.length === 0 ? (
        <p className="mt-3 rounded-xl bg-black/16 px-3 py-4 text-center text-[10px] text-white/30">
          {t("empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {values.map((value, index) => {
            const empty = !value.trim();
            const accessibleValue = accessibleValuePreview(value, t("emptyValue"));
            return (
              <div key={index} className="rounded-[14px] bg-black/16 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`${kind}-${index}`}
                    className="text-[9px] font-semibold text-white/32"
                  >
                    {t("itemLabel", { number: index + 1 })}
                  </label>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => onRemove(index)}
                    aria-label={t("remove", {
                      number: index + 1,
                      value: accessibleValue,
                    })}
                    title={t("remove", { number: index + 1, value: accessibleValue })}
                    className="grid size-7 place-items-center rounded-lg bg-white/[0.045] text-white/32 transition hover:bg-white/[0.09] hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </div>
                {kind === "storyRules" ? (
                  <Textarea
                    id={`${kind}-${index}`}
                    value={value}
                    disabled={!canEdit}
                    rows={3}
                    maxLength={limits.text}
                    onChange={(event) => onUpdate(index, event.target.value.slice(0, limits.text))}
                    className="mt-1.5 resize-none bg-white/[0.05] text-xs leading-5"
                  />
                ) : (
                  <Input
                    id={`${kind}-${index}`}
                    value={value}
                    disabled={!canEdit}
                    maxLength={limits.text}
                    onChange={(event) => onUpdate(index, event.target.value.slice(0, limits.text))}
                    className="mt-1.5 h-9 rounded-xl bg-white/[0.05] px-3"
                  />
                )}
                {empty ? (
                  <p className="mt-1.5 text-[9px] leading-4 text-[#e0a45c]/82">
                    {t("requiredBeforeComplete")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export interface StoryStateVariablesLibraryProps {
  content: InteractiveFilmDraftContent;
  canEdit: boolean;
  onCreate: (type: StateVariableType) => string | null;
  onReplace: (key: string, next: StateVariable) => void;
  onDelete: (key: string) => void;
}

export function StoryStateVariablesLibrary({
  content,
  canEdit,
  onCreate,
  onReplace,
  onDelete,
}: StoryStateVariablesLibraryProps) {
  const t = useTranslations("storyStudio.canvas.world.variables");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const variables = content.storyBible.stateVariables;
  const selected =
    variables.find((variable) => variable.key === selectedKey) ?? variables[0] ?? null;
  const selectedReferences = selected ? countStateVariableReferences(content, selected.key) : 0;
  const pendingDelete = variables.find((variable) => variable.key === pendingDeleteKey) ?? null;
  const pendingDeleteReferences = pendingDelete
    ? pendingDelete.key === selected?.key
      ? selectedReferences
      : countStateVariableReferences(content, pendingDelete.key)
    : 0;

  const createVariable = (type: StateVariableType) => {
    const createdKey = onCreate(type);
    if (createdKey) setSelectedKey(createdKey);
  };

  const replaceSelected = (next: StateVariable) => {
    if (selected) onReplace(selected.key, next);
  };

  return (
    <section className="rounded-[18px] bg-white/[0.04] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48">
            <IconVariable className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-white/76">{t("title")}</h3>
            <p className="mt-0.5 text-[9px] tabular-nums text-white/30">{variables.length}/200</p>
          </div>
        </div>
        <Select
          value=""
          disabled={!canEdit || variables.length >= 200}
          onValueChange={(type) => createVariable(type as StateVariableType)}
        >
          <SelectTrigger
            aria-label={t("add")}
            className="h-8! min-w-28 rounded-xl bg-white/[0.055] px-2.5"
          >
            <SelectValue placeholder={t("add")} />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {STATE_VARIABLE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`addTypes.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {variables.length === 0 ? (
        <p className="mt-3 rounded-xl bg-black/16 px-3 py-5 text-center text-[10px] text-white/30">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-1.5">
            {variables.map((variable) => {
              const active = variable.key === selected?.key;
              return (
                <button
                  key={variable.key}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setSelectedKey(variable.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl bg-black/14 px-3 py-2.5 text-left transition hover:bg-white/[0.07]",
                    active && "bg-white/[0.09]"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-white/28",
                      active && "bg-white/[0.09] text-white/72"
                    )}
                  >
                    {active ? (
                      <IconCheck className="size-3.5" />
                    ) : (
                      <IconVariable className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10px] text-white/68">
                      {variable.key}
                    </span>
                    <span className="mt-0.5 block text-[8px] text-white/28">
                      {t(`typeLabels.${variable.type}`)}
                    </span>
                  </span>
                  <IconChevronRight className="size-3.5 shrink-0 text-white/24" />
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="mt-3 rounded-[16px] bg-black/18 p-3">
              <div className="grid grid-cols-2 gap-2">
                <ReadOnlyField label={t("key")} value={selected.key} mono />
                <ReadOnlyField label={t("type")} value={t(`typeLabels.${selected.type}`)} />
              </div>

              <div className="mt-3">
                <VariableDetailEditor
                  variable={selected}
                  canEdit={canEdit}
                  onChange={replaceSelected}
                />
              </div>

              <div className="mt-4 rounded-xl bg-white/[0.035] px-3 py-2.5">
                <p className="text-[9px] leading-4 text-white/38">
                  {t("references", { count: selectedReferences })}
                </p>
                {selectedReferences > 0 ? (
                  <p className="mt-1 text-[9px] leading-4 text-[#e0a45c]/82">
                    {t("deleteBlocked", { count: selectedReferences })}
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                variant="destructive"
                disabled={!canEdit || selectedReferences > 0}
                onClick={() => setPendingDeleteKey(selected.key)}
                className="mt-3 w-full"
              >
                <IconTrash />
                {t("delete")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteKey(null);
        }}
      >
        <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { key: pendingDelete?.key ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingDelete || pendingDeleteReferences > 0}
              onClick={() => {
                if (!pendingDelete) return;
                if (countStateVariableReferences(content, pendingDelete.key) > 0) return;
                const deletedIndex = variables.findIndex(
                  (variable) => variable.key === pendingDelete.key
                );
                const nextSelection =
                  variables[deletedIndex + 1]?.key ?? variables[deletedIndex - 1]?.key ?? null;
                onDelete(pendingDelete.key);
                setSelectedKey(nextSelection);
                setPendingDeleteKey(null);
              }}
            >
              <IconTrash />
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function VariableDetailEditor({
  variable,
  canEdit,
  onChange,
}: {
  variable: StateVariable;
  canEdit: boolean;
  onChange: (next: StateVariable) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.variables");

  if (variable.type === "boolean") {
    return (
      <label>
        <FieldLabel>{t("initialValue")}</FieldLabel>
        <Select
          value={variable.initialValue ? "true" : "false"}
          disabled={!canEdit}
          onValueChange={(value) => onChange({ ...variable, initialValue: value === "true" })}
        >
          <SelectTrigger className="mt-1.5 h-9! w-full rounded-xl bg-white/[0.05] px-3">
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

  if (variable.type === "number") {
    const warnings = [
      variable.minimum !== undefined &&
      variable.maximum !== undefined &&
      variable.minimum > variable.maximum
        ? t("warnings.minimumExceedsMaximum")
        : null,
      variable.minimum !== undefined && variable.initialValue < variable.minimum
        ? t("warnings.initialBelowMinimum")
        : null,
      variable.maximum !== undefined && variable.initialValue > variable.maximum
        ? t("warnings.initialAboveMaximum")
        : null,
    ].filter((warning): warning is string => warning !== null);
    return (
      <div className="grid gap-3">
        <NumberField
          label={t("initialValue")}
          value={variable.initialValue}
          disabled={!canEdit}
          onChange={(initialValue) => onChange({ ...variable, initialValue })}
        />
        <div className="grid grid-cols-2 gap-2">
          <OptionalNumberField
            label={t("minimum")}
            value={variable.minimum}
            disabled={!canEdit}
            onChange={(minimum) => {
              const next = { ...variable, minimum };
              if (minimum === undefined) delete next.minimum;
              onChange(next);
            }}
          />
          <OptionalNumberField
            label={t("maximum")}
            value={variable.maximum}
            disabled={!canEdit}
            onChange={(maximum) => {
              const next = { ...variable, maximum };
              if (maximum === undefined) delete next.maximum;
              onChange(next);
            }}
          />
        </div>
        <VariableWarnings messages={warnings} />
      </div>
    );
  }

  const allowedValues = variable.allowedValues ?? [];
  const warnings =
    allowedValues.length > 0 && !allowedValues.includes(variable.initialValue)
      ? [t("warnings.initialNotAllowed")]
      : [];
  return (
    <div className="grid gap-3">
      <label>
        <FieldLabel>{t("initialValue")}</FieldLabel>
        <Input
          value={variable.initialValue}
          disabled={!canEdit}
          maxLength={MAX_SCALAR_TEXT}
          onChange={(event) =>
            onChange({ ...variable, initialValue: event.target.value.slice(0, MAX_SCALAR_TEXT) })
          }
          className="mt-1.5 h-9 rounded-xl bg-white/[0.05] px-3"
        />
      </label>

      <div>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{t("allowedValues")}</FieldLabel>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit || allowedValues.length >= MAX_ALLOWED_VALUES}
            onClick={() =>
              onChange({
                ...variable,
                allowedValues: [
                  ...allowedValues,
                  allowedValues.length === 0 ? variable.initialValue : "",
                ],
              })
            }
          >
            <IconPlus />
            {t("addAllowedValue")}
          </Button>
        </div>
        {allowedValues.length > 0 ? (
          <div className="mt-2 space-y-2">
            {allowedValues.map((allowedValue, index) => {
              const accessibleValue = accessibleValuePreview(allowedValue, t("emptyValue"));
              return (
                <div key={index} className="flex items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{t("allowedValueLabel", { number: index + 1 })}</span>
                    <Input
                      value={allowedValue}
                      disabled={!canEdit}
                      maxLength={MAX_SCALAR_TEXT}
                      onChange={(event) =>
                        onChange({
                          ...variable,
                          allowedValues: allowedValues.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? event.target.value.slice(0, MAX_SCALAR_TEXT)
                              : candidate
                          ),
                        })
                      }
                      className="h-9 rounded-xl bg-white/[0.05] px-3"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      const nextValues = allowedValues.filter(
                        (_candidate, candidateIndex) => candidateIndex !== index
                      );
                      const next: StateVariable =
                        nextValues.length > 0
                          ? { ...variable, allowedValues: nextValues }
                          : {
                              key: variable.key,
                              type: "string",
                              initialValue: variable.initialValue,
                            };
                      onChange(next);
                    }}
                    aria-label={t("removeAllowedValue", {
                      number: index + 1,
                      value: accessibleValue,
                    })}
                    title={t("removeAllowedValue", {
                      number: index + 1,
                      value: accessibleValue,
                    })}
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.045] text-white/32 transition hover:bg-white/[0.09] hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <VariableWarnings messages={warnings} />
    </div>
  );
}

function VariableWarnings({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-xl bg-[rgba(224,164,92,0.08)] px-3 py-2.5 text-[#e0a45c]/82"
    >
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <ul className="space-y-1 text-[9px] leading-4">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </div>
    </div>
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
        className="mt-1.5 h-9 rounded-xl bg-white/[0.05] px-3 tabular-nums"
      />
    </label>
  );
}

function OptionalNumberField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        step="any"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) {
            onChange(undefined);
            return;
          }
          const nextValue = event.target.valueAsNumber;
          if (Number.isFinite(nextValue)) onChange(nextValue);
        }}
        className="mt-1.5 h-9 rounded-xl bg-white/[0.05] px-3 tabular-nums"
      />
    </label>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2.5">
      <p className="text-[9px] font-semibold text-white/30">{label}</p>
      <p className={cn("mt-1 truncate text-[10px] text-white/64", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[9px] font-semibold text-white/34">{children}</span>;
}

function accessibleValuePreview(value: string, emptyValue: string): string {
  const normalized = value.trim();
  if (!normalized) return emptyValue;
  if (normalized.length <= MAX_ACCESSIBLE_VALUE_PREVIEW) return normalized;
  return `${normalized.slice(0, MAX_ACCESSIBLE_VALUE_PREVIEW - 1)}…`;
}
