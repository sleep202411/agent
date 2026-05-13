"use client";

import { useEffect } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const KEYFRAMES_ID = "generate-button-keyframes";

function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes star-movement-bottom {
      0% { transform: translate(0%, 0%); opacity: 1; }
      100% { transform: translate(-100%, 0%); opacity: 0; }
    }
    @keyframes star-movement-top {
      0% { transform: translate(0%, 0%); opacity: 1; }
      100% { transform: translate(100%, 0%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

const starStyle = (
  position: "top" | "bottom",
  color: string,
  speed: string
): React.CSSProperties => ({
  position: "absolute",
  width: "300%",
  height: "50%",
  opacity: 0.7,
  borderRadius: "9999px",
  background: `radial-gradient(circle, ${color}, transparent 10%)`,
  animation: `star-movement-${position} ${speed} linear infinite alternate`,
  zIndex: 0,
  ...(position === "top" ? { top: "-10px", left: "-250%" } : { bottom: "-11px", right: "-250%" }),
});

interface GenerateButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Optional tooltip shown on hover when the button is disabled (native `title` attr). */
  disabledHint?: string;
  cost?: number;
  className?: string;
}

export function GenerateButton({
  onClick,
  loading,
  disabled,
  disabledHint,
  cost,
  className,
}: GenerateButtonProps) {
  useEffect(() => {
    injectKeyframes();
  }, []);

  const isLoading = !!loading;
  // `loading` blocks clicks outright; `disabled` lets clicks through so the
  // caller can surface a toast — pointer-events-none would swallow them.
  const isDisabled = !!disabled && !isLoading;

  return (
    <div
      onClick={isLoading ? undefined : onClick}
      title={isDisabled ? disabledHint : undefined}
      className={cn(
        "relative inline-flex overflow-hidden rounded-xl",
        isLoading
          ? "pointer-events-none opacity-60"
          : isDisabled
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer",
        className
      )}
      style={{ padding: "1px" }}
    >
      <div style={starStyle("bottom", "#FFD700", "4s")} />
      <div style={starStyle("top", "#FFD700", "4s")} />
      <span className="relative z-[1] flex items-center gap-1.5 rounded-[10px] bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
        {loading ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : (
          <IconSparkles className="size-4" />
        )}
        {cost != null && cost > 0 && <span className="tabular-nums">{cost}</span>}
      </span>
    </div>
  );
}
