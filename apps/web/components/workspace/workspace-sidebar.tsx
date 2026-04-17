"use client";

import {
  IconHome2,
  IconFoldersFilled,
  IconSubtask,
  IconPhotoFilled,
  IconSettingsFilled,
  IconFlame,
} from "@tabler/icons-react";
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
  {
    path: "/studio/projects",
    label: "Projects",
    icon: <IconFoldersFilled className="size-5" />,
  },
  {
    path: "/studio/tasks",
    label: "Tasks",
    icon: <IconSubtask className="size-5" />,
  },
  {
    path: "/studio/assets",
    label: "Assets",
    icon: <IconPhotoFilled className="size-5" />,
  },
  {
    path: "/studio/settings",
    label: "Settings",
    icon: <IconSettingsFilled className="size-5" />,
  },
];

export function WorkspaceSidebar() {
  const pathname = usePathname() ?? "/";

  const isItemActive = (path: string, exact = false) => {
    if (exact) return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center border-r border-border/70 bg-background py-4">
      <Link href="/studio" aria-label="Studio home" className="mb-4">
        <IconFlame className="size-7 text-primary" />
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
