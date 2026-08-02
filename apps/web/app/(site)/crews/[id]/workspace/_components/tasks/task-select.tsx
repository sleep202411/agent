"use client";

import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__crew_task_select_empty__";

export interface TaskSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function TaskSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled,
  placeholder,
  prefix,
  displayValue,
  className,
  contentClassName,
}: {
  value: string;
  options: TaskSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  prefix?: ReactNode;
  displayValue?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Select
      value={value === "" ? EMPTY_VALUE : value}
      onValueChange={(nextValue) => onValueChange(nextValue === EMPTY_VALUE ? "" : nextValue)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-8 w-full min-w-0 border-white/[0.09] bg-[#111216] px-2 text-[11px] text-[#c9cbd1] hover:bg-[#17181d] focus-visible:border-white/[0.17] focus-visible:ring-white/10 dark:bg-[#111216] dark:hover:bg-[#17181d]",
          className
        )}
      >
        {prefix}
        <SelectValue placeholder={placeholder}>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className={cn(
          "border border-white/[0.1] bg-[#17181c] text-[#d9dce1] shadow-[0_18px_50px_rgba(0,0,0,.55)] ring-0",
          contentClassName
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_VALUE}
            value={option.value === "" ? EMPTY_VALUE : option.value}
            disabled={option.disabled}
            className="text-[11px] focus:bg-white/[0.07] focus:text-white"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
