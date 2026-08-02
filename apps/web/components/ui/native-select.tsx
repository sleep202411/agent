/**
 * Drop-in replacement for the original browser-native select component.
 *
 * Implementation note (May 2026): originally rendered a browser-native control.
 * Chromium on Windows refuses to render the OS-painted popup
 * with `color-scheme: dark` reliably — even when both root and element
 * declare it — leaving creator-tool dialogs with a jarring white panel
 * over a dark surface. Swapped to a Radix-based shadcn Select so the
 * popup is fully DOM-rendered.
 *
 * Public API:
 *   <NativeSelect value={x} onChange={setX} disabled={...} className="...">
 *     <NativeSelectOption value="" disabled>placeholder</NativeSelectOption>
 *     <NativeSelectOption value="a">A</NativeSelectOption>
 *   </NativeSelect>
 *
 * `onChange` now receives the value string directly (Radix-style), not a
 * synthetic event — call sites used to do `(event) => setX(event.target.value)`
 * and have been updated to `setX` directly.
 *
 * Empty-string-valued children are mapped to an internal sentinel because
 * Radix reserves `value=""`. This keeps optional fields genuinely clearable
 * while the public API continues to read and write an empty string.
 */
import * as React from "react";

import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMPTY_VALUE = "__native_select_empty__";

type NativeSelectProps = {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  children?: React.ReactNode;
};

type NativeSelectOptionProps = {
  value: string;
  disabled?: boolean;
  children?: React.ReactNode;
};

// Accept both `<NativeSelectOption>` and raw `<option>` so legacy call sites
// that pre-date the shadcn migration keep working without per-file edits.
function isOptionElement(
  node: React.ReactNode
): node is React.ReactElement<NativeSelectOptionProps> {
  return React.isValidElement(node) && (node.type === NativeSelectOption || node.type === "option");
}

function NativeSelect({
  value,
  onChange,
  disabled,
  className,
  size = "default",
  placeholder,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  children,
}: NativeSelectProps) {
  // Translate every option-shaped child
  // (whether <NativeSelectOption> or raw <option>) into <SelectItem> so
  // Radix's SelectContent renders correctly. Empty values use a sentinel so
  // optional fields remain clearable. Other nodes pass through.
  let extractedPlaceholder: React.ReactNode = placeholder;
  let hasEmptyOption = false;
  const items: React.ReactNode[] = [];

  React.Children.forEach(children, (child, index) => {
    if (isOptionElement(child)) {
      const { value: itemValue, disabled: itemDisabled, children: itemChildren } = child.props;
      if (itemValue === "") {
        hasEmptyOption = true;
        if (extractedPlaceholder == null) extractedPlaceholder = itemChildren;
      }
      items.push(
        <SelectItem
          key={child.key ?? `opt-${index}`}
          value={itemValue === "" ? EMPTY_VALUE : itemValue}
          disabled={itemDisabled}
        >
          {itemChildren}
        </SelectItem>
      );
      return;
    }
    items.push(child);
  });

  const radixValue = value === "" ? (hasEmptyOption ? EMPTY_VALUE : undefined) : value;
  const placeholderText =
    typeof extractedPlaceholder === "string" || typeof extractedPlaceholder === "number"
      ? String(extractedPlaceholder)
      : undefined;

  return (
    <Select
      value={radixValue}
      onValueChange={(nextValue) => onChange?.(nextValue === EMPTY_VALUE ? "" : nextValue)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        size={size}
        className={cn("w-full", className)}
      >
        <SelectValue placeholder={placeholderText} />
      </SelectTrigger>
      <SelectContent>{items}</SelectContent>
    </Select>
  );
}

function NativeSelectOption({ value, disabled, children }: NativeSelectOptionProps) {
  return (
    <SelectItem value={value} disabled={disabled}>
      {children}
    </SelectItem>
  );
}

function NativeSelectOptGroup({ children }: { children?: React.ReactNode }) {
  return <SelectGroup>{children}</SelectGroup>;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
