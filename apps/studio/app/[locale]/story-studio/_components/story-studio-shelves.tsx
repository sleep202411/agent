"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { IconChevronRight, IconClock, IconPlayerPlay } from "@tabler/icons-react";
import { Link } from "@/i18n/navigation";

gsap.registerPlugin(useGSAP);

export type StoryStudioStory = {
  title: string;
  eyebrow?: string;
  description: string;
  estimatedPlayTime: string;
  image: string;
  video?: string;
  href?: string;
};

type PreviewState = {
  story: StoryStudioStory;
  left: number;
  top: number;
  width: number;
};

const PREVIEW_HEIGHT = 296;
const PREVIEW_MARGIN = 16;
const CLOSE_DELAY_MS = 200;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPreviewState(story: StoryStudioStory, anchor: HTMLElement): PreviewState {
  const rect = anchor.getBoundingClientRect();
  const width = clamp(window.innerWidth * 0.28, 300, 400);
  const left = clamp(
    rect.left + rect.width / 2 - width / 2,
    PREVIEW_MARGIN,
    window.innerWidth - width - PREVIEW_MARGIN
  );
  const top = clamp(
    rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2,
    PREVIEW_MARGIN,
    window.innerHeight - PREVIEW_HEIGHT - PREVIEW_MARGIN
  );

  return { story, left, top, width };
}

export function StoryShelf({ stories }: { stories: StoryStudioStory[] }) {
  const closeTimerRef = useRef<number | null>(null);
  const activeAnchorRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!preview) return;

    const syncPosition = () => {
      const anchor = activeAnchorRef.current;
      if (!anchor) return;
      setPreview(getPreviewState(preview.story, anchor));
    };

    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [preview]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const clearCloseTimer = () => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };

  const openPreview = (story: StoryStudioStory, anchor: HTMLElement) => {
    clearCloseTimer();
    activeAnchorRef.current = anchor;
    setPreview(getPreviewState(story, anchor));
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      activeAnchorRef.current = null;
      setPreview(null);
    }, CLOSE_DELAY_MS);
  };

  return (
    <section className="relative z-20 pr-6 pl-20 pt-8 pb-16 lg:pl-[120px]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
        {stories.map((story) => (
          <StoryCard
            key={story.title}
            story={story}
            onPreviewOpen={openPreview}
            onPreviewClose={scheduleClose}
          />
        ))}
      </div>
      <StoryPreview
        preview={preview}
        onPreviewEnter={clearCloseTimer}
        onPreviewLeave={scheduleClose}
      />
    </section>
  );
}

function StoryCard({
  story,
  onPreviewOpen,
  onPreviewClose,
}: {
  story: StoryStudioStory;
  onPreviewOpen: (story: StoryStudioStory, anchor: HTMLElement) => void;
  onPreviewClose: () => void;
}) {
  const content = (
    <>
      {story.video ? (
        <video
          src={story.video}
          poster={story.image}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
      ) : (
        <Image
          src={story.image}
          alt=""
          fill
          sizes="(max-width: 1200px) 25vw, 280px"
          className="object-cover transition duration-500 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,rgba(0,0,0,0.58)_100%)]" />
      <div className="absolute right-3 bottom-3 left-3">
        {story.eyebrow ? (
          <div className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-white/62 uppercase">
            {story.eyebrow}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.005em] text-white">
            {story.title}
          </h3>
          <IconChevronRight className="size-3.5 shrink-0 text-white/70" stroke={2.2} />
        </div>
      </div>
    </>
  );
  const interactionProps = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) =>
      onPreviewOpen(story, event.currentTarget),
    onPointerLeave: onPreviewClose,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) =>
      onPreviewOpen(story, event.currentTarget),
    onMouseLeave: onPreviewClose,
    onFocus: (event: React.FocusEvent<HTMLElement>) => onPreviewOpen(story, event.currentTarget),
    onBlur: onPreviewClose,
  };
  const className =
    "relative block h-full overflow-hidden rounded-[4px] bg-white/[0.06] shadow-[0_18px_42px_rgba(0,0,0,0.32)]";

  return (
    <div className="group relative aspect-video">
      {story.href ? (
        <Link href={story.href} {...interactionProps} className={className}>
          {content}
        </Link>
      ) : (
        <div tabIndex={0} {...interactionProps} className={className}>
          {content}
        </div>
      )}
    </div>
  );
}

function StoryPreview({
  preview,
  onPreviewEnter,
  onPreviewLeave,
}: {
  preview: PreviewState | null;
  onPreviewEnter: () => void;
  onPreviewLeave: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const element = previewRef.current;
      if (!element || !preview) return;

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(element, { autoAlpha: 1, scale: 1, y: 0, filter: "blur(0px)" });
        return;
      }

      gsap.fromTo(
        element,
        {
          autoAlpha: 0,
          scale: 0.94,
          y: 10,
          filter: "blur(8px)",
          transformOrigin: "50% 50%",
        },
        {
          autoAlpha: 1,
          scale: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.24,
          ease: "power3.out",
          overwrite: "auto",
        }
      );
    },
    {
      dependencies: [preview?.story.title, preview?.left, preview?.top, preview?.width],
      revertOnUpdate: true,
    }
  );

  if (!preview || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={previewRef}
      onPointerEnter={onPreviewEnter}
      onPointerLeave={onPreviewLeave}
      onMouseEnter={onPreviewEnter}
      onMouseLeave={onPreviewLeave}
      className="fixed z-[1000] overflow-hidden rounded-[16px] bg-[#171819] opacity-0 shadow-[0_28px_80px_rgba(0,0,0,0.62)] will-change-transform"
      style={{
        left: preview.left,
        top: preview.top,
        width: preview.width,
      }}
    >
      <div className="relative h-[160px] overflow-hidden rounded-t-[16px]">
        {preview.story.video ? (
          <video
            src={preview.story.video}
            poster={preview.story.image}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <Image
            src={preview.story.image}
            alt=""
            fill
            sizes={`${Math.round(preview.width)}px`}
            className="object-cover"
            priority={false}
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.02)_0%,rgba(0,0,0,0.18)_100%)]" />
      </div>

      <div className="p-3.5">
        <h3 className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-white">
          {preview.story.title}
        </h3>
        <p className="mt-1 text-[12px] leading-[17px] font-medium text-white/62">
          {preview.story.description}
        </p>

        <div className="mt-3.5 flex items-center justify-between gap-2.5">
          {preview.story.href ? (
            <Link
              href={preview.story.href}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12px] font-semibold text-black shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
            >
              <IconPlayerPlay className="size-3 fill-black" stroke={2.4} />
              Open
            </Link>
          ) : (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12px] font-semibold text-black shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
              <IconPlayerPlay className="size-3 fill-black" stroke={2.4} />
              Preview
            </span>
          )}
          <span className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 text-[11px] font-medium text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <IconClock className="size-3 shrink-0" stroke={2} />
            <span className="truncate">Estimated {preview.story.estimatedPlayTime}</span>
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
