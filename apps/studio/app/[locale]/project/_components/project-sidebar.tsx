"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconArrowLeft, IconAsset, IconBook2, IconChevronLeft } from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { cn } from "@/lib/utils";

/**
 * Project-level left sidebar — a thin vertical rail of navigation icons
 * (collapsed) or icon+label rows (expanded), modelled on imagine.art's
 * sidebar. Sits at the far-left edge of the project shell's body, below the
 * header. Fixed width; never pushes (it's always present).
 *
 */
export function ProjectSidebar() {
  const t = useTranslations("project");
  const [expanded, setExpanded] = useState(false);
  const assetsOpen = useProjectUIStore((s) => s.assetsOpen);
  const openAssets = useProjectUIStore((s) => s.openAssets);
  const closeAssets = useProjectUIStore((s) => s.closeAssets);
  const sectionsOpen = useProjectUIStore((s) => s.sectionsOpen);
  const toggleSections = useProjectUIStore((s) => s.toggleSections);

  const items = [
    {
      icon: IconAsset,
      label: t("sidebar.assets"),
      active: assetsOpen,
      onClick: () => (assetsOpen ? closeAssets() : openAssets()),
    },
    {
      icon: IconBook2,
      label: t("sidebar.chapters"),
      active: sectionsOpen,
      onClick: toggleSections,
    },
  ];

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-white/[0.06] bg-popover/40 transition-[width] duration-200",
        expanded ? "w-48" : "w-14"
      )}
    >
      {/* Back to projects — at the very top. */}
      <div className="p-2">
        <Link
          href="/projects"
          aria-label={t("backToProjects")}
          className={cn(
            "flex items-center gap-3 rounded-xl text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white",
            expanded ? "px-3 py-2" : "justify-center p-2.5"
          )}
        >
          <IconArrowLeft className="size-5 shrink-0" stroke={1.7} />
          {expanded && <span className="text-xs font-medium">{t("backToProjects")}</span>}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2">
        {items.map(({ icon: Icon, label, active, onClick }) => (
          <button
            key={label}
            type="button"
            title={label}
            onClick={onClick}
            className={cn(
              "flex items-center gap-3 rounded-xl transition-colors",
              expanded ? "px-3 py-2" : "justify-center p-2.5",
              active
                ? "bg-white/[0.1] text-white"
                : "text-white/60 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            <Icon className="size-5 shrink-0" stroke={1.7} />
            {expanded && <span className="truncate text-xs font-medium">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse / expand toggle at the bottom. */}
      <div className="p-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? t("sidebar.collapse") : t("sidebar.expand")}
          className={cn(
            "flex items-center gap-3 rounded-xl text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white",
            expanded ? "px-3 py-2" : "justify-center p-2.5"
          )}
        >
          <IconChevronLeft
            className={cn("size-5 shrink-0 transition-transform", !expanded && "rotate-180")}
            stroke={1.7}
          />
          {expanded && <span className="text-xs font-medium">{t("sidebar.collapse")}</span>}
        </button>
      </div>
    </div>
  );
}
