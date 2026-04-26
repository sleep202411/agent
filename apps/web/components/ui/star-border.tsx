"use client";

/**
 * StarBorder — wraps any element with a pair of rotating radial-gradient
 * blobs masked into a thin border, giving a sweeping starlight rim.
 * Ported from react-bits (MIT + Commons Clause).
 */

import type { CSSProperties, ElementType, ReactNode } from "react";
import "./star-border.css";

export interface StarBorderProps {
  as?: ElementType;
  className?: string;
  /** Glow colour for the rotating rim (CSS colour). */
  color?: string;
  /** CSS time string for one full rim sweep. */
  speed?: string;
  /** Outer rim thickness in px (top/bottom padding). */
  thickness?: number;
  children?: ReactNode;
  style?: CSSProperties;
  [key: string]: unknown;
}

export function StarBorder({
  as,
  className = "",
  color = "white",
  speed = "6s",
  thickness = 1,
  children,
  style,
  ...rest
}: StarBorderProps) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={`star-border-container ${className}`}
      style={{ padding: `${thickness}px 0`, ...style }}
      {...rest}
    >
      <div
        className="star-border-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div
        className="star-border-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div className="star-border-inner">{children}</div>
    </Tag>
  );
}

export default StarBorder;
