"use client";

import { IconLayoutGrid, IconList } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { selectCurrentInstance, setStoryboardViewMode } from "@/src/store/slices/projectSlice";

/**
 * Two-tab pill for switching the storyboard page between the virtualized
 * table view ("list") and the per-row card view ("card"). State lives in
 * projectSlice so each project remembers its own preference — swapping
 * projects shouldn't force a re-pick, and swapping view modes shouldn't
 * leak across projects.
 */
export function StoryboardViewModeToggle() {
  const t = useTranslations("storyboard");
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => selectCurrentInstance(s).storyboardViewMode);

  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
      <ToggleButton
        active={mode === "list"}
        onClick={() => dispatch(setStoryboardViewMode("list"))}
        icon={<IconList className="size-3.5" />}
      >
        {t("viewList")}
      </ToggleButton>
      <ToggleButton
        active={mode === "card"}
        onClick={() => dispatch(setStoryboardViewMode("card"))}
        icon={<IconLayoutGrid className="size-3.5" />}
      >
        {t("viewCard")}
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
    </button>
  );
}
