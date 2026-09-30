"use client";

import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconGitBranch, IconLink, IconMovie, IconSearch, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { cn } from "@/lib/utils";

export type StoryConnectionCreationKind = "clip" | "choice";

export type StoryConnectionExistingTarget = {
  nodeId: string;
  kind: "clip" | "decision";
  title: string;
  detail: string;
  availability: "open" | "replace";
};

export function StoryConnectionCreator({
  position,
  targets,
  onCreate,
  onConnectExisting,
  onCancel,
}: {
  position: { x: number; y: number };
  targets: readonly StoryConnectionExistingTarget[];
  onCreate: (kind: StoryConnectionCreationKind) => void;
  onConnectExisting: (nodeId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.connectionCreator");
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pickingExisting, setPickingExisting] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (pickingExisting) searchRef.current?.focus();
    else firstActionRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (pickingExisting) {
        setPickingExisting(false);
        setQuery("");
        return;
      }
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pickingExisting]);

  const visibleTargets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return targets;
    return targets.filter((target) =>
      `${target.title}\n${target.detail}`.toLowerCase().includes(needle)
    );
  }, [query, targets]);

  return (
    <div
      className="fixed inset-0 z-50"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <FrostedPanel
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="fixed w-[360px] rounded-[20px] bg-[oklch(0.24_0_0/0.96)] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.58)] backdrop-blur-[40px]"
        style={{
          left: `clamp(16px, ${position.x + 12}px, calc(100vw - 376px))`,
          top: `clamp(16px, ${position.y + 12}px, calc(100vh - 420px))`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-3 pt-2 pb-2.5">
          <div>
            <p className="text-xs font-semibold text-white/86">
              {pickingExisting ? t("existingTitle") : t("title")}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-white/38">
              {pickingExisting ? t("existingHint") : t("description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-white/38 transition hover:bg-white/[0.1] hover:text-white"
            aria-label={t("cancel")}
          >
            <IconX className="size-3.5" />
          </button>
        </div>

        {pickingExisting ? (
          <div className="grid gap-1">
            <label className="flex h-9 items-center gap-2 rounded-[12px] bg-white/[0.05] px-2.5">
              <IconSearch className="size-3.5 shrink-0 text-white/38" stroke={2} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("existingSearch")}
                className="nodrag nopan nowheel min-w-0 flex-1 bg-transparent text-xs text-white/86 outline-none placeholder:text-white/32"
              />
            </label>
            <div className="max-h-72 overflow-y-auto">
              {visibleTargets.length > 0 ? (
                visibleTargets.map((target) => (
                  <ExistingTargetButton
                    key={target.nodeId}
                    target={target}
                    onClick={() => onConnectExisting(target.nodeId)}
                  />
                ))
              ) : (
                <p className="px-2.5 py-4 text-xs text-white/38">{t("existingEmpty")}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-1">
            <ConnectionCreatorItem
              ref={firstActionRef}
              tone="clip"
              icon={<IconMovie className="size-4" stroke={2} />}
              title={t("clip")}
              description={t("clipDescription")}
              onClick={() => onCreate("clip")}
            />
            <ConnectionCreatorItem
              tone="choice"
              icon={<IconGitBranch className="size-4" stroke={2} />}
              title={t("choice")}
              description={t("choiceDescription")}
              onClick={() => onCreate("choice")}
            />
            <ConnectionCreatorItem
              tone="existing"
              icon={<IconLink className="size-4" stroke={2} />}
              title={t("existing")}
              description={t("existingDescription")}
              onClick={() => setPickingExisting(true)}
            />
          </div>
        )}
      </FrostedPanel>
    </div>
  );
}

function ExistingTargetButton({
  target,
  onClick,
}: {
  target: StoryConnectionExistingTarget;
  onClick: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.connectionCreator");
  const Icon = target.kind === "clip" ? IconMovie : IconGitBranch;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left transition-colors hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-[10px]",
          target.kind === "clip"
            ? "bg-[#E52227]/14 text-[#ff9b9e]"
            : "bg-[#5b9dff]/16 text-[#9bc4ff]"
        )}
      >
        <Icon className="size-3.5" stroke={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-white/84">{target.title}</span>
        {target.availability === "replace" ? (
          <span className="mt-0.5 block text-[10px] leading-4 text-white/45">
            {t("existingReplace")}
          </span>
        ) : null}
        {target.detail ? (
          <span className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out group-hover:grid-rows-[1fr] group-focus-visible:grid-rows-[1fr] motion-reduce:transition-none">
            <span className="overflow-hidden">
              <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-white/38 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                {target.detail}
              </span>
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** Video red, choice blue, and the story graph's entry purple. Color stays on the icon. */
const CONNECTION_CREATOR_TONES = {
  clip: {
    tile: "bg-[#E52227]/10",
    badge: "bg-[#E52227]/18 text-[#ff9b9e]",
  },
  choice: {
    tile: "bg-[#5b9dff]/10",
    badge: "bg-[#5b9dff]/18 text-[#9bc4ff]",
  },
  existing: {
    tile: "bg-[#8f65ff]/10",
    badge: "bg-[#8f65ff]/18 text-[#d2c2ff]",
  },
} as const;

const ConnectionCreatorItem = forwardRef<
  HTMLButtonElement,
  {
    tone: keyof typeof CONNECTION_CREATOR_TONES;
    icon: ReactNode;
    title: string;
    description: string;
    onClick: () => void;
  }
>(function ConnectionCreatorItem({ tone, icon, title, description, onClick }, ref) {
  const accent = CONNECTION_CREATOR_TONES[tone];
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group flex min-h-16 w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[14px] shadow-[0_10px_26px_rgba(0,0,0,0.22)]",
          accent.tile
        )}
      >
        <span className={cn("grid size-7 place-items-center rounded-[10px]", accent.badge)}>
          {icon}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-white/80 group-hover:text-white">
          {title}
        </span>
        <span className="mt-0.5 block text-[10px] leading-4 text-white/36">{description}</span>
      </span>
    </button>
  );
});
