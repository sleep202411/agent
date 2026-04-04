import Link from "next/link";
import { cn } from "@/lib/utils";

type WorkspaceSidebarItemProps = Readonly<{
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
}>;

export function WorkspaceSidebarItem({ href, label, icon, isActive }: WorkspaceSidebarItemProps) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className="flex flex-col items-center transition-colors"
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
        )}
      >
        {icon}
      </div>
      <p
        className={cn(
          "m-0 p-0 text-center text-[10px] leading-5",
          isActive ? "text-primary" : "text-muted-foreground"
        )}
      >
        {label}
      </p>
    </Link>
  );
}
