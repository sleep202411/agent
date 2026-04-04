"use client";

import { useRef, useEffect } from "react";

interface NumberCellProps {
  value: number;
  editing: boolean;
  onSave: (value: number) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  suffix?: string;
}

export function NumberCell({
  value,
  editing,
  onSave,
  onStartEdit,
  onStopEdit,
  suffix = "s",
}: NumberCellProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <div onDoubleClick={onStartEdit} className="cursor-text text-center text-xs text-foreground">
        {value}
        {suffix}
      </div>
    );
  }

  return (
    <input
      ref={ref}
      type="number"
      value={value}
      onChange={(e) => {
        const num = parseFloat(e.target.value);
        if (!isNaN(num)) onSave(num);
      }}
      onBlur={onStopEdit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onStopEdit();
        }
        if (e.key === "Enter") {
          e.stopPropagation();
          onStopEdit();
        }
      }}
      className="w-full bg-transparent text-center text-xs text-foreground focus:outline-none"
    />
  );
}
