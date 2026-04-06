"use client";

import {
  IconFoldersFilled,
  IconSubtask,
  IconPhotoFilled,
  IconSettingsFilled,
  IconFlame,
} from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { WorkspaceSidebarItem } from "./workspace-sidebar-item";
import { ThemeToggle } from "@/components/theme-toggle";

const workspaceItems = [
  {
    path: "/projects",
    label: "Projects",
    icon: <IconFoldersFilled className="size-5" />,
  },
  {
    path: "/tasks",
    label: "Tasks",
    icon: <IconSubtask className="size-5" />,
  },
  {
    path: "/assets",
    label: "Assets",
    icon: <IconPhotoFilled className="size-5" />,
  },
  {
    path: "/settings",
    label: "Settings",
    icon: <IconSettingsFilled className="size-5" />,
  },
];

export function WorkspaceSidebar() {
  const pathname = usePathname();
  const locale = useLocale();

  const isItemActive = (path: string) => {
    const fullPath = `/${locale}${path}`;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  return (
    <aside className="flex w-16 shrink-0 flex-col items-center border-r border-border/70 bg-background py-4">
      <div className="mb-4">
        <IconFlame className="size-7 text-primary" />
      </div>

      <nav className="flex flex-1 flex-col gap-3">
        {workspaceItems.map((item) => (
          <WorkspaceSidebarItem
            key={item.path}
            href={`/${locale}${item.path}`}
            label={item.label}
            icon={item.icon}
            isActive={isItemActive(item.path)}
          />
        ))}
      </nav>

      {/* TODO: 暂时隐藏主题切换 */}
      {/* <div className="mt-auto">
        <ThemeToggle />
      </div> */}
    </aside>
  );
}
