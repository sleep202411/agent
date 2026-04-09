"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconClock } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { getCellDisplayValue, persistTextCell } from "./cell-utils";
import type { ShotValue } from "@/src/store/slices/projectSlice";

export function DurationCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const [editing, setEditing] = useState(false);
  const display = getCellDisplayValue(cell);
  const [draft, setDraft] = useState(display);

  return editing ? (
    <div className="flex h-full items-center justify-center px-3">
      <Input
        autoFocus
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== display) {
            void persistTextCell(shotId, shotColumnId, draft);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(display);
            setEditing(false);
          }
          if (event.key === "Enter") {
            setEditing(false);
            if (draft !== display) {
              void persistTextCell(shotId, shotColumnId, draft);
            }
          }
        }}
        className="h-8 text-center"
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className="flex h-full w-full items-center justify-center gap-1 px-3 text-xs text-foreground hover:bg-muted/30"
    >
      <IconClock className="size-3.5 text-muted-foreground" />
      {display ? (
        `${display} s`
      ) : (
        <span className="text-muted-foreground">{t("fillDuration")}</span>
      )}
    </button>
  );
}
