"use client";

import type { ComponentType } from "react";
import { IconHandStop, IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FizzAgentPermissionMode = "ask" | "smart" | "full";

export interface FizzAgentPermissionOption {
  value: FizzAgentPermissionMode;
  label: string;
  description: string;
}

export interface FizzAgentPermissionMenuLabels {
  menu: string;
}

export interface FizzAgentPermissionMenuProps {
  value: FizzAgentPermissionMode;
  options: readonly FizzAgentPermissionOption[];
  labels: FizzAgentPermissionMenuLabels;
  onValueChange: (value: FizzAgentPermissionMode) => void;
  disabled?: boolean;
  className?: string;
}

const modeIcons: Record<
  FizzAgentPermissionMode,
  ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  ask: IconHandStop,
  smart: IconShieldCheck,
  full: IconShieldExclamation,
};

export function FizzAgentPermissionMenu({
  value,
  options,
  labels,
  onValueChange,
  disabled = false,
  className,
}: FizzAgentPermissionMenuProps) {
  const selected = options.find((option) => option.value === value);
  const SelectedIcon = modeIcons[value];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={labels.menu}
        className={cn(
          "inline-flex h-8 max-w-44 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-white/82 outline-none transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 disabled:opacity-45",
          className
        )}
      >
        <SelectedIcon
          aria-hidden={true}
          className={cn("size-3.5 shrink-0", value === "full" && "text-destructive/82")}
        />
        {selected ? <span className="truncate">{selected.label}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="liquid-rim w-[min(360px,calc(100vw-24px))] rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_24px_72px_rgba(0,0,0,0.68)] backdrop-blur-[36px]"
      >
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onValueChange(nextValue as FizzAgentPermissionMode)}
        >
          {options.map((option) => {
            const Icon = modeIcons[option.value];
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="min-h-14 items-start rounded-xl px-3 py-2.5 pr-9 focus:bg-white/[0.06]"
              >
                <Icon
                  aria-hidden={true}
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-white/72",
                    option.value === "full" && "text-destructive/82"
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-xs font-medium text-white",
                      option.value === "full" && "text-destructive/90"
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[11px]/relaxed text-white/65">
                    {option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
