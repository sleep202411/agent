"use client";

import { type ReactNode } from "react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ProductionPropertyOption<T extends string | null> {
  value: T;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  keywords?: string[];
}

export function ProductionPropertyMenu<T extends string | null>({
  open,
  onOpenChange,
  disabled,
  trigger,
  searchPlaceholder,
  emptyLabel,
  value,
  options,
  onSelect,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  trigger: ReactNode;
  searchPlaceholder: string;
  emptyLabel: string;
  value: T;
  options: Array<ProductionPropertyOption<T>>;
  onSelect: (value: T) => void;
  className?: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-56 gap-0 overflow-hidden rounded-lg border border-white/[0.1] bg-[#17181c] p-0 shadow-[0_22px_70px_rgba(0,0,0,.58)]",
          className
        )}
      >
        <Command>
          <CommandInput autoFocus placeholder={searchPlaceholder} />
          <CommandList className="p-1">
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value ?? "none"}
                value={[option.label, ...(option.keywords ?? [])].join(" ")}
                data-checked={option.value === value}
                onSelect={() => {
                  onSelect(option.value);
                  onOpenChange(false);
                }}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.shortcut ? <CommandShortcut>{option.shortcut}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ProductionPropertyButton({
  disabled,
  children,
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "group/property flex h-7 items-center gap-1.5 rounded-md px-2 text-[#a8adb5] transition-colors hover:bg-white/[0.045] hover:text-[#e0e2e5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-default disabled:hover:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
