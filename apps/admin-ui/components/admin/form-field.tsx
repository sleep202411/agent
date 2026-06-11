"use client";

import { type ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AdminFieldDefinition<Name extends string = string> = {
  name: Name;
  label: string;
  required?: boolean;
};

export type AdminFieldControlProps = {
  id: string;
  name?: string;
  required: boolean;
  "aria-required"?: true;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type AdminFormFieldChildren = ReactNode | ((props: AdminFieldControlProps) => ReactNode);

export function AdminFormField({
  field,
  name,
  label,
  required,
  optional,
  hint,
  error,
  className,
  children,
}: {
  field?: AdminFieldDefinition;
  name?: string;
  label?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  className?: string;
  children: AdminFormFieldChildren;
}) {
  const generatedId = useId();
  const controlId = generatedId;
  const fieldName = field?.name ?? name;
  const fieldLabel = field?.label ?? label;
  const isRequired = required ?? field?.required ?? false;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const renderControl = typeof children === "function";

  return (
    <div className={cn("grid gap-1.5", className)} data-required={isRequired || undefined}>
      {fieldLabel ? (
        <Label
          htmlFor={renderControl ? controlId : undefined}
          className="min-h-4 gap-1.5 text-[12px] font-semibold text-slate-600"
        >
          <span>{fieldLabel}</span>
          {isRequired ? (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-slate-500">
              必填
            </span>
          ) : optional ? (
            <span className="text-[10px] leading-none font-medium text-slate-400">可选</span>
          ) : null}
        </Label>
      ) : null}
      {renderControl
        ? children({
            id: controlId,
            name: fieldName,
            required: isRequired,
            "aria-required": isRequired ? true : undefined,
            "aria-describedby": describedBy,
            "aria-invalid": error ? true : undefined,
          })
        : children}
      {hint ? (
        <p id={hintId} className="text-[11px] leading-4 text-slate-400">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[12px] leading-4 font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
