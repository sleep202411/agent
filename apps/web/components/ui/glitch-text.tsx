"use client";

/**
 * GlitchText — pure-CSS RGB-split glitch effect via ::before / ::after.
 * Ported from react-bits (MIT + Commons Clause). Default mode is
 * `enableOnHover`-style — clean state by default, glitch only on hover.
 *
 * Usage:
 *   <GlitchText>FizzDragon</GlitchText>            // hover-triggered
 *   <GlitchText alwaysOn enableShadows>404</GlitchText>  // looping
 */

import type { CSSProperties, ReactNode } from "react";
import "./glitch-text.css";

export interface GlitchTextProps {
  children: ReactNode;
  /** Hover-only by default. Pass `alwaysOn` for the looping variant. */
  alwaysOn?: boolean;
  /** Multiplier on the glitch animation period (1 = default, larger = slower). */
  speed?: number;
  /** Render the red/cyan text-shadow ghosts. Default true. */
  enableShadows?: boolean;
  className?: string;
}

export function GlitchText({
  children,
  alwaysOn = false,
  speed = 1,
  enableShadows = true,
  className = "",
}: GlitchTextProps) {
  const text = typeof children === "string" ? children : "";
  const style: CSSProperties = {
    "--glitch-after-duration": `${speed * 3}s`,
    "--glitch-before-duration": `${speed * 2}s`,
    "--glitch-after-shadow": enableShadows ? "-5px 0 #ff3a3a" : "none",
    "--glitch-before-shadow": enableShadows ? "5px 0 #00f0ff" : "none",
  } as CSSProperties;
  return (
    <span
      className={`glitch ${alwaysOn ? "" : "glitch--hover"} ${className}`}
      style={style}
      data-text={text}
    >
      {children}
    </span>
  );
}

export default GlitchText;
