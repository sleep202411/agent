"use client";

import { createContext, useContext, useState } from "react";
import { IconArrowsMaximize, IconArrowsMinimize, IconX, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const PanelAnimateContext = createContext(false);

interface PanelLayoutProps {
  title: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
  headerExtra?: React.ReactNode;
  loading?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}

export function PanelLayout({
  title,
  icon,
  description,
  onClose,
  actions,
  headerExtra,
  loading,
  footer,
  children,
  bodyClassName,
}: PanelLayoutProps) {
  const animate = useContext(PanelAnimateContext);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "mr-4 mb-4 flex rounded-xl shrink-0 flex-col overflow-hidden bg-card transition-[width] duration-250 ease-in-out",
        animate && "animate-[panel-open_0.25s_ease-in-out]"
      )}
      style={{ width: expanded ? "min(50vw, 1080px)" : 420 }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-4">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {headerExtra}
          </div>
          {description && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {expanded ? (
              <IconArrowsMinimize className="size-3.5" />
            ) : (
              <IconArrowsMaximize className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className={cn("flex-1 overflow-auto px-4", bodyClassName)}>{children}</div>
      )}

      {/* Footer */}
      {footer && !loading && <div className="shrink-0 p-4">{footer}</div>}

      {/* eslint-disable-next-line react/no-danger */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes panel-open { from { width: 0; opacity: 0; } }`,
        }}
      />
    </div>
  );
}
