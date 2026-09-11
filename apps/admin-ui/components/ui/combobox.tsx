"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { IconCheck, IconSelector, IconX } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

function Combobox<Value, Multiple extends boolean | undefined = false>({
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Root<Value, Multiple>>) {
  return <ComboboxPrimitive.Root data-slot="combobox" {...props} />;
}

function ComboboxInput({
  className,
  showClear = true,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input> & {
  /** Show an X control to clear the selected value (default true). */
  showClear?: boolean;
}) {
  return (
    <div className="relative">
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          showClear ? "pr-14" : "pr-8",
          className
        )}
        {...props}
      />
      {showClear ? (
        <ComboboxPrimitive.Clear
          data-slot="combobox-clear"
          className="absolute top-1/2 right-8 z-10 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Clear"
        >
          <IconX className="size-3.5" />
        </ComboboxPrimitive.Clear>
      ) : null}
      <ComboboxPrimitive.Icon className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground">
        <IconSelector className="size-4" />
      </ComboboxPrimitive.Icon>
    </div>
  );
}

function ComboboxClear({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Clear>) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      <IconX className="size-3.5" />
    </ComboboxPrimitive.Clear>
  );
}

function ComboboxContent({
  className,
  children,
  sideOffset = 4,
  align = "start",
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> & {
  sideOffset?: React.ComponentProps<typeof ComboboxPrimitive.Positioner>["sideOffset"];
  align?: React.ComponentProps<typeof ComboboxPrimitive.Positioner>["align"];
}) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner sideOffset={sideOffset} align={align} className="z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            // `pointer-events-auto` is required when this popup is portaled out
            // of a modal Radix dialog (e.g. Sheet), which sets the body to
            // `pointer-events: none`; without it the options are unclickable.
            // The Popup is the single scroll container (overscroll-contain so the
            // scroll doesn't chain to the Sheet body at the edges).
            "pointer-events-auto max-h-72 min-w-(--anchor-width) overflow-y-auto overscroll-contain rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      // Natural height — the Popup owns the scroll (see ComboboxContent).
      className={cn("p-1", className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <ComboboxPrimitive.ItemIndicator>
          <IconCheck className="size-4" />
        </ComboboxPrimitive.ItemIndicator>
      </span>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      // base-ui keeps Empty mounted (nulls its children when the list has items);
      // `empty:hidden` collapses the padded box so it doesn't leave a blank gap.
      className={cn("px-3 py-6 text-center text-sm text-muted-foreground empty:hidden", className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
};
