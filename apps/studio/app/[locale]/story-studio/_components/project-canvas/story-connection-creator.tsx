"use client";

import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { IconGitBranch, IconMovie, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { FrostedPanel } from "@/components/ui/frosted-panel";

export type StoryConnectionCreationKind = "clip" | "choice";

export function StoryConnectionCreator({
  position,
  onCreate,
  onCancel,
}: {
  position: { x: number; y: number };
  onCreate: (kind: StoryConnectionCreationKind) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.connectionCreator");
  const firstActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstActionRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

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
        className="fixed w-[304px] rounded-[20px] bg-[oklch(0.24_0_0/0.96)] p-2 shadow-[0_24px_90px_rgba(0,0,0,0.58)] backdrop-blur-[40px]"
        style={{
          left: `clamp(16px, ${position.x + 12}px, calc(100vw - 320px))`,
          top: `clamp(16px, ${position.y + 12}px, calc(100vh - 246px))`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-3 pt-2 pb-2.5">
          <div>
            <p className="text-xs font-semibold text-white/86">{t("title")}</p>
            <p className="mt-1 text-[10px] leading-4 text-white/38">{t("description")}</p>
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

        <div className="grid gap-1">
          <ConnectionCreatorItem
            ref={firstActionRef}
            icon={<IconMovie className="size-4" stroke={2} />}
            title={t("clip")}
            description={t("clipDescription")}
            onClick={() => onCreate("clip")}
          />
          <ConnectionCreatorItem
            icon={<IconGitBranch className="size-4" stroke={2} />}
            title={t("choice")}
            description={t("choiceDescription")}
            onClick={() => onCreate("choice")}
          />
        </div>
      </FrostedPanel>
    </div>
  );
}

const ConnectionCreatorItem = forwardRef<
  HTMLButtonElement,
  {
    icon: ReactNode;
    title: string;
    description: string;
    onClick: () => void;
  }
>(function ConnectionCreatorItem({ icon, title, description, onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group flex min-h-16 w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-white/[0.08] text-white/72 shadow-[0_10px_26px_rgba(0,0,0,0.22)]">
        <span className="grid size-7 place-items-center rounded-[10px] bg-white/[0.08]">
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
