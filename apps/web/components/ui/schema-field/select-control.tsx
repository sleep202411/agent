"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SelectControlProps {
  options: { value: string | number; label: string }[];
  value: unknown;
  onChange: (v: string | number) => void;
  disabled?: boolean;
  placeholder?: string;
  groupLabel?: string;
}

export function SelectControl({
  options,
  value,
  onChange,
  disabled,
  placeholder,
  groupLabel,
}: SelectControlProps) {
  const stringValue = String(value ?? "");
  const hasMatch = options.some((o) => String(o.value) === stringValue);

  return (
    <Select
      value={hasMatch ? stringValue : undefined}
      onValueChange={(v) => {
        const opt = options.find((o) => String(o.value) === v);
        if (opt) onChange(opt.value);
      }}
      disabled={disabled || options.length === 0}
    >
      <SelectTrigger size="default">
        <SelectValue placeholder={placeholder ?? "..."} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {groupLabel && <SelectLabel>{groupLabel}</SelectLabel>}
          {options.map((opt) => (
            <SelectItem key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
