"use client";
import { useState } from "react";
import Link from "next/link";
import { IconFile, IconFolder } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { useCrewAssets, type CrewAssetNodeDTO } from "../../_hooks/use-crew-assets";

export function WorkbenchAssetFolder({
  crewId,
  asset,
  active,
  depth = 0,
}: {
  crewId: string;
  asset: CrewAssetNodeDTO;
  active: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("crewTaskProject.workbench");
  const isFolder = asset.kind === "folder";
  const children = useCrewAssets(
    crewId,
    { source: "all", parentId: asset.id, sort: "name" },
    active && isFolder && open && depth < 8
  );
  if (!isFolder || depth >= 8)
    return (
      <Link
        className="flex items-center gap-2 rounded py-2 hover:bg-white/5"
        href={`?crew=${encodeURIComponent(crewId)}&tab=assets&asset=${encodeURIComponent(asset.id)}`}
      >
        <IconFile className="size-4 shrink-0 text-blue-400" />
        <span className="truncate">{asset.name}</span>
      </Link>
    );
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 py-2 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconFolder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{asset.name}</span>
      </button>
      {open ? (
        <div className="ml-2 border-l border-white/10 pl-3">
          <Link
            className="text-xs text-muted-foreground underline"
            href={`?crew=${encodeURIComponent(crewId)}&tab=assets&asset=${encodeURIComponent(asset.id)}`}
          >
            {t("manageAssets")}
          </Link>
          {children.isLoading ? <p className="py-2 text-xs">{t("loading")}</p> : null}
          {children.isError ? (
            <p role="alert" className="text-xs text-destructive">
              {children.error.message}
            </p>
          ) : (
            children.data?.items.map((child) => (
              <WorkbenchAssetFolder
                key={child.id}
                crewId={crewId}
                asset={child}
                active={active && open}
                depth={depth + 1}
              />
            ))
          )}
          {children.hasNextPage || children.isError ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={children.isFetching}
              onClick={() =>
                void (children.isError ? children.refetch() : children.fetchNextPage())
              }
            >
              {children.isError ? t("retry") : t("more")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
