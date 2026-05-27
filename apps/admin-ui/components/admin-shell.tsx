"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { AdminSiteSelector } from "@/components/admin-site-selector";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  children: React.ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              FD
            </span>
            <span>
              <span className="block text-sm font-semibold leading-5">FizzDragon</span>
              <span className="block text-xs text-muted-foreground">Operations Console</span>
            </span>
          </Link>
        </div>
        <Separator />

        <nav className="flex-1 space-y-1 px-3 py-4">
          {adminNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                      isActive
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span
                      className={cn(
                        "grid size-7 place-items-center rounded border text-[10px] font-semibold",
                        isActive
                          ? "border-background/10 bg-background text-foreground"
                          : "border-border bg-secondary text-muted-foreground"
                      )}
                    >
                      {item.eyebrow}
                    </span>
                    {item.label}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <ShieldCheckIcon className="size-4 text-primary" />
              Internal access
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Admin auth will be owned by Nest and Postgres, with 2FA and audit logging.
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-6">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">Platform Operations</p>
              <p className="truncate text-xs text-muted-foreground">
                AI jobs, wallets, campaigns, users, and audit trails
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <AdminSiteSelector />
              <Button asChild variant="outline" size="sm">
                <Link href="/login">Login shell</Link>
              </Button>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
