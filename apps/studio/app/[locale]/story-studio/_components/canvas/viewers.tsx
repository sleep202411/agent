"use client";

import { useCallback, useEffect, type SyntheticEvent } from "react";
import { IconEye, IconFingerprint, IconUsersGroup, IconX } from "@tabler/icons-react";
import { CharacterPortrait } from "./cards/shared";
import type { NarrativeNodeData } from "./types";

function useViewerClose(onClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const closeFromPointer = useCallback(
    (event: SyntheticEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      window.requestAnimationFrame(onClose);
    },
    [onClose]
  );

  const closeFromClick = useCallback(
    (event: SyntheticEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [onClose]
  );

  return { closeFromClick, closeFromPointer };
}

export function StoryRootViewer({
  storyRoot,
  onClose,
}: {
  storyRoot: NarrativeNodeData;
  onClose: () => void;
}) {
  const { closeFromClick, closeFromPointer } = useViewerClose(onClose);
  const sections = storyRoot.storyRootSections ?? [];
  const overviewCards = storyRoot.storyRootOverviewCards ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="故事总纲查看器"
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.03_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(242,26,167,0.08),transparent_28%),radial-gradient(circle_at_52%_18%,rgba(255,255,255,0.05),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_24%,rgba(0,0,0,0.5))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
        <button
          type="button"
          data-testid="close-story-root-viewer"
          onPointerDown={closeFromPointer}
          onClick={closeFromClick}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white/62 backdrop-blur-xl transition hover:bg-white/15 hover:text-white"
          aria-label="关闭故事总纲"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <article className="relative mx-auto h-full w-full max-w-[860px] overflow-y-auto px-8 pb-40 pt-14 duration-500 animate-in fade-in-0 slide-in-from-bottom-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/30">
            Story Root
          </p>
          <h1 className="mt-3 text-[42px] font-black leading-tight tracking-tight text-white/94">
            {storyRoot.label}
          </h1>
          <p className="mt-5 text-[18px] font-semibold leading-8 text-white/56">
            {storyRoot.summary}
          </p>
          {overviewCards.length > 0 ? (
            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {overviewCards.slice(0, 3).map((card) => (
                <div key={card.label} className="rounded-[22px] bg-white/[0.055] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">
                    {card.label}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-white/66">{card.value}</p>
                </div>
              ))}
            </div>
          ) : null}
        </header>

        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[27px] font-black leading-tight tracking-normal text-white/92">
                {section.heading}
              </h2>
              <div className="mt-5 space-y-5">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-[18px] font-semibold leading-9 tracking-normal text-white/64"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}

export function CharacterViewer({
  character,
  onClose,
}: {
  character: NarrativeNodeData;
  onClose: () => void;
}) {
  const { closeFromClick, closeFromPointer } = useViewerClose(onClose);
  const isProtagonist = character.characterMode === "protagonist";
  // Always render from the node's REAL data — no hardcoded character sheet.
  const detailSections = [
    {
      heading: isProtagonist ? "角色定位 · 玩家角色" : "角色定位",
      icon: IconFingerprint,
      paragraphs: [character.summary, `当前标签：${(character.chips ?? ["待补充"]).join("、")}。`],
    },
    {
      heading: "AI 扮演规则",
      icon: IconEye,
      paragraphs: [
        "AI 只能在当前剧情节点允许的信息范围内调用这个角色，不能让角色凭空知道未接触过的证据。",
        "当玩家自由输入触发该角色时，AI 需要先判断角色是否在场、是否愿意回应、以及回应会带来什么关系变化。",
      ],
    },
    {
      heading: "关系锚点",
      icon: IconUsersGroup,
      paragraphs: [
        "这张角色卡与故事总纲根节点相连，表示它是全局重要角色。具体出场、对话和触发条件应在剧情节点里绑定。",
      ],
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="角色卡查看器"
      className="fixed inset-0 z-[90] overflow-hidden bg-[oklch(0.035_0_0)] text-white duration-300 animate-in fade-in-0"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(255,255,255,0.06),transparent_24%),radial-gradient(circle_at_72%_34%,rgba(255,255,255,0.04),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_24%,rgba(0,0,0,0.58))] duration-500 animate-in fade-in-0 zoom-in-95" />

      <div className="absolute right-8 top-7 z-[110] flex items-center gap-3 duration-300 animate-in fade-in-0 slide-in-from-top-3">
        <button
          type="button"
          data-testid="close-character-viewer"
          onPointerDown={closeFromPointer}
          onClick={closeFromClick}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white/62 backdrop-blur-xl transition hover:bg-white/15 hover:text-white"
          aria-label="关闭角色卡"
        >
          <IconX className="size-5" />
        </button>
      </div>

      <div className="relative mx-auto grid h-full w-full max-w-[1180px] grid-cols-[340px_1fr] gap-10 overflow-hidden px-8 pb-36 pt-20 duration-500 animate-in fade-in-0 slide-in-from-bottom-8">
        <aside className="min-h-0 rounded-[34px] bg-white/[0.055] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.34)] backdrop-blur-xl">
          <CharacterPortrait portrait={character.characterPortrait ?? "neutral"} />
          <p className="mt-5 text-xs font-semibold tracking-[0.18em] text-white/36">
            {character.eyebrow}
          </p>
          <h2 className="mt-2 text-[34px] font-black leading-tight tracking-normal text-white/94">
            {character.label}
          </h2>
          <p className="mt-4 text-[14px] font-semibold leading-7 text-white/56">
            {character.summary}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {(character.chips ?? []).map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-black/18 px-3 py-1.5 text-xs font-semibold text-white/48"
              >
                {chip}
              </span>
            ))}
          </div>
        </aside>

        <article className="min-h-0 overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="space-y-6 pb-10">
            {detailSections.map((section) => {
              const SectionIcon = section.icon;
              return (
                <section key={section.heading} className="rounded-[34px] bg-white/[0.045] p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-full bg-white/10 text-white/72">
                      <SectionIcon className="size-5" />
                    </span>
                    <h3 className="text-[24px] font-black leading-tight text-white/92">
                      {section.heading}
                    </h3>
                  </div>
                  <div className="mt-5 space-y-4">
                    {section.paragraphs.map((paragraph) => (
                      <p
                        key={paragraph}
                        className="text-[16px] font-semibold leading-8 text-white/60"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
