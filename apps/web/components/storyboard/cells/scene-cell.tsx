"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "@/src/i18n/i18n";
import { IconMapPin } from "@tabler/icons-react";
import { WorldAssetSelectDialog } from "@/components/storyboard/dialogs/world-asset-select-dialog";
import { dispatchFocusAssetPanel } from "@/src/lib/panel-events";
import { AssetReferenceCard } from "./character-cell";
import { ossUrl, persistValueList } from "./cell-utils";
import { useAppSelector } from "@/src/store";
import { store } from "@/src/store";
import {
  setActivePanel,
  selectCurrentInstance,
  type Asset,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

export function SceneReferenceCell({
  cell,
  shotId,
  shotColumnId,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
}) {
  const t = useTranslations("storyboard");
  const items = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const [open, setOpen] = useState(false);

  const selected = (cell?.scenes as Asset[] | undefined)?.[0];
  const selectedId = selected?.id ? String(selected.id) : undefined;
  const imageUrl = ossUrl(selected?.sceneImgPath?.[0]);
  const handleOpenPanel = useCallback(() => {
    if (!selectedId && !selected?.name) return;
    store.dispatch(setActivePanel("scenes"));
    window.setTimeout(() => {
      dispatchFocusAssetPanel({
        panel: "scenes",
        assetId: selectedId,
        assetName: String(selected?.name ?? ""),
        openEditor: true,
      });
    }, 0);
  }, [selected?.name, selectedId]);

  const handleConfirm = (item: Asset | null) => {
    const normalized = item ? { ...item } : null;
    void persistValueList(shotId, shotColumnId, normalized?.id ? [String(normalized.id)] : [], {
      scenes: normalized ? [normalized] : [],
    });
    setOpen(false);
  };

  return (
    <>
      <AssetReferenceCard
        name={String(selected?.name ?? "")}
        imageUrl={imageUrl}
        icon={<IconMapPin className="size-5" />}
        placeholder={t("selectScene")}
        onClick={() => setOpen(true)}
        onOpenPanel={selected ? handleOpenPanel : undefined}
      />
      <WorldAssetSelectDialog
        open={open}
        onOpenChange={setOpen}
        title={t("selectScene")}
        kind="scene"
        items={items}
        selectedId={selectedId}
        onConfirm={handleConfirm}
      />
    </>
  );
}
