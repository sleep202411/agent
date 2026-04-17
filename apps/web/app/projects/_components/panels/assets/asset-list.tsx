"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AssetCard } from "./asset-card";
import { type AssetListItem, formatDateLabel, getAssetKey } from "./asset-utils";

interface AssetGroup {
  date: string;
  dateLabel: string;
  timestamp: number;
  items: AssetListItem[];
}

interface AssetListProps {
  groups: AssetGroup[];
  selectedIds?: Set<string>;
  deletingIds?: Set<string>;
  selectable?: boolean;
  columns?: number;
  hasMore?: boolean;
  loading?: boolean;
  onSelect?: (asset: AssetListItem) => void;
  onClick?: (asset: AssetListItem) => void;
  onLoadMore?: () => void;
}

export function AssetList({
  groups,
  selectedIds,
  deletingIds,
  selectable = true,
  columns = 3,
  hasMore,
  loading,
  onSelect,
  onClick,
  onLoadMore,
}: AssetListProps) {
  const tc = useTranslations("common");

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.date}>
          <div className="mb-2 flex items-center gap-3">
            <div className="text-xs font-medium text-muted-foreground">{group.dateLabel}</div>
            <div className="h-px flex-1 bg-border/60" />
          </div>

          <div
            className={cn(
              "grid gap-2",
              columns === 3 && "grid-cols-3",
              columns === 4 && "grid-cols-4",
              columns === 5 && "grid-cols-5"
            )}
          >
            {group.items.map((asset) => {
              const key = getAssetKey(asset);
              return (
                <AssetCard
                  key={key}
                  asset={asset}
                  selected={selectedIds?.has(key)}
                  deleting={deletingIds?.has(key)}
                  selectable={selectable}
                  onSelect={() => onSelect?.(asset)}
                  onClick={() => onClick?.(asset)}
                />
              );
            })}
          </div>
        </section>
      ))}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button variant="outline" color="muted" size="sm" onClick={onLoadMore}>
            {loading && <IconLoader2 className="size-3.5 animate-spin" />}
            {tc("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function groupAssets(assets: AssetListItem[]): AssetGroup[] {
  const groups = new Map<string, AssetGroup>();

  for (const asset of assets) {
    const rawDate = asset.createTime ? new Date(asset.createTime) : new Date();
    const normalized = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
    const date = `${normalized.getFullYear()}-${normalized.getMonth() + 1}-${normalized.getDate()}`;
    const current = groups.get(date) ?? {
      date,
      dateLabel: formatDateLabel(asset.createTime),
      timestamp: normalized.getTime(),
      items: [],
    };
    current.items.push(asset);
    groups.set(date, current);
  }

  return Array.from(groups.values()).sort((a, b) => b.timestamp - a.timestamp);
}
