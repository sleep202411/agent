import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface GlitchTextProps {
  children: string;
  speed?: number;
  enableShadows?: boolean;
  enableOnHover?: boolean;
  /** Chromatic layer colors when shadows are enabled (defaults: red / blue). */
  shadowColors?: { after?: string; before?: string };
  className?: string;
  /**
   * Styles the accessible base copy only (e.g. a gradient text fill) — the
   * animated layers keep inheriting the surrounding solid color so their
   * opaque slice backgrounds stay legible.
   */
  baseClassName?: string;
}

interface GlitchTextProperties extends CSSProperties {
  "--glitch-after-duration": string;
  "--glitch-before-duration": string;
  "--glitch-after-shadow": string;
  "--glitch-before-shadow": string;
}

/**
 * Product-owned adaptation of React Bits' GlitchText (MIT):
 * https://reactbits.dev/text-animations/glitch-text
 *
 * The animated copies are explicit aria-hidden layers, so the real text stays
 * the only accessible copy. Animation is disabled globally when the user
 * prefers reduced motion.
 */
export function GlitchText({
  children,
  speed = 0.5,
  enableShadows = false,
  enableOnHover = false,
  shadowColors,
  className,
  baseClassName,
}: GlitchTextProps) {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0.5;
  const style: GlitchTextProperties = {
    "--glitch-after-duration": `${Number((safeSpeed * 3).toFixed(3))}s`,
    "--glitch-before-duration": `${Number((safeSpeed * 2).toFixed(3))}s`,
    "--glitch-after-shadow": enableShadows
      ? `-0.08em 0 ${shadowColors?.after ?? "#e52227"}`
      : "none",
    "--glitch-before-shadow": enableShadows
      ? `0.08em 0 ${shadowColors?.before ?? "#5b9dff"}`
      : "none",
  };

  return (
    <span
      data-glitch-trigger={enableOnHover ? "hover" : "always"}
      style={style}
      className={cn("react-bits-glitch-text relative inline-block select-none", className)}
    >
      <span data-glitch-base className={baseClassName}>
        {children}
      </span>
      <span aria-hidden="true" data-glitch-layer="after" className="react-bits-glitch-layer">
        {children}
      </span>
      <span aria-hidden="true" data-glitch-layer="before" className="react-bits-glitch-layer">
        {children}
      </span>
    </span>
  );
}
