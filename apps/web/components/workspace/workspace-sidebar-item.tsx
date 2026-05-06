import Link from "next/link";
import { cn } from "@/lib/utils";

type WorkspaceSidebarItemProps = Readonly<{
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
}>;

/**
 * Icon-only nav button styled as a circular glass pill — matches the
 * studio sidebar reference (OiiOii / Liblib studio): no labels, no
 * heavy chrome. Label sits in `aria-label` + native tooltip so screen
 * readers + hover discovery still work.
 *
 * Active state: filled glass + soft ring glow. Inactive: dim icon, no
 * background until hover. Sized at 44px to read as a tap target.
 */
export function WorkspaceSidebarItem({ href, label, icon, isActive }: WorkspaceSidebarItemProps) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-all",
        isActive
          ? "bg-white/10 text-foreground ring-1 ring-white/15 shadow-[0_0_20px_-6px_rgb(255_255_255/0.2)]"
          : "text-muted-foreground/70 hover:bg-white/5 hover:text-foreground"
      )}
    >
      {icon}
    </Link>
  );
}
