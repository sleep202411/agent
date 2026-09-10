"use client";

import type { InputHTMLAttributes } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const codes = ["+86", "+65", "+1"] as const;
const control =
  "h-11 rounded-xl border-0 bg-input/30 px-3.5 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm";

// Keep the full editable identifier in the existing flow. No second account
// state: back navigation, password login and pending-code restoration agree.
function split(value: string) {
  const compact = value
    .trim()
    .replace(/[\s().\-\u2010-\u2015]/g, "")
    .replace(/^00/, "+");
  if (/^\+\d*$/.test(compact)) {
    const code = codes.find((candidate) => compact.startsWith(candidate));
    if (code) return { code, number: compact.slice(code.length) };
  }
  return { code: "", number: value };
}

export function CallingCodeInput({
  value,
  onValueChange,
  codeLabel,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  onValueChange: (value: string) => void;
  codeLabel: string;
}) {
  const { code, number } = split(String(value ?? ""));
  const unlistedInternational = number.trim().startsWith("+") || number.trim().startsWith("00");
  const email = /[^\d\s+().\-\u2010-\u2015]/.test(number);
  return (
    <div className="flex min-w-0 gap-2">
      <Select
        value={code || "none"}
        disabled={props.disabled || email || unlistedInternational}
        onValueChange={(next) => onValueChange((next === "none" ? "" : next) + number)}
      >
        <SelectTrigger
          aria-label={codeLabel}
          className={`${control} w-24 shrink-0 px-2 data-[size=default]:h-11`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          className="z-[120]"
          position="popper"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <SelectItem value="none">{codeLabel}</SelectItem>
          {codes.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input
        {...props}
        className={`${control} min-w-0 w-full placeholder:text-muted-foreground/70`}
        value={number}
        onChange={(event) => {
          const next = event.target.value;
          const national =
            /^[\d\s().\-\u2010-\u2015]*$/.test(next) && !next.trim().startsWith("00");
          onValueChange(national ? code + next : next);
        }}
      />
    </div>
  );
}
