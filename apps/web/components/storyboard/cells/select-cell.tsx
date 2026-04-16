import { useMemo, useRef, useState } from "react";
import { IconCheck, IconPlus, IconX } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { getCellDisplayValue, parseColumnOptions, persistTextCell } from "./cell-utils";
import type { ShotColumn, ShotValue } from "@/src/store/slices/projectSlice";

export function SelectCell({
  column,
  cell,
  shotId,
  shotColumnId,
}: {
  column: ShotColumn;
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const options = parseColumnOptions(column);
  const display = getCellDisplayValue(cell);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((opt) => opt.toLowerCase().includes(query));
  }, [options, inputValue]);

  const handleSelect = (value: string) => {
    if (value !== display) {
      void persistTextCell(shotId, shotColumnId, value);
    }
    setOpen(false);
    setInputValue("");
  };

  const handleClear = () => {
    if (display) {
      void persistTextCell(shotId, shotColumnId, "");
    }
    setOpen(false);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && inputValue.trim()) {
      e.preventDefault();
      handleSelect(inputValue.trim());
    }
    if (e.key === "Escape") {
      setOpen(false);
      setInputValue("");
    }
  };

  return (
    <div className="flex h-full w-full items-center px-2">
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setInputValue("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 w-full items-center rounded-md px-2 text-xs hover:bg-muted/30"
          >
            <span className={display ? "text-foreground" : "text-muted-foreground"}>
              {display || t("select")}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-48 p-0"
          onOpenAutoFocus={() => setTimeout(() => inputRef.current?.focus(), 0)}
        >
          <div className="p-1.5">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("searchOrEnter")}
              className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div className="max-h-40 overflow-auto p-1">
            {filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent",
                  option === display && "text-primary"
                )}
              >
                {option === display && <IconCheck className="size-3" />}
                <span className={option === display ? "" : "pl-5"}>{option}</span>
              </button>
            ))}
            {inputValue.trim() && !options.includes(inputValue.trim()) && (
              <button
                type="button"
                onClick={() => handleSelect(inputValue.trim())}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary transition-colors hover:bg-accent"
              >
                <IconPlus className="size-3" />
                <span>{inputValue.trim()}</span>
              </button>
            )}
            {filteredOptions.length === 0 && !inputValue.trim() && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t("noOptions")}
              </div>
            )}
          </div>
          {display && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onClick={handleClear}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <IconX className="size-3" />
                <span>{t("clear")}</span>
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
