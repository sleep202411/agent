import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";

/**
 * A Sheet is a side-anchored variant of Dialog — same Radix primitive
 * underneath so focus-trap / Esc / ARIA all work identically. Used when
 * the content is long-form (forms, lists) and benefits from sliding in
 * from an edge instead of popping up in the middle.
 *
 * Usage:
 *   <Sheet open={...} onOpenChange={...}>
 *     <SheetContent side="bottom" className="max-w-2xl mx-auto">
 *       <SheetHeader>
 *         <SheetTitle>...</SheetTitle>
 *       </SheetHeader>
 *       ...
 *     </SheetContent>
 *   </Sheet>
 */

function Sheet({ modal = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" modal={modal} {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/80 duration-200 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  );
}

type SheetSide = "top" | "right" | "bottom" | "left";

const SIDE_CLASSES: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 border-b rounded-b-xl data-open:slide-in-from-top data-closed:slide-out-to-top",
  bottom:
    "inset-x-0 bottom-0 border-t rounded-t-xl data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
  left: "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm data-open:slide-in-from-left data-closed:slide-out-to-left",
  right:
    "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm data-open:slide-in-from-right data-closed:slide-out-to-right",
};

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: SheetSide;
  showCloseButton?: boolean;
}) {
  // Same pointer-events guard as Dialog — Radix modal sets body {
  // pointer-events: none } via react-remove-scroll, which blocks
  // tippy/mention popups mounted on document.body. Scroll lock still
  // works via overflow: hidden.
  React.useEffect(() => {
    const body = document.body;
    body.style.removeProperty("pointer-events");
    const observer = new MutationObserver(() => {
      if (body.style.pointerEvents === "none") {
        body.style.removeProperty("pointer-events");
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-show-close={showCloseButton}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(
          "fixed z-50 flex flex-col bg-popover text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-200 outline-none data-open:animate-in data-closed:animate-out",
          SIDE_CLASSES[side],
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b border-border p-4",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">{children}</div>
      <DialogPrimitive.Close data-slot="sheet-close" asChild>
        <Button variant="ghost" color="muted" size="icon-sm" className="shrink-0">
          <IconX />
          <span className="sr-only">Close</span>
        </Button>
      </DialogPrimitive.Close>
    </div>
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("flex-1 overflow-y-auto space-y-4 px-4 py-2", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
