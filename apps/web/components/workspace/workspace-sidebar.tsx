"use client";

import { IconFolder, IconHome2 } from "@tabler/icons-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { WorkspaceSidebarItem } from "./workspace-sidebar-item";

/**
 * Studio left rail — fixed-positioned floating pill anchored to the
 * left edge of the viewport, vertically centered. Doesn't reserve flow
 * space, so page layouts don't have to pad around it.
 */
export function WorkspaceSidebar() {
  const t = useTranslations("sidebar");
  const pathname = usePathname() ?? "/";

  const items = [
    {
      path: "/art-studio",
      exact: true,
      label: t("home"),
      icon: <IconHome2 className="size-5" />,
    },
    {
      path: "/art-studio/projects",
      exact: false,
      label: t("projects"),
      icon: <IconFolder className="size-5" />,
    },
  ];

  const isItemActive = (path: string, exact = false) => {
    if (exact) return pathname === path;
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <aside className="fixed left-3 top-1/2 z-20 -translate-y-1/2">
      <div
        className={cn(
          "flex flex-col items-center gap-1 rounded-full p-1.5",
          "bg-white/5 backdrop-blur-md ring-1 ring-white/10"
        )}
      >
        {items.map((item) => (
          <WorkspaceSidebarItem
            key={item.path}
            href={item.path}
            label={item.label}
            icon={item.icon}
            isActive={isItemActive(item.path, item.exact)}
          />
        ))}
      </div>
    </aside>
  );
}
