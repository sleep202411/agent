"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconExternalLink, IconUser } from "@tabler/icons-react";
import { WorldAssetSelectDialog } from "@/components/storyboard/dialogs/world-asset-select-dialog";
import { dispatchFocusAssetPanel } from "@/src/lib/panel-events";
import { ossUrl, persistValueList } from "./cell-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setActivePanel,
  selectCurrentInstance,
  type Asset,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

export function AssetReferenceCard({
  name,
  imageUrl,
  icon,
  placeholder,
  onClick,
  onOpenPanel,
}: {
  name: string;
  imageUrl: string;
  icon: React.ReactNode;
  placeholder: string;
  onClick: () => void;
  onOpenPanel?: () => void;
}) {
  const t = useTranslations("storyboard");
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-2 py-2 hover:bg-muted/30"
    >
      <div className="relative aspect-square w-full max-w-20 overflow-hidden rounded-lg bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/40">
            {icon}
          </div>
        )}
        {name && onOpenPanel ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPanel();
            }}
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full border border-black/20 bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
            title={t("openSidebarAsset")}
          >
            <IconExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      {name ? (
        <span className="max-w-full truncate text-xs font-medium">{name}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}

export function CharacterCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const items = useAppSelector((s) => selectCurrentInstance(s).characters);
  const [open, setOpen] = useState(false);

  const selected = (cell?.characters as Asset[] | undefined)?.[0];
  const selectedId = selected?.id ? String(selected.id) : undefined;
  const imageUrl = ossUrl(selected?.roleImgPath?.[0]);
  const handleOpenPanel = useCallback(() => {
    if (!selectedId && !selected?.name) return;
    store.dispatch(setActivePanel("characters"));
    window.setTimeout(() => {
      dispatchFocusAssetPanel({
        panel: "characters",
        assetId: selectedId,
        assetName: String(selected?.name ?? ""),
        openEditor: true,
      });
    }, 0);
  }, [selected?.name, selectedId]);

  const handleConfirm = (item: Asset | null) => {
    const normalized = item ? { ...item } : null;
    void persistValueList(shotId, shotColumnId, normalized?.id ? [String(normalized.id)] : [], {
      characters: normalized ? [normalized] : [],
    });
    setOpen(false);
  };

  return (
    <>
      <AssetReferenceCard
        name={String(selected?.name ?? "")}
        imageUrl={imageUrl}
        icon={<IconUser className="size-5" />}
        placeholder={t("selectCharacter")}
        onClick={() => setOpen(true)}
        onOpenPanel={selected ? handleOpenPanel : undefined}
      />
      <WorldAssetSelectDialog
        open={open}
        onOpenChange={setOpen}
        title={t("selectCharacter")}
        kind="character"
        items={items}
        selectedId={selectedId}
        onConfirm={handleConfirm}
      />
    </>
  );
}
