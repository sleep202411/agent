"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAppSelector } from "@/src/store";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";

/**
 * Frontend-owned i18n mapping for the 5 canonical param keys the supervisor
 * emits via `configure_params`. When a field's `key` matches here, we render
 * `t(labelKey)` instead of the LLM-supplied `label` — the LLM-side prompt can
 * then stay in English for consistency but users see their own locale. Keys
 * not in this map fall through to the raw `field.label` (future-proof for
 * new ad-hoc fields the supervisor invents).
 */
const FIELD_LABEL_I18N: Record<string, string> = {
  targetEpisodeCount: "paramTargetEpisodeCount",
  chapterLength: "paramChapterLength",
  shotsPerEpisode: "paramShotsPerEpisode",
  stylePainting: "paramStylePainting",
  dialogLanguage: "paramDialogLanguage",
};

/** Same idea for option labels: only need it for LLM-placeholder options
 *  (dialogLanguage); `stylePainting` options are overridden at runtime by
 *  Java dictionary, and ad-hoc fields stay on the LLM label.  */
const OPTION_LABEL_I18N: Record<string, Record<string, string>> = {
  dialogLanguage: {
    "zh-CN": "paramsDialogLanguageSimplifiedChinese",
    "zh-HK": "paramsDialogLanguageTraditionalChinese",
    "en-US": "paramsDialogLanguageEnglish",
  },
};

/** Suffix i18n: LLM-side prompt uses "集" / "分钟" / "镜" literally; we detect
 *  those and swap for locale strings. Anything else passes through.  */
const SUFFIX_I18N: Record<string, string> = {
  集: "paramSuffixEpisodes",
  episodes: "paramSuffixEpisodes",
  分钟: "paramSuffixMinutes",
  min: "paramSuffixMinutes",
  镜: "paramSuffixShots",
  shots: "paramSuffixShots",
};

export interface ParamFieldOption {
  label: string;
  value: string;
}

interface ParamField {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  value: string | number;
  /**
   * Select options as `{label, value}`. For key === "stylePainting" the
   * card overrides whatever LLM supplied with the real Java dictionary
   * (`/aurora/dictionaries/painting-styles`) on mount, so style IDs stay
   * in sync with the backend.
   */
  options?: ParamFieldOption[];
  suffix?: string;
  min?: number;
  max?: number;
}

interface ToolParamsCardProps {
  title: string;
  description?: string;
  fields: ParamField[];
  /**
   * `values` carries the raw submission (dictionary IDs for select fields).
   * `displayLabels` maps each key to the human-readable label (option.label
   * for selects, raw value for inputs). Callers use displayLabels for UI
   * rendering (tool result summary) while passing `values` to the agent /
   * downstream workflows.
   */
  onSubmit: (
    values: Record<string, string | number>,
    displayLabels: Record<string, string>
  ) => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

export function ToolParamsCard(props: ToolParamsCardProps) {
  const { user } = useCurrentUser();
  const projectId = useAppSelector((state) => state.project.currentProjectId);
  return (
    <ScopedToolParamsCard key={JSON.stringify([user?.id, projectId, props.fields])} {...props} />
  );
}

function ScopedToolParamsCard({
  title,
  description,
  fields,
  onSubmit,
  onDismiss,
  disabled = false,
}: ToolParamsCardProps) {
  const t = useTranslations("ai");
  const locale = useLocale();
  const submittedRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const controlsDisabled = disabled || submitted;
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value]))
  );

  const labelFor = (field: ParamField) => {
    const key = FIELD_LABEL_I18N[field.key];
    return key ? t(key) : field.label;
  };
  const suffixFor = (field: ParamField) => {
    if (!field.suffix) return undefined;
    const key = SUFFIX_I18N[field.suffix];
    return key ? t(key) : field.suffix;
  };
  const optionLabelFor = (fieldKey: string, opt: ParamFieldOption) => {
    const map = OPTION_LABEL_I18N[fieldKey];
    const key = map?.[opt.value];
    return key ? t(key) : opt.label;
  };

  // Auto-load Java dictionaries for fields that need them so the options
  // stay in sync with backend (LLM can't know dynamic style IDs; the
  // `stylePainting` field is the main one — the picked value is a real
  // style ID downstream `stylePaintingHint` can look up).
  const [dictOptions, setDictOptions] = useState<Record<string, ParamFieldOption[]>>({});
  useEffect(() => {
    const needsStyleDict = fields.some((f) => f.key === "stylePainting");
    if (!needsStyleDict) return;
    const controller = new AbortController();
    void fetchProjectDictionaries(controller.signal)
      .then((dicts) => {
        if (controller.signal.aborted) return;
        const styleOpts: ParamFieldOption[] = dicts.styleOptions.map((s) => ({
          label: s.info || s.id,
          value: s.id,
        }));
        if (styleOpts.length > 0) {
          setDictOptions((prev) => ({ ...prev, stylePainting: styleOpts }));
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // Soft-fail — LLM's fallback options still render.
        console.warn("[ToolParamsCard] load style dictionary failed:", err);
      });
    return () => {
      controller.abort();
    };
  }, [fields, locale]);

  // Merge dictionary-supplied options into the field spec (override LLM's
  // placeholder when dict loaded successfully).
  const resolvedFields: ParamField[] = fields.map((f) =>
    dictOptions[f.key] ? { ...f, options: dictOptions[f.key] } : f
  );

  const totalSteps = resolvedFields.length;
  const currentField = resolvedFields[step];
  const isLastStep = step === totalSteps - 1;

  const updateValue = (key: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  /**
   * Build a map of {fieldKey: humanReadableLabel} from the current values.
   * For select fields, looks up the matching option.label (so e.g.
   * stylePainting=2 displays as "Cartoon Style" in the tool-result
   * summary). For input fields, just stringifies the value.
   */
  const buildDisplayLabels = (
    finalValues: Record<string, string | number>
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of resolvedFields) {
      const v = finalValues[f.key];
      if (v === undefined || v === null || v === "") continue;
      if (f.type === "select" && f.options) {
        const matched = f.options.find((o) => String(o.value) === String(v));
        out[f.key] = matched ? optionLabelFor(f.key, matched) : String(v);
      } else {
        out[f.key] = String(v);
      }
    }
    return out;
  };

  const complete = (callback: () => void) => {
    if (controlsDisabled || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    let completed = false;
    try {
      callback();
      completed = true;
    } finally {
      if (!completed) {
        submittedRef.current = false;
        setSubmitted(false);
      }
    }
  };
  const finish = (finalValues: Record<string, string | number>) =>
    complete(() => onSubmit(finalValues, buildDisplayLabels(finalValues)));
  const handleDismiss = () => {
    if (onDismiss) complete(onDismiss);
  };
  const handleNext = () => {
    if (controlsDisabled || submittedRef.current || !currentField) return;
    if (isLastStep) finish(values);
    else setStep((value) => value + 1);
  };
  const handlePrev = () => {
    if (!controlsDisabled && !submittedRef.current && step > 0) setStep((value) => value - 1);
  };

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && onDismiss) {
          event.preventDefault();
          event.stopPropagation();
          handleDismiss();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            {currentField ? labelFor(currentField) : title}
            {currentField && suffixFor(currentField) && (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground/60">
                ({suffixFor(currentField)})
              </span>
            )}
          </div>
          {step === 0 && description && (
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handlePrev}
            disabled={controlsDisabled || step === 0}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
          >
            <IconChevronLeft className="size-3.5" />
          </button>
          <span className="min-w-10 text-center text-[11px] text-muted-foreground/50">
            {currentField ? step + 1 : 0} / {totalSteps}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={controlsDisabled || isLastStep || !currentField}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
          >
            <IconChevronRight className="size-3.5" />
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={handleDismiss}
              disabled={controlsDisabled}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground"
            >
              <IconX className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Step content */}
      <div className="px-3 py-2">
        {currentField?.type === "select" ? (
          <SelectStep
            key={currentField.key}
            field={currentField}
            value={String(values[currentField.key] ?? "")}
            disabled={controlsDisabled}
            onSelect={(val) => {
              if (controlsDisabled || submittedRef.current) return;
              updateValue(currentField.key, val);
              // Auto-advance on select
              if (isLastStep) {
                const finalValues = { ...values, [currentField.key]: val };
                finish(finalValues);
              } else {
                setStep((s) => s + 1);
              }
            }}
          />
        ) : currentField ? (
          <InputStep
            key={currentField.key}
            field={currentField}
            value={values[currentField?.key] ?? ""}
            disabled={controlsDisabled}
            onChange={(val) => updateValue(currentField.key, val)}
            onConfirm={handleNext}
            onPrev={handlePrev}
            step={step}
            isLastStep={isLastStep}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Number / Text input step ──────────────────────────

function InputStep({
  field,
  value,
  disabled,
  onChange,
  onConfirm,
  onPrev,
  step,
  isLastStep,
}: {
  field: ParamField;
  value: string | number;
  disabled: boolean;
  onChange: (value: string | number) => void;
  onConfirm: () => void;
  onPrev: () => void;
  step: number;
  isLastStep: boolean;
}) {
  const t = useTranslations("ai");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [field.key]);

  return (
    <div>
      <div className="py-2">
        <Field>
          <FieldLabel>
            {FIELD_LABEL_I18N[field.key] ? t(FIELD_LABEL_I18N[field.key]) : field.label}
          </FieldLabel>
          <Input
            ref={inputRef}
            type={field.type === "number" ? "number" : "text"}
            disabled={disabled}
            defaultValue={value}
            min={field.min}
            max={field.max}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(field.type === "number" && raw !== "" ? Number(raw) : raw);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
              }
            }}
          />
        </Field>

        <div className="mt-3 flex gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              color="muted"
              className="flex-1"
              onClick={onPrev}
              disabled={disabled}
            >
              <IconChevronLeft className="size-3" />
              {t("toolPrev")}
            </Button>
          )}
          <Button className="flex-1" onClick={onConfirm} disabled={disabled}>
            {isLastStep ? (
              <>
                <IconCheck className="size-3" />
                {t("toolConfirm")}
              </>
            ) : (
              <>
                {t("toolNext")}
                <IconChevronRight className="size-3" />
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2.5 border-t border-white/6 py-2 text-[10px] text-muted-foreground/40">
        <span>{isLastStep ? t("toolConfirmHint") : t("toolNextHint")}</span>
        <span className="text-muted-foreground/20">·</span>
        <span>{t("toolSkipHint")}</span>
      </div>
    </div>
  );
}

// ─── Select step (reuses options list style) ───────────

function SelectStep({
  field,
  value,
  disabled,
  onSelect,
}: {
  field: ParamField;
  value: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations("ai");
  const options = field.options ?? [];
  const [focusIndex, setFocusIndex] = useState(() => {
    const idx = options.findIndex((o) => o.value === value);
    return idx >= 0 ? idx : 0;
  });
  const [customInput, setCustomInput] = useState("");
  const [isCustomFocused, setIsCustomFocused] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);
  const totalItems = options.length + 1;

  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!disabled) regionRef.current?.focus();
  }, [field.key, disabled]);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      disabled ||
      totalItems === 0 ||
      event.defaultPrevented ||
      event.target instanceof HTMLInputElement
    )
      return;
    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        setFocusIndex((previous) => (previous - 1 + totalItems) % totalItems);
        break;
      case "ArrowDown":
        event.preventDefault();
        setFocusIndex((previous) => (previous + 1) % totalItems);
        break;
      case "Enter": {
        event.preventDefault();
        // A focused option button owns its normal Enter action.
        const target = event.target instanceof HTMLButtonElement ? event.target : null;
        if (target) target.click();
        else if (focusIndex < options.length) onSelect(options[focusIndex].value);
        else customInputRef.current?.focus();
        break;
      }
    }
  };

  return (
    <div ref={regionRef} tabIndex={0} onKeyDown={handleKeyDown}>
      {/* Scrollable options list — cap height so long dictionaries (18+
          painting styles etc.) don't blow the card past viewport. Custom
          "其他..." input stays pinned outside the scroll region below. */}
      <div className="max-h-[320px] overflow-y-auto py-1">
        {options.map((opt, index) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
            onMouseEnter={() => setFocusIndex(index)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all active:scale-[0.99]",
              focusIndex === index ? "bg-white/8" : "hover:bg-white/6",
              value === opt.value && "bg-primary/10"
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-medium",
                focusIndex === index
                  ? "bg-white/15 text-foreground"
                  : "bg-white/8 text-muted-foreground/70"
              )}
            >
              {index + 1}
            </span>
            <span className="text-[13px]">
              {OPTION_LABEL_I18N[field.key]?.[opt.value]
                ? t(OPTION_LABEL_I18N[field.key]![opt.value])
                : opt.label}
            </span>
          </button>
        ))}
      </div>

      <div className="py-1">
        {/* Custom input — stays visible regardless of options list scroll */}
        <div
          className={cn(
            "mt-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 transition-all",
            focusIndex === options.length || isCustomFocused ? "bg-white/8" : "hover:bg-white/6"
          )}
          onMouseEnter={() => setFocusIndex(options.length)}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/8 text-muted-foreground/50">
            <IconPencil className="size-3" />
          </span>
          <input
            ref={customInputRef}
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onFocus={() => {
              setFocusIndex(options.length);
              setIsCustomFocused(true);
            }}
            onBlur={() => setIsCustomFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customInput.trim()) {
                e.preventDefault();
                e.stopPropagation();
                onSelect(customInput.trim());
              }
            }}
            placeholder={t("toolSomethingElse")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/30"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={customInput.trim() ? () => onSelect(customInput.trim()) : undefined}
            disabled={disabled}
            className={cn(
              "flex shrink-0 items-center rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
              customInput.trim()
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "border-white/15 bg-white/8 text-muted-foreground hover:bg-white/15 hover:text-foreground"
            )}
          >
            {customInput.trim() ? t("toolSend") : t("toolSkip")}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2.5 border-t border-white/6 py-2 text-[10px] text-muted-foreground/40">
        <span>{t("toolNavHint")}</span>
        <span className="text-muted-foreground/20">·</span>
        <span>{t("toolSelectHint")}</span>
        <span className="text-muted-foreground/20">·</span>
        <span>{t("toolSkipHint")}</span>
      </div>
    </div>
  );
}
