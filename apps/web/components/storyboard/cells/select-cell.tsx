"use client";

import { useRef, useEffect } from "react";

interface SelectCellProps {
  value: string;
  options: string[];
  editing: boolean;
  onSave: (value: string) => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
}

export function SelectCell({
  value,
  options,
  editing,
  onSave,
  onStartEdit,
  onStopEdit,
}: SelectCellProps) {
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
    }
  }, [editing]);

  if (!editing) {
    return (
      <div onDoubleClick={onStartEdit} className="cursor-pointer text-xs text-foreground">
        {value}
      </div>
    );
  }

  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => {
        onSave(e.target.value);
        onStopEdit();
      }}
      onBlur={onStopEdit}
      className="w-full cursor-pointer bg-transparent text-xs text-foreground focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
