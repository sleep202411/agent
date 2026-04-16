import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconPencil, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";

const PAGE_SIZE = 4; // 4 options + 1 free input = 5 rows per page

interface ToolOptionsCardProps {
  title: string;
  description?: string;
  options: Array<{ id: string; label: string; description?: string }>;
  multiSelect?: boolean;
  onSubmit: (selectedIds: string[], notes?: string) => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

export function ToolOptionsCard({
  title,
  description,
  options,
  multiSelect = false,
  onSubmit,
  onDismiss,
  disabled = false,
}: ToolOptionsCardProps) {
  const t = useTranslations("ai");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [isCustomFocused, setIsCustomFocused] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  const pageOptions = useMemo(
    () => options.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [options, page]
  );
  const totalItems = pageOptions.length + 1; // options + custom input row

  const toggleOption = useCallback(
    (id: string) => {
      if (disabled) return;
      if (multiSelect) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        });
      } else {
        onSubmit([id]);
      }
    },
    [disabled, multiSelect, onSubmit]
  );

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    onSubmit([trimmed]);
  }, [customInput, onSubmit]);

  // ─── Keyboard navigation ─────────────────────────────

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
          if (isCustomFocused) break; // let input handle its own Enter
          e.preventDefault();
          if (focusIndex < pageOptions.length) {
            toggleOption(pageOptions[focusIndex].id);
          } else {
            // Focus the custom input instead of submitting
            customInputRef.current?.focus();
          }
          break;
        case "Escape":
          e.preventDefault();
          onDismiss?.();
          break;
        case "ArrowLeft":
          if (!isCustomFocused && page > 0) {
            e.preventDefault();
            setPage((p) => p - 1);
          }
          break;
        case "ArrowRight":
          if (!isCustomFocused && page < totalPages - 1) {
            e.preventDefault();
            setPage((p) => p + 1);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    disabled,
    focusIndex,
    pageOptions,
    totalItems,
    page,
    totalPages,
    isCustomFocused,
    onDismiss,
    toggleOption,
    handleCustomSubmit,
  ]);

  useEffect(() => {
    setFocusIndex(0);
  }, [page]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{title}</div>
          {description && (
            <div className="mt-0.5 text-[11px] text-muted-foreground/70">{description}</div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {totalPages > 1 && (
            <>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
              >
                <IconChevronLeft className="size-3.5" />
              </button>
              <span className="min-w-10 text-center text-[11px] text-muted-foreground/50">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-30"
              >
                <IconChevronRight className="size-3.5" />
              </button>
            </>
          )}
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

      {/* Options */}
      <div className="px-2 py-1.5">
        {pageOptions.map((option, index) => {
          const globalIndex = page * PAGE_SIZE + index;
          const selected = selectedIds.has(option.id);
          const focused = focusIndex === index;

          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => toggleOption(option.id)}
              onMouseEnter={() => setFocusIndex(index)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all active:scale-[0.99]",
                focused ? "bg-white/8" : "hover:bg-white/6",
                selected && "bg-primary/10"
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-medium",
                  focused ? "bg-white/15 text-foreground" : "bg-white/8 text-muted-foreground/70"
                )}
              >
                {globalIndex + 1}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[13px]">{option.label}</span>
                {option.description && (
                  <div className="text-[11px] text-muted-foreground/60">{option.description}</div>
                )}
              </div>
            </button>
          );
        })}

        {/* Custom input row */}
        <div
          className={cn(
            "mt-0.5 flex items-center gap-3 rounded-lg px-2.5 py-2 transition-all",
            focusIndex === pageOptions.length || isCustomFocused ? "bg-white/8" : "hover:bg-white/6"
          )}
          onMouseEnter={() => setFocusIndex(pageOptions.length)}
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
              setFocusIndex(pageOptions.length);
              setIsCustomFocused(true);
            }}
            onBlur={() => setIsCustomFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                handleCustomSubmit();
              }
            }}
            placeholder={t("toolSomethingElse")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/30"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={customInput.trim() ? handleCustomSubmit : () => onDismiss?.()}
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

        {/* Multi-select submit */}
        {multiSelect && selectedIds.size > 0 && (
          <div className="mt-2 flex justify-end px-1">
            <button
              type="button"
              onClick={() => onSubmit(Array.from(selectedIds))}
              disabled={disabled}
              className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {t("toolConfirmSelected", { count: selectedIds.size })}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-2.5 border-t border-white/6 px-4 py-2 text-[10px] text-muted-foreground/40">
        <span>{t("toolNavHint")}</span>
        <span className="text-muted-foreground/20">·</span>
        <span>{t("toolSelectHint")}</span>
        <span className="text-muted-foreground/20">·</span>
        <span>{t("toolSkipHint")}</span>
      </div>
    </div>
  );
}
