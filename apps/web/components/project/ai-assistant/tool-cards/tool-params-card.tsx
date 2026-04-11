import { useEffect, useRef, useState } from "react";
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
import { useTranslations } from "@/src/i18n/i18n";

interface ParamField {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  value: string | number;
  options?: string[];
  suffix?: string;
  min?: number;
  max?: number;
}

interface ToolParamsCardProps {
  title: string;
  description?: string;
  fields: ParamField[];
  onSubmit: (values: Record<string, string | number>) => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

export function ToolParamsCard({
  title,
  description,
  fields,
  onSubmit,
  onDismiss,
  disabled = false,
}: ToolParamsCardProps) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string | number>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value]))
  );

  const totalSteps = fields.length;
  const currentField = fields[step];
  const isLastStep = step === totalSteps - 1;

  const updateValue = (key: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
    if (isLastStep) {
      onSubmit(values);
    } else {
      setStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            {currentField?.label ?? title}
            {currentField?.suffix && (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground/60">
                ({currentField.suffix})
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
            disabled={step === 0}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
          >
            <IconChevronLeft className="size-3.5" />
          </button>
          <span className="min-w-10 text-center text-[11px] text-muted-foreground/50">
            {step + 1} / {totalSteps}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={isLastStep}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
          >
            <IconChevronRight className="size-3.5" />
          </button>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={disabled}
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
            field={currentField}
            value={String(values[currentField.key] ?? "")}
            disabled={disabled}
            onSelect={(val) => {
              updateValue(currentField.key, val);
              // Auto-advance on select
              if (isLastStep) {
                onSubmit({ ...values, [currentField.key]: val });
              } else {
                setStep((s) => s + 1);
              }
            }}
          />
        ) : (
          <InputStep
            key={currentField.key}
            field={currentField}
            value={values[currentField?.key] ?? ""}
            disabled={disabled}
            onChange={(val) => updateValue(currentField.key, val)}
            onConfirm={handleNext}
            onPrev={handlePrev}
            step={step}
            isLastStep={isLastStep}
          />
        )}
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
          <FieldLabel>{field.label}</FieldLabel>
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
    const idx = options.indexOf(value);
    return idx >= 0 ? idx : 0;
  });
  const [customInput, setCustomInput] = useState("");
  const [isCustomFocused, setIsCustomFocused] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);
  const totalItems = options.length + 1;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex((prev) => (prev - 1 + totalItems) % totalItems);
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex((prev) => (prev + 1) % totalItems);
          break;
        case "Enter":
          if (isCustomFocused) break;
          e.preventDefault();
          if (focusIndex < options.length) {
            onSelect(options[focusIndex]);
          } else {
            customInputRef.current?.focus();
          }
          break;
        case "Escape":
          e.preventDefault();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, focusIndex, options, totalItems, isCustomFocused, onSelect]);

  return (
    <div>
      <div className="py-1">
        {options.map((opt, index) => (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt)}
            onMouseEnter={() => setFocusIndex(index)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all active:scale-[0.99]",
              focusIndex === index ? "bg-white/8" : "hover:bg-white/6",
              value === opt && "bg-primary/10"
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
            <span className="text-[13px]">{opt}</span>
          </button>
        ))}

        {/* Custom input */}
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
