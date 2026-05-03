"use client";

import { forwardRef, useState } from "react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SIZE_TO_PADDING: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "pr-7",
  default: "pr-8",
  lg: "pr-9",
};

const SIZE_TO_TOGGLE: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "right-2",
  default: "right-2",
  lg: "right-2.5",
};

const SIZE_TO_ICON: Record<NonNullable<InputProps["size"]>, string> = {
  sm: "size-3.5",
  default: "size-3.5",
  lg: "size-4",
};

/**
 * Shadcn Input + a show/hide eye toggle pinned to the right edge.
 * Padding / toggle position scale with `size` so the eye stays
 * vertically centered and the caret never collides with it.
 */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(
  { className, size, ...props },
  ref
) {
  const [visible, setVisible] = useState(false);
  const variant = size ?? "sm";
  return (
    <div className="relative">
      <Input
        {...props}
        ref={ref}
        size={size}
        type={visible ? "text" : "password"}
        className={cn(SIZE_TO_PADDING[variant], className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 flex items-center text-muted-foreground hover:text-foreground",
          SIZE_TO_TOGGLE[variant]
        )}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <IconEyeOff className={SIZE_TO_ICON[variant]} />
        ) : (
          <IconEye className={SIZE_TO_ICON[variant]} />
        )}
      </button>
    </div>
  );
});
