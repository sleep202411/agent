import { cn } from "@/lib/utils";

/**
 * Shared primitives for the standalone Settings surface. Dark, monochrome,
 * borderless per DESIGN.md — separation by tone step (background → card →
 * secondary), never outlines.
 */

export function PageHeader({
  title,
  badge,
  subtitle,
  actions,
}: {
  title: string;
  badge?: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function TeamBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/** A titled card panel (the workhorse section container). */
export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-2xl bg-card", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
          </div>
          {action}
        </div>
      )}
      <div className={cn("px-5 pb-5", title ? "pt-1" : "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Honest empty state — the sanctioned representation for absent backends. */
export function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-card px-5 py-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Inset hairline divider — the one permitted border (per DESIGN.md rule 4). */
export function RowDivider() {
  return <div className="mx-5 h-px bg-border" />;
}

/** Workspace/account avatar: the image when `src` is set, else an initial letter. */
export function LetterAvatar({
  name,
  src,
  size = "size-8",
  className,
}: {
  name: string;
  src?: string | null;
  size?: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- icon/avatar URL (preset/uploaded)
      <img src={src} alt="" className={cn("shrink-0 rounded-full object-cover", size, className)} />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold",
        size,
        className
      )}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
