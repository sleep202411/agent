"use client";

import { useState } from "react";
import { IconLoader2, IconArrowBackUp } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MentionPromptDisplay } from "@/components/media/mention-prompt-display";

// ─── Types ──────────────────────────────────────────────

export interface ToolbarAction {
  key: string;
  icon: React.ReactNode;
  label?: string;
  active?: boolean;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  /** If provided, renders a meta info popover instead of a button */
  metaContent?: string;
  /** Optional "reuse" action for meta popovers — renders a button that
   *  the caller wires to e.g. refilling the current prompt input with
   *  the historical content. Only rendered when `metaContent` is set. */
  onApplyMeta?: () => void;
  /** Label for the apply button. Caller supplies it (i18n) so this
   *  component stays string-free. */
  applyMetaLabel?: string;
  onClick?: () => void;
}

// ─── ToolbarButton ──────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  active,
  loading,
  disabled,
  title,
  onClick,
}: Omit<ToolbarAction, "key" | "metaContent">) {
  const isDisabled = disabled || loading;
  const displayIcon = loading ? <IconLoader2 className="size-3.5 animate-spin" /> : icon;

  const button = (
    <button
      type="button"
      disabled={isDisabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors",
        active
          ? "bg-primary/20 text-primary"
          : isDisabled
            ? "cursor-not-allowed text-white/30"
            : "text-white hover:bg-white/10"
      )}
    >
      {displayIcon}
      {label ? <span>{label}</span> : null}
    </button>
  );

  if (!title) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── MetaPopoverButton ──────────────────────────────────

function MetaPopoverButton({
  icon,
  content,
  title,
  onApply,
  applyLabel,
}: {
  icon: React.ReactNode;
  content: string;
  title?: string;
  onApply?: () => void;
  applyLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  const handleApply = () => {
    onApply?.();
    setOpen(false);
  };

  return (
    <div className="relative">
      <ToolbarButton icon={icon} active={open} title={title} onClick={() => setOpen((v) => !v)} />
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-[360px] rounded-lg border border-white/10 bg-black/90 p-3 text-xs leading-5 text-white shadow-2xl">
          <div className="max-h-52 overflow-auto break-all">
            <MentionPromptDisplay
              prompt={content}
              className="whitespace-pre-wrap text-xs leading-5 text-white/90"
            />
          </div>
          {onApply ? (
            <div className="mt-2 flex justify-end border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={handleApply}
                className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
              >
                <IconArrowBackUp className="size-3.5" />
                {applyLabel ?? "Apply"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── FloatingToolbar ────────────────────────────────────

interface FloatingToolbarProps {
  actions: ToolbarAction[];
  className?: string;
  position?: "top-right" | "top-left" | "bottom" | "bottom-left" | "bottom-right" | "none";
}

const positionClasses: Record<string, string> = {
  "top-right": "absolute right-3 top-3 z-10",
  "top-left": "absolute left-3 top-3 z-10",
  bottom: "absolute inset-x-3 bottom-3 z-10",
  "bottom-left": "absolute left-3 bottom-3 z-10",
  "bottom-right": "absolute right-3 bottom-3 z-10",
  none: "",
};

export function FloatingToolbar({ actions, className, position = "none" }: FloatingToolbarProps) {
  if (actions.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "flex w-fit items-center gap-2 rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm",
          positionClasses[position],
          className
        )}
      >
        {actions.map((action) =>
          action.metaContent ? (
            <MetaPopoverButton
              key={action.key}
              icon={action.icon}
              content={action.metaContent}
              title={action.title}
              onApply={action.onApplyMeta}
              applyLabel={action.applyMetaLabel}
            />
          ) : (
            <ToolbarButton
              key={action.key}
              icon={action.icon}
              label={action.label}
              active={action.active}
              loading={action.loading}
              disabled={action.disabled}
              title={action.title}
              onClick={action.onClick}
            />
          )
        )}
      </div>
    </TooltipProvider>
  );
}
