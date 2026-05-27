"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavItems } from "@/lib/navigation";

type AdminShellProps = {
  children: React.ReactNode;
};

export function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-[#0a0a0b] text-white">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-[#262629] bg-[#101012] lg:flex lg:flex-col">
        <div className="border-b border-[#262629] px-5 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-[#E52227] text-sm font-semibold text-white">
              FD
            </span>
            <span>
              <span className="block text-sm font-semibold leading-5">FizzDragon</span>
              <span className="block text-xs text-[#9ca0a8]">Operations Console</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {adminNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                  isActive
                    ? "bg-white text-black"
                    : "text-[#c8cad0] hover:bg-white/[0.06] hover:text-white",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid size-7 place-items-center rounded border text-[10px] font-semibold",
                    isActive
                      ? "border-black/10 bg-black text-white"
                      : "border-white/10 bg-white/[0.04] text-[#9ca0a8]",
                  ].join(" ")}
                >
                  {item.eyebrow}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#262629] p-4">
          <div className="rounded-md border border-[#262629] bg-[#141416] p-3">
            <p className="text-xs font-medium text-white">Internal access</p>
            <p className="mt-1 text-xs leading-5 text-[#9ca0a8]">
              Admin auth will be owned by Nest and Postgres, with 2FA and audit logging.
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-[#262629] bg-[#0a0a0b]/90 backdrop-blur-xl">
          <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-6">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">Platform Operations</p>
              <p className="truncate text-xs text-[#9ca0a8]">
                AI jobs, wallets, campaigns, users, and audit trails
              </p>
            </div>
            <Link
              href="/login"
              className="rounded-md border border-[#262629] px-3 py-2 text-xs font-medium text-[#c8cad0] transition hover:border-white/20 hover:text-white"
            >
              Login shell
            </Link>
          </div>
        </header>

        <main className="px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
