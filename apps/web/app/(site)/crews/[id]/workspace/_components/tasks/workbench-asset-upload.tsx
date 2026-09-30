"use client";

import { useRef } from "react";
import { IconUpload } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useCrewAssetContext } from "../../_hooks/use-crew-assets";
import { useCrewTransfers } from "../transfers/crew-transfer-center";

export function WorkbenchAssetUpload({ crewId, active }: { crewId: string; active: boolean }) {
  const t = useTranslations("crewTaskProject.workbench");
  const input = useRef<HTMLInputElement>(null);
  const context = useCrewAssetContext(crewId, active);
  const { enqueueAssetFiles } = useCrewTransfers();
  const enabled =
    active &&
    !context.isError &&
    context.data?.capabilities.upload === true &&
    context.data.storageAvailable === true;
  function upload(files: File[]) {
    if (enabled && files.length) enqueueAssetFiles(files, null);
  }
  return (
    <div className="mt-auto pt-6">
      <button
        type="button"
        disabled={!enabled}
        className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 p-4 text-center text-sm hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = enabled ? "copy" : "none";
        }}
        onDrop={(event) => {
          event.preventDefault();
          upload(Array.from(event.dataTransfer.files));
        }}
      >
        <IconUpload className="size-5 text-muted-foreground" />
        <span>{t("dropAssets")}</span>
        <span className="text-xs text-muted-foreground">
          {enabled ? t("browseAssets") : t("uploadUnavailable")}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        disabled={!enabled}
        aria-label={t("dropAssets")}
        onChange={(event) => {
          upload(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
