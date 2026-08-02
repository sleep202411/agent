"use client";

import Link from "next/link";
import {
  IconCircleCheck,
  IconDownload,
  IconFolderOpen,
  IconMusic,
  IconX,
} from "@tabler/icons-react";
import type { ConversationAttachmentPayload } from "@repo/shared/conversation";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { AttachmentVisual } from "./attachment-visual";

export type CrewChatContext = { kind: "asset"; attachment: ConversationAttachmentPayload };

export function CrewChatContextPanel({
  crewId,
  context,
  onClose,
}: {
  crewId: string;
  context: CrewChatContext;
  onClose: () => void;
}) {
  const tm = useTranslations("messages");
  const locale = useLocale() as Locale;

  return (
    <aside
      aria-label={tm("contextPanelLabel")}
      className="hidden w-[292px] shrink-0 flex-col border-l border-white/[0.065] bg-[#0a0c0f] min-[980px]:flex"
    >
      <div className="flex h-[58px] shrink-0 items-center gap-2 border-b border-white/[0.065] px-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5e636d]">
            {tm("assetContextLabel")}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-[#e8e9ec]">
            {context.attachment.name}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tm("closeContextPanel")}
          className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <AssetPreview attachment={context.attachment} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-400/[0.07] px-3 py-2 text-[10px] font-medium text-emerald-300">
          <IconCircleCheck className="size-3.5 shrink-0" />
          {tm("savedToCrewAssets")}
        </div>
        <ContextSection title={tm("details")}>
          <ContextRow label={tm("fileType")}>{context.attachment.contentType}</ContextRow>
          <ContextRow label={tm("fileSize")}>
            {context.attachment.sizeBytes == null ? "—" : formatBytes(context.attachment.sizeBytes)}
          </ContextRow>
          <ContextRow label={tm("assetKind")}>
            {tm(`mediaKind.${context.attachment.mediaKind}`)}
          </ContextRow>
        </ContextSection>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-white/[0.065] p-3">
        <a
          href={assetContentHref(context.attachment)}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/[0.055] text-[10px] font-semibold text-[#c6cad1] transition-colors hover:bg-white/[0.09] hover:text-white"
        >
          <IconDownload className="size-3.5" />
          {tm("openOriginal")}
        </a>
        <Link
          href={localizePath(
            `/crews/${crewId}/workspace?tab=assets&asset=${context.attachment.assetNodeId}`,
            locale
          )}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/[0.085] text-[10px] font-semibold text-[#eceef2] transition-colors hover:bg-white/[0.12]"
        >
          <IconFolderOpen className="size-3.5" />
          {tm("openInCrewAssets")}
        </Link>
      </div>
    </aside>
  );
}

function AssetPreview({ attachment }: { attachment: ConversationAttachmentPayload }) {
  const href = assetContentHref(attachment);
  return (
    <div className="border-b border-white/[0.065] bg-black/20 p-3">
      {attachment.mediaKind === "audio" ? (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-5 rounded-lg bg-black/30 px-4">
          <span className="grid size-16 place-items-center rounded-xl bg-white/[0.06] text-[#858b94]">
            <IconMusic className="size-7" />
          </span>
          <audio src={href} controls preload="metadata" className="w-full" />
        </div>
      ) : attachment.mediaKind === "video" ? (
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-black/30">
          <video src={href} controls preload="metadata" className="max-h-full max-w-full" />
        </div>
      ) : (
        <AttachmentVisual
          name={attachment.name}
          mediaKind={attachment.mediaKind}
          src={href}
          className="aspect-[4/3] w-full rounded-lg bg-black/30"
          mediaClassName="object-contain"
        />
      )}
    </div>
  );
}

function ContextSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#5f646d]">
        {title}
      </h3>
      <dl className="mt-2 divide-y divide-white/[0.05]">{children}</dl>
    </section>
  );
}

function ContextRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3 py-2.5 text-[10px]">
      <dt className="text-[#626872]">{label}</dt>
      <dd className="min-w-0 break-words text-[#c6c9cf]">{children}</dd>
    </div>
  );
}

function assetContentHref(attachment: ConversationAttachmentPayload): string {
  return `/aurora/media/assets/${encodeURIComponent(attachment.mediaAssetId)}/content`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
