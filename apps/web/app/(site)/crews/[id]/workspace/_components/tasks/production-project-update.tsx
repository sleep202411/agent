"use client";

import { useRef, useState } from "react";
import type { LookupUserDTO } from "@repo/shared/users";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCheck,
  IconCircleCheck,
  IconCube,
  IconFilePlus,
  IconLoader2,
  IconTag,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useCreateCrewProductionActivity,
  type CrewProductionActivityDTO,
  type CrewProductionDocument,
  type CrewProductionUpdateDTO,
  type CrewProductionUpdateHealth,
} from "@/app/(site)/crews/_hooks/use-crew";
import { UserAvatar } from "@/components/user-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

import {
  EMPTY_PRODUCTION_ACTIVITY_DOCUMENT,
  ProductionActivityEditor,
  ProductionActivityRichText,
} from "./production-activity-editor";

const HEALTHS: CrewProductionUpdateHealth[] = ["on_track", "at_risk", "off_track"];

export function ProductionActivityComposer({
  crewId,
  canManage,
  startDate,
  projectCreatedAt,
  latestUpdate,
  progress,
}: {
  crewId: string;
  viewerUserId?: string;
  canManage: boolean;
  startDate: string | null;
  projectCreatedAt: string;
  latestUpdate: CrewProductionUpdateDTO | null;
  progress: number;
}) {
  const t = useTranslations("crewProduction");
  const commonT = useTranslations("common");
  const locale = useLocale();
  const createActivity = useCreateCrewProductionActivity(crewId);
  const [mode, setMode] = useState<"comment" | "update">(canManage ? "update" : "comment");
  const [health, setHealth] = useState<CrewProductionUpdateHealth>("on_track");
  const [content, setContent] = useState<CrewProductionDocument>(
    EMPTY_PRODUCTION_ACTIVITY_DOCUMENT
  );
  const [plainText, setPlainText] = useState("");
  const [healthOpen, setHealthOpen] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);

  const draftRevision = useRef(0);
  const posting = useRef(false);

  const clearComposer = () => {
    draftRevision.current += 1;
    setContent(EMPTY_PRODUCTION_ACTIVITY_DOCUMENT);
    setPlainText("");
  };

  const submit = async () => {
    if (!plainText || posting.current) return;
    posting.current = true;
    const submittedRevision = draftRevision.current;
    try {
      await createActivity.mutateAsync(
        mode === "comment"
          ? { kind: "comment", content }
          : { kind: "update", health, content, progress }
      );
      if (draftRevision.current === submittedRevision) clearComposer();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("activity.postFailed"));
    } finally {
      posting.current = false;
    }
  };

  const previousProgress = latestUpdate?.progress ?? 0;
  const progressSince = latestUpdate?.createdAt ?? projectCreatedAt;

  return (
    <section className="rounded-[11px] border border-white/[0.075] bg-[#151619] shadow-[0_18px_50px_rgba(0,0,0,.18)]">
      <div className="px-3 pb-3 pt-2.5">
        <div
          className="flex items-center gap-1"
          role="tablist"
          aria-label={t("activity.typeLabel")}
        >
          <ComposerTab
            active={mode === "comment"}
            label={t("activity.comment")}
            onClick={() => setMode("comment")}
          />
          {canManage ? (
            <ComposerTab
              active={mode === "update"}
              label={t("activity.update")}
              onClick={() => setMode("update")}
            />
          ) : null}
          {mode === "update" ? (
            <Popover open={healthOpen} onOpenChange={setHealthOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 inline-flex h-6 items-center gap-1 rounded-full border border-white/[0.075] bg-white/[0.025] px-2 text-[10px] text-[#92cba0] transition-colors hover:bg-white/[0.055]"
                  aria-label={t("activity.setHealth")}
                >
                  <HealthIcon health={health} />
                  {t(`updates.health.${health}`)}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-44 gap-0 rounded-[9px] border border-white/[0.09] bg-[#191a1e] p-1 shadow-[0_18px_55px_rgba(0,0,0,.55)]"
              >
                {HEALTHS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setHealth(value);
                      setHealthOpen(false);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-[#c2c6cd] hover:bg-white/[0.06] hover:text-white"
                  >
                    <HealthIcon health={value} />
                    <span className="flex-1">{t(`updates.health.${value}`)}</span>
                    {health === value ? <IconCheck className="size-3.5" /> : null}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        <ProductionActivityEditor
          key={mode}
          value={content}
          placeholder={
            mode === "comment" ? t("activity.commentPlaceholder") : t("activity.updatePlaceholder")
          }
          ariaLabel={
            mode === "comment" ? t("activity.commentPlaceholder") : t("activity.updatePlaceholder")
          }
          onChange={(document, text) => {
            draftRevision.current += 1;
            setContent(document);
            setPlainText(text);
          }}
          onSubmit={() => void submit()}
          onFocusChange={setEditorFocused}
        />

        {mode === "update" ? (
          <div className="mb-4 ml-1 border-l-2 border-white/[0.11] py-0.5 pl-3 text-[10px]">
            {startDate ? (
              <SummaryRow
                label={t("activity.startDate")}
                value={t("activity.setTo", { value: formatDate(startDate, locale) })}
              />
            ) : null}
            <SummaryRow
              label={t("activity.progressSince", { date: formatDate(progressSince, locale) })}
              value={`${previousProgress}% → ${progress}%`}
            />
          </div>
        ) : null}

        <div className="flex h-7 items-center justify-end gap-2">
          {editorFocused || plainText ? (
            <button
              type="button"
              onClick={clearComposer}
              className="inline-flex h-7 items-center rounded-full border border-white/[0.08] bg-white/[0.025] px-3 text-[10px] font-medium text-[#b9bdc4] transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              {commonT("cancel")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!plainText || createActivity.isPending}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              plainText
                ? "border-[#ef3a3e]/40 bg-[#e52227] text-white hover:bg-[#f02c31]"
                : "border-white/[0.08] bg-white/[0.035] text-[#cdd0d5]"
            )}
          >
            {createActivity.isPending ? <IconLoader2 className="size-3 animate-spin" /> : null}
            {mode === "comment" ? t("activity.postComment") : t("updates.post")}
          </button>
        </div>
      </div>
    </section>
  );
}

function ComposerTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-full border px-2.5 text-[10px] transition-colors",
        active
          ? "border-white/[0.08] bg-white/[0.09] text-[#e6e7e9]"
          : "border-transparent text-[#8b919a] hover:bg-white/[0.045] hover:text-[#c9ccd1]"
      )}
    >
      {label}
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-6 grid-cols-[130px_1fr] items-center gap-3">
      <span className="text-[#838994]">{label}</span>
      <span className="text-[#c9ccd1]">{value}</span>
    </div>
  );
}

export function ProductionActivityEntry({
  activity,
  display,
}: {
  activity: CrewProductionActivityDTO;
  display: LookupUserDTO | null;
}) {
  const t = useTranslations("crewProduction");
  const locale = useLocale();
  const name = display?.nickname?.trim() || t("updates.systemActor");
  const optimistic = activity.id.startsWith("optimistic-");

  if (activity.kind === "comment") {
    if (!activity.content) {
      throw new Error(`Comment activity ${activity.id} is missing its Tiptap document.`);
    }
    return (
      <article className={cn("flex gap-2.5 py-3", optimistic && "opacity-60")}>
        <UserAvatar src={display?.avatar} seed={activity.createdByUserId} name={name} size={24} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[10px]">
            <span className="font-medium text-[#d5d8dd]">{name}</span>
            <time className="text-[#686f79]">{formatActivityDate(activity.createdAt, locale)}</time>
          </div>
          <ProductionActivityRichText
            content={activity.content}
            className="production-activity-content mt-1"
          />
        </div>
      </article>
    );
  }

  if (activity.kind === "update") {
    if (!activity.content) {
      throw new Error(`Update activity ${activity.id} is missing its Tiptap document.`);
    }
    return (
      <article
        className={cn(
          "rounded-[9px] border border-white/[0.065] bg-white/[0.018] px-3.5 py-3",
          optimistic && "opacity-60"
        )}
      >
        <div className="flex items-center gap-2 text-[10px]">
          <UserAvatar src={display?.avatar} seed={activity.createdByUserId} name={name} size={22} />
          <span className="font-medium text-[#d5d8dd]">{name}</span>
          <span className="text-[#707782]">{t("updates.published")}</span>
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-white/[0.04] px-2 text-[9px] text-[#aab0b8]">
            <HealthIcon health={activity.health ?? "on_track"} />
            {t(`updates.health.${activity.health ?? "on_track"}`)}
          </span>
          <time className="ml-auto text-[#626974]">
            {formatActivityDate(activity.createdAt, locale)}
          </time>
        </div>
        <ProductionActivityRichText
          content={activity.content}
          className="production-activity-content mt-2.5"
        />
      </article>
    );
  }

  return <ProductionAuditEntry activity={activity} display={display} />;
}

function ProductionAuditEntry({
  activity,
  display,
}: {
  activity: CrewProductionActivityDTO;
  display: LookupUserDTO | null;
}) {
  const t = useTranslations("crewProduction");
  const locale = useLocale();
  const name = display?.nickname?.trim() || t("updates.systemActor");
  const rows = auditRows(activity, t, locale);
  return (
    <>
      {rows.map((row, index) => (
        <div
          key={`${activity.id}-${index}`}
          className="flex min-h-7 items-center gap-2 text-[10px]"
        >
          <row.icon className={cn("size-3.5 shrink-0", row.iconClassName)} stroke={1.7} />
          <span className="min-w-0 truncate text-[#8d939d]">
            <span className="font-medium text-[#b8bdc5]">{name}</span> {row.label}
          </span>
          <time className="shrink-0 text-[#666d77]">
            · {formatActivityDate(activity.createdAt, locale)}
          </time>
        </div>
      ))}
    </>
  );
}

function auditRows(
  activity: CrewProductionActivityDTO,
  t: ReturnType<typeof useTranslations>,
  locale: string
): Array<{
  icon: typeof IconCube;
  iconClassName: string;
  label: string;
}> {
  if (activity.kind === "project_created") {
    return [
      { icon: IconCube, iconClassName: "text-[#e0b93f]", label: t("activity.createdProject") },
    ];
  }
  if (activity.kind === "properties_changed") {
    const changes = Array.isArray(activity.payload.changes)
      ? activity.payload.changes.filter(isPropertyChange)
      : [];
    return changes.map((change) => ({
      icon: change.field.includes("date") ? IconCalendarEvent : IconCircleCheck,
      iconClassName: "text-[#8d949e]",
      label: propertyChangeLabel(change, t, locale),
    }));
  }
  if (activity.kind === "labels_changed") {
    const added = Array.isArray(activity.payload.added)
      ? activity.payload.added.filter(isNamedValue)
      : [];
    const removed = Array.isArray(activity.payload.removed)
      ? activity.payload.removed.filter(isNamedValue)
      : [];
    return [
      ...added.map((label) => ({
        icon: IconTag,
        iconClassName: "text-[#8d949e]",
        label: t("activity.addedLabel", { label: label.name }),
      })),
      ...removed.map((label) => ({
        icon: IconTag,
        iconClassName: "text-[#8d949e]",
        label: t("activity.removedLabel", { label: label.name }),
      })),
    ];
  }
  const resource = isResourceValue(activity.payload.resource)
    ? activity.payload.resource
    : { title: t("activity.resource") };
  return [
    {
      icon: IconFilePlus,
      iconClassName: "text-[#8d949e]",
      label:
        activity.kind === "resource_removed"
          ? t("activity.removedResource", { resource: resource.title })
          : t("activity.addedResource", { resource: resource.title }),
    },
  ];
}

function isPropertyChange(
  value: unknown
): value is { field: string; from: string | null; to: string | null } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.field === "string" &&
    (candidate.to === null || typeof candidate.to === "string")
  );
}

function isNamedValue(value: unknown): value is { name: string } {
  return Boolean(
    value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
  );
}

function isResourceValue(value: unknown): value is { title: string } {
  return Boolean(
    value && typeof value === "object" && typeof (value as { title?: unknown }).title === "string"
  );
}

function propertyChangeLabel(
  change: { field: string; from: string | null; to: string | null },
  t: ReturnType<typeof useTranslations>,
  locale: string
) {
  if (change.field === "start_date") {
    return change.to
      ? t("activity.setStartDate", { date: formatDate(change.to, locale) })
      : t("activity.clearedStartDate");
  }
  if (change.field === "target_date") {
    return change.to
      ? t("activity.setTargetDate", { date: formatDate(change.to, locale) })
      : t("activity.clearedTargetDate");
  }
  return t("activity.changedProperty", { property: t(`activity.fields.${change.field}`) });
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value)
  );
}

function formatActivityDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(
    new Date(value)
  );
}

function HealthIcon({ health }: { health: CrewProductionUpdateHealth }) {
  if (health === "on_track") {
    return <IconCircleCheck className="size-3.5 shrink-0 text-[#6fb083]" />;
  }
  if (health === "at_risk") {
    return <IconAlertTriangle className="size-3.5 shrink-0 text-[#d6a24e]" />;
  }
  return <IconAlertTriangle className="size-3.5 shrink-0 text-[#d66a6a]" />;
}
