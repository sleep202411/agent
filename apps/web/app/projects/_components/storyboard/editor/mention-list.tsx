"use client";

import { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { MentionItem, MentionType } from "./mention-node";

const typeLabels: Record<MentionType, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  reference: "参考",
};

const typeColors: Record<MentionType, string> = {
  character: "text-primary",
  scene: "text-green-600 dark:text-green-400",
  prop: "text-orange-600 dark:text-orange-400",
  reference: "text-blue-600 dark:text-blue-400",
};

export interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) command(item);
      },
      [items, command]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-md">
          <p className="text-xs text-muted-foreground">无匹配结果</p>
        </div>
      );
    }

    // Group items by type
    const grouped = items.reduce<Record<string, MentionItem[]>>((acc, item) => {
      const key = item.mentionType;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    let globalIndex = 0;

    return (
      <div className="max-h-60 w-56 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-md">
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          方向鍵選擇，Enter/Tab 確認，Esc 關閉
        </p>
        {Object.entries(grouped).map(([type, groupItems]) => (
          <div key={type}>
            <div className="px-2 pb-1 pt-2">
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase",
                  typeColors[type as MentionType]
                )}
              >
                {typeLabels[type as MentionType]}
              </span>
            </div>
            {groupItems.map((item) => {
              const idx = globalIndex++;
              return (
                <button
                  key={`${item.id}-${item.label}`}
                  type="button"
                  onClick={() => selectItem(idx)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    idx === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground hover:bg-accent/50"
                  )}
                >
                  {item.imgUrl && (
                    <img
                      src={item.imgUrl}
                      alt=""
                      className="size-7 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <span className="truncate text-xs">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }
);

MentionList.displayName = "MentionList";
