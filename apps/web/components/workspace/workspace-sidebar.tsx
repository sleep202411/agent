"use client";

import { IconHome2 } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkspaceSidebarItem } from "./workspace-sidebar-item";
import { ThemeToggle } from "@/components/theme-toggle";

const workspaceItems = [
  {
    path: "/studio",
    exact: true,
    label: "Home",
    icon: <IconHome2 className="size-5" />,
  },
];

export function WorkspaceSidebar() {
  const pathname = usePathname() ?? "/";

  const isItemActive = (path: string, exact = false) => {
    if (exact) return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <aside className="relative z-20 flex w-16 shrink-0 flex-col items-center border-r border-border/70 bg-background py-4">
      <Link href="/studio" aria-label="FizzDragon" className="mb-6 block px-2">
        <img src="/logo.png" alt="FizzDragon" className="h-auto w-full max-w-[44px]" />
      </Link>

      <nav className="flex flex-1 flex-col gap-3">
        {workspaceItems.map((item) => (
          <WorkspaceSidebarItem
            key={item.path}
            href={item.path}
            label={item.label}
            icon={item.icon}
            isActive={isItemActive(item.path, item.exact)}
          />
        ))}
      </nav>

      <div className="mt-auto">
        <ThemeToggle />
      </div>
    </aside>
  );
}
