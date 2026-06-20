import { cn } from "@/lib/utils";
import { SectionHeading } from "@/components/ui/section-heading";
import { FrostedPanel } from "@/components/ui/frosted-panel";

/**
 * Shared primitives for the standalone Settings surface. Dark, monochrome,
 * borderless per DESIGN.md — separation comes from the frosted rim-light
 * (FrostedPanel) and tone steps, never outlines. The page header builds on the
 * shared SectionHeading; panels/stat tiles build on the shared FrostedPanel.
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
    <SectionHeading
      as="h1"
      title={
        badge ? (
          <span className="flex items-center gap-2">
            {title}
            {badge}
          </span>
        ) : (
          title
        )
      }
      subtitle={subtitle}
      action={actions}
    />
  );
}

export function TeamBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/** A titled section panel (the workhorse container) — a borderless FrostedPanel. */
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
    <FrostedPanel className={className}>
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
    </FrostedPanel>
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
      <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground">
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
    <FrostedPanel className="px-5 py-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </FrostedPanel>
  );
}

/** Inset divider — a low-alpha tone step, not a hard border (DESIGN.md rule 4). */
export function RowDivider() {
  return <div className="mx-5 h-px bg-white/[0.06]" />;
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
        "flex shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold",
        size,
        className
      )}
    >
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}
