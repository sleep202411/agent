"use client";

import { IconChevronDown, IconSparkles } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FizzAgentModelOption {
  value: string;
  label: string;
  hint?: string;
}

export interface FizzAgentModelMenuProps {
  value: string;
  options: readonly FizzAgentModelOption[];
  label: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function FizzAgentModelMenu({
  value,
  options,
  label,
  onValueChange,
  disabled = false,
  className,
}: FizzAgentModelMenuProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          "inline-flex h-8 max-w-40 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-white/52 outline-none transition-colors hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45",
          className
        )}
      >
        <IconSparkles aria-hidden={true} className="size-3.5 shrink-0" />
        <span className="truncate">{selected?.label ?? label}</span>
        <IconChevronDown aria-hidden={true} className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="liquid-rim w-[min(320px,calc(100vw-24px))] rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_72px_rgba(0,0,0,0.68)] backdrop-blur-[36px]"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="min-h-12 items-start rounded-xl px-3 py-2.5 pr-9 focus:bg-white/[0.06]"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-white/88">{option.label}</span>
                {option.hint ? (
                  <span className="mt-0.5 block text-[11px]/relaxed text-white/42">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
