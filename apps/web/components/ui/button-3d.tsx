import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { IconLoader2 } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

/**
 * Button3D — a chunky, playful 3D "push" button (Duolingo-style).
 *
 * The look = a flat face + a hard bottom edge (`shadow: 0 5px 0 <darker>`,
 * zero blur, not a drop shadow); on `:active` the button sinks flush into that
 * edge (`translate-y` by the edge height + edge → 0). Distinct from the app's
 * utilitarian `Button` (small, flat, 1px press) — use this for hero CTAs where
 * the press should feel satisfying (e.g. 开始游玩).
 *
 * antd-like API: `color` / `size` / `block` / `icon` / `loading` / `asChild`.
 */
const ROUNDED_FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif";

const button3dVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-2xl border-0 font-extrabold tracking-[0.3px] text-white transition duration-100 ease-[cubic-bezier(0.3,0.7,0.4,1)] outline-none select-none hover:brightness-105 active:translate-y-1.25 focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      color: {
        primary: "bg-[#ea2804] shadow-[0_5px_0_#b31d00] active:shadow-[0_0_0_#b31d00]",
        success: "bg-[#2ea043] shadow-[0_5px_0_#227d33] active:shadow-[0_0_0_#227d33]",
        danger: "bg-[#e5484d] shadow-[0_5px_0_#bd383c] active:shadow-[0_0_0_#bd383c]",
      },
      size: {
        sm: "h-10 px-4 text-sm [&_svg:not([class*='size-'])]:size-4",
        md: "h-12 px-5 text-[15px] [&_svg:not([class*='size-'])]:size-5",
        lg: "h-14 px-6 text-base [&_svg:not([class*='size-'])]:size-5",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { color: "primary", size: "lg", block: false },
  }
);

type Button3DProps = React.ComponentProps<"button"> &
  VariantProps<typeof button3dVariants> & {
    asChild?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    iconPosition?: "start" | "end";
  };

function Button3D({
  className,
  color,
  size,
  block,
  asChild = false,
  loading = false,
  icon,
  iconPosition = "start",
  disabled,
  style,
  children,
  ...props
}: Button3DProps) {
  const mergedStyle: React.CSSProperties = { fontFamily: ROUNDED_FONT, ...style };
  const classes = cn(button3dVariants({ color, size, block }), className);

  if (asChild) {
    return (
      <Slot.Root data-slot="button-3d" style={mergedStyle} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  const iconElement = loading ? <IconLoader2 className="animate-spin" /> : (icon ?? null);

  return (
    <button
      type="button"
      data-slot="button-3d"
      disabled={disabled || loading}
      style={mergedStyle}
      className={classes}
      {...props}
    >
      {iconElement && iconPosition === "start" && iconElement}
      {children}
      {iconElement && iconPosition === "end" && iconElement}
    </button>
  );
}

export { Button3D, button3dVariants };
export type { Button3DProps };
