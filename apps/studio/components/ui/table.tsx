"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table — de-chromed at the source for this app's dark, borderless language
 * (DESIGN.md §4), the same treatment card / input / textarea / select / tabs got.
 *
 * Deviations from the upstream shadcn table:
 *   • rows separate with the sanctioned hairline (`border-b border-border`, the
 *     one permitted "border"), never an outline around the table itself — the
 *     surface is whatever frosted panel the caller puts it in;
 *   • hover / selected use white-alpha washes instead of `bg-muted`, which is a
 *     solid tone step and reads as a slab on a frosted surface;
 *   • the header row is a quiet label band (small, low-contrast, no bottom rule)
 *     rather than foreground-weight text;
 *   • cells wrap by default (a storyboard line or a note is prose, not a token);
 *     pass `whitespace-nowrap` where a column must stay on one line;
 *   • `containerClassName` is exposed so a caller can own the scroll container —
 *     a sticky header needs the vertical overflow to live there.
 */
function Table({
  className,
  containerClassName,
  containerRef,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  /** The scroll container — a virtualizer needs to own it. */
  containerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-white/[0.022] has-aria-expanded:bg-white/[0.03] data-[state=selected]:bg-white/[0.05]",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-2.5 text-left align-middle text-[11px] font-medium tracking-[0.02em] whitespace-nowrap text-white/32",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td data-slot="table-cell" className={cn("px-2.5 py-2 align-middle", className)} {...props} />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
