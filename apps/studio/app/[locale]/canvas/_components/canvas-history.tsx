"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { IconHistory, IconX } from "@tabler/icons-react";
import { useDocumentVersions } from "@/lib/collab/use-versions";
import type { VersionDto, VersionSource } from "@/lib/collab/versions-api";
import type { DocumentProvider } from "@/lib/collab/document-provider";
import { useUsersByIds, type PublicUser } from "@/lib/users-api";

interface CanvasHistoryProps {
  documentId: string | null;
  provider: DocumentProvider | null;
  onClose: () => void;
}

/** Sources surfaced in the activity feed; autosave + system are background noise. */
const ACTIVITY_SOURCES: ReadonlySet<VersionSource> = new Set(["manual", "ai", "import"]);

/** Friendly action label per surfaced source. */
const ACTION_KEY: Record<"manual" | "ai" | "import", string> = {
  ai: "activity.actions.generated",
  manual: "activity.actions.checkpoint",
  import: "activity.actions.imported",
};

function relativeTime(iso: string, t: ReturnType<typeof useTranslations>): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  return t("time.daysAgo", { count: Math.floor(hours / 24) });
}

/**
 * Canvas activity log — a read-only feed of when · who · what. Each entry is a
 * surfaced document version (AI generation, manual checkpoint, import); autosave
 * and system noise is filtered out. There is no restore: it is purely a record.
 * Real-time list via {@link useDocumentVersions}; authors resolved by id.
 */
export function CanvasHistory({ documentId, provider, onClose }: CanvasHistoryProps) {
  const t = useTranslations("canvasCollab");
  const tc = useTranslations("common");
  const { versions, loading } = useDocumentVersions(documentId, provider);

  const entries = useMemo(
    () => versions.filter((version) => ACTIVITY_SOURCES.has(version.source)),
    [versions]
  );
  const authors = useUsersByIds(useMemo(() => entries.map((e) => e.createdById), [entries]));

  return (
    <div className="absolute top-0 right-0 z-30 flex h-full w-[380px] flex-col bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4 py-3">
        <IconHistory className="size-4.5 text-white/80" stroke={1.8} />
        <span className="flex-1 text-sm font-semibold text-foreground">{t("activity.title")}</span>
        <button
          type="button"
          aria-label={tc("close")}
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconX className="size-4.5" stroke={1.8} />
        </button>
      </div>
      <div className="h-px bg-white/10" />

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{tc("loading")}</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {t("activity.empty")}
          </p>
        ) : (
          entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              author={authors.get(entry.createdById)}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ActivityRow({
  entry,
  author,
  t,
}: {
  entry: VersionDto;
  author: PublicUser | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  const name = author?.nickname?.trim() || t("activity.memberFallback");
  // manual/ai/import are guaranteed by the ACTIVITY_SOURCES filter.
  const action = t(ACTION_KEY[entry.source as "manual" | "ai" | "import"]);
  const detail = entry.label?.trim() || entry.title?.trim() || null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
      <AuthorAvatar author={author} name={name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          <span className="font-medium">{name}</span>
          <span className="text-white/70"> {action}</span>
          {detail && <span className="text-white/70"> · {detail}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {relativeTime(entry.createdAt, t)}
        </div>
      </div>
    </div>
  );
}

function AuthorAvatar({ author, name }: { author: PublicUser | undefined; name: string }) {
  if (author?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
      <img src={author.avatar} alt="" className="size-7 shrink-0 rounded-full object-cover" />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
