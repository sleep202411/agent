import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { IconLoader2 } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        solid: "",
        outline: "bg-transparent",
        soft: "",
        ghost: "bg-transparent",
        link: "bg-transparent underline-offset-4 hover:underline",
        dashed: "border-dashed bg-transparent",
      },
      color: {
        primary: "",
        destructive: "",
        success: "",
        warning: "",
        muted: "",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    compoundVariants: [
      // ─── Solid ────────────────────────────────────
      {
        variant: "solid",
        color: "primary",
        className:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
      },
      {
        variant: "solid",
        color: "destructive",
        className: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
      },
      {
        variant: "solid",
        color: "success",
        className: "bg-success text-success-foreground hover:bg-success/80",
      },
      {
        variant: "solid",
        color: "warning",
        className: "bg-warning text-warning-foreground hover:bg-warning/80",
      },
      {
        variant: "solid",
        color: "muted",
        className: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },

      // ─── Outline ──────────────────────────────────
      {
        variant: "outline",
        color: "primary",
        className:
          "border-primary/40 text-primary hover:text-primary-hover hover:border-primary-hover/40 hover:bg-primary-hover/10 active:text-primary-pressed",
      },
      {
        variant: "outline",
        color: "destructive",
        className: "border-destructive/40 text-destructive hover:bg-destructive/10",
      },
      {
        variant: "outline",
        color: "success",
        className: "border-success/40 text-success hover:bg-success/10",
      },
      {
        variant: "outline",
        color: "warning",
        className: "border-warning/40 text-warning hover:bg-warning/10",
      },
      {
        variant: "outline",
        color: "muted",
        className:
          "border-border text-foreground hover:bg-muted hover:text-foreground dark:border-input",
      },

      // ─── Soft ─────────────────────────────────────
      {
        variant: "soft",
        color: "primary",
        className:
          "bg-primary/10 text-primary hover:bg-primary-hover/15 hover:text-primary-hover active:bg-primary-pressed/20",
      },
      {
        variant: "soft",
        color: "destructive",
        className: "bg-destructive/10 text-destructive hover:bg-destructive/20",
      },
      {
        variant: "soft",
        color: "success",
        className: "bg-success/10 text-success hover:bg-success/20",
      },
      {
        variant: "soft",
        color: "warning",
        className: "bg-warning/10 text-warning hover:bg-warning/20",
      },
      {
        variant: "soft",
        color: "muted",
        className: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      },

      // ─── Ghost ────────────────────────────────────
      {
        variant: "ghost",
        color: "primary",
        className: "text-primary hover:text-primary-hover hover:bg-primary-hover/10",
      },
      {
        variant: "ghost",
        color: "destructive",
        className: "text-destructive hover:bg-destructive/10",
      },
      { variant: "ghost", color: "success", className: "text-success hover:bg-success/10" },
      { variant: "ghost", color: "warning", className: "text-warning hover:bg-warning/10" },
      {
        variant: "ghost",
        color: "muted",
        className: "text-muted-foreground hover:bg-muted hover:text-foreground",
      },

      // ─── Link ─────────────────────────────────────
      { variant: "link", color: "primary", className: "text-primary" },
      { variant: "link", color: "destructive", className: "text-destructive" },
      { variant: "link", color: "success", className: "text-success" },
      { variant: "link", color: "warning", className: "text-warning" },
      { variant: "link", color: "muted", className: "text-muted-foreground" },

      // ─── Dashed ───────────────────────────────────
      {
        variant: "dashed",
        color: "primary",
        className:
          "border-primary/40 text-primary hover:text-primary-hover hover:border-primary-hover/40 hover:bg-primary-hover/10",
      },
      {
        variant: "dashed",
        color: "destructive",
        className: "border-destructive/40 text-destructive hover:bg-destructive/10",
      },
      {
        variant: "dashed",
        color: "success",
        className: "border-success/40 text-success hover:bg-success/10",
      },
      {
        variant: "dashed",
        color: "warning",
        className: "border-warning/40 text-warning hover:bg-warning/10",
      },
      {
        variant: "dashed",
        color: "muted",
        className: "border-border text-foreground hover:bg-muted dark:border-input",
      },
    ],
    defaultVariants: {
      variant: "solid",
      color: "primary",
      size: "default",
    },
  }
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
    iconPosition?: "start" | "end";
  };

function Button({
  className,
  variant = "solid",
  color = "primary",
  size = "default",
  asChild = false,
  loading = false,
  icon,
  iconPosition = "start",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const isIconOnly = size?.toString().startsWith("icon");

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-color={color}
        data-size={size}
        className={cn(buttonVariants({ variant, color, size, className }))}
        {...props}
      >
        {children}
      </Slot.Root>
    );
  }

  const iconElement = loading ? <IconLoader2 className="animate-spin" /> : icon ? icon : null;

  return (
    <button
      type="button"
      data-slot="button"
      data-variant={variant}
      data-color={color}
      data-size={size}
      disabled={isDisabled}
      className={cn(buttonVariants({ variant, color, size, className }))}
      {...props}
    >
      {isIconOnly ? (
        (iconElement ?? children)
      ) : (
        <>
          {iconElement && iconPosition === "start" && iconElement}
          {children}
          {iconElement && iconPosition === "end" && iconElement}
        </>
      )}
    </button>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
