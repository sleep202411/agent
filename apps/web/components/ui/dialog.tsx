import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";

function Dialog({ modal = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" modal={modal} {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  overlayClassName?: string;
}) {
  // Radix modal dialog sets body { pointer-events: none } via react-remove-scroll,
  // which blocks clicks on floating popups (tippy, mention lists) mounted on body.
  // Remove it on mount, restore on unmount. Scroll lock still works via overflow: hidden.
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
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-show-close={showCloseButton}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-popover text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex items-center justify-between gap-2 border-b border-border p-4",
        className
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">{children}</div>
      <DialogPrimitive.Close data-slot="dialog-close" asChild>
        <Button variant="ghost" color="muted" size="icon-sm" className="shrink-0">
          <IconX />
          <span className="sr-only">Close</span>
        </Button>
      </DialogPrimitive.Close>
    </div>
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-sm font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

// DialogHero — image banner that stretches across the top of a dialog with
// title / description / eyebrow overlaid on a legibility scrim. Pair with
// `<DialogContent className="overflow-hidden p-0">` so the image bleeds to
// the rounded corners. Use the `eyebrow` prop for short uppercase taglines;
// `title` and `description` should be DialogTitle / DialogDescription nodes
// (or strings, in which case they're rendered with the right styling).
function DialogHero({
  src,
  alt = "",
  eyebrow,
  title,
  description,
  className,
  height = "h-44",
  fallbackGradient = "bg-linear-to-br from-[#1a1a2e] via-[#1f1530] to-[#0f3460]",
}: {
  src: string;
  alt?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  height?: string;
  fallbackGradient?: string;
}) {
  return (
    <div
      data-slot="dialog-hero"
      className={cn("relative w-full overflow-hidden", height, fallbackGradient, className)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute inset-0 size-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      {/* Legibility scrim */}
      <div className="absolute inset-0 bg-linear-to-b from-black/60 via-black/20 to-transparent" />

      {(eyebrow || title || description) && (
        <div className="absolute inset-x-4 top-5">
          {eyebrow && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
              {eyebrow}
            </div>
          )}
          {title &&
            (typeof title === "string" ? (
              <DialogTitle className="mt-1 font-heading text-xl font-bold text-white drop-shadow-md">
                {title}
              </DialogTitle>
            ) : (
              title
            ))}
          {description &&
            (typeof description === "string" ? (
              <DialogDescription className="mt-1.5 line-clamp-2 max-w-[420px] text-xs text-white/75">
                {description}
              </DialogDescription>
            ) : (
              description
            ))}
        </div>
      )}

      <DialogPrimitive.Close asChild>
        <button
          type="button"
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full bg-black/30 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
        >
          <IconX className="size-4" />
        </button>
      </DialogPrimitive.Close>
    </div>
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHero,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
