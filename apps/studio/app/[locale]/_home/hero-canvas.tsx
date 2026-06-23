"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef } from "react";

const LOCAL_HERO_ASSET_BASE = "/home/hero";
const DESKTOP_STAGE = { width: 1900, height: 360 };
const MOBILE_STAGE = { width: 730, height: 320 };
const BACKDROP_HEIGHT = 560;
const DOT_SIZE = 16;
const BRAND_RED = "#E52227";
const SOFT_CORAL = "#D85A5F";
const GRAPHITE_DOT = "rgb(255 255 255 / 0.13)";
const WARM_AMBER = "#F5B640";

type PromptCard = {
  text: string;
  className: string;
};

type MediaCard = {
  imageSrc: string;
  alt: string;
  className: string;
  mediaType?: "image" | "video";
  objectPositionClassName?: string;
  posterSrc?: string;
};

type Connector = {
  d: string;
  color: string;
};

type PointHandle = {
  className: string;
  color: string;
};

type CursorMarker = {
  label: string;
  color: string;
  className: string;
};

const DESKTOP_PROMPTS: PromptCard[] = [
  {
    text: "A bright social creator collage showing a young woman laughing with friends, filming short clips in daylight, festival energy, handheld vlog frames, warm natural color.",
    className: "left-[225.3671875px] top-[80.228515625px] h-[80px] w-[171.1392364501953px]",
  },
  {
    text: "A cheerful female creator portrait in outdoor daylight, curly hair, amber sunglasses, clean white jacket, confident smile, fresh social-media editorial style.",
    className: "left-[957px] top-[21px] h-[80px] w-[171.1392364501953px]",
  },
  {
    text: "A dynamic creator lifestyle video: crowd reactions, waving at camera, quick joyful movement, bright city square, natural daylight, energetic but polished.",
    className: "left-[1299px] top-[209.8681640625px] h-[80px] w-[171.1392364501953px]",
  },
];

const MOBILE_PROMPTS: PromptCard[] = [
  {
    text: "A cheerful female creator portrait in outdoor daylight, curly hair, amber sunglasses, clean white jacket, confident smile, fresh social-media editorial style.",
    className:
      "left-[19.42194366455078px] top-[19.421964645385742px] h-[73.98844146728516px] w-[158.27906799316406px]",
  },
  {
    text: "A bright creator storyboard with friends, city scenes, festival crowds, snacks, laughter, and energetic social-media moments in warm daylight.",
    className:
      "left-[335.7225341796875px] top-[221.8433837890625px] h-[73.98844146728516px] w-[158.27906799316406px]",
  },
];

const DESKTOP_MEDIA: MediaCard[] = [
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/poster-card-01.png`,
    objectPositionClassName: "object-[center_62%]",
    alt: "Architectural editorial poster with a seated creative director",
    className:
      "left-[520px] top-[85.9013671875px] h-[140px] w-[131.34629821777344px] rounded-[14.054px] border-[0.365px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/source-card-01.png`,
    alt: "Courtyard reference photo with a seated creative director",
    className: "left-[231px] top-[230px] h-[148px] w-[126px] rounded-[14.328px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/portrait-card-01.png`,
    alt: "Editorial portrait reference of a creative professional",
    className:
      "left-[1010.533203125px] top-[142.4111328125px] h-[120px] w-[128px] rounded-[8.533px] border-[0.356px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/storyboard-card-01.png`,
    alt: "Bright creator lifestyle storyboard grid",
    className: "left-[1289px] top-[62px] h-[120px] w-[178px] rounded-[6.834px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/video-card-01.mp4`,
    mediaType: "video",
    posterSrc: `${LOCAL_HERO_ASSET_BASE}/video-card-01-poster.jpg`,
    alt: "Generated creator lifestyle video preview",
    className:
      "left-[1572.673828125px] top-[119.8681640625px] h-[120px] w-[178px] rounded-[6.834px] border-[0.285px]",
  },
];

const MOBILE_MEDIA: MediaCard[] = [
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/portrait-card-01.png`,
    alt: "Editorial portrait reference of a creative professional",
    className:
      "left-[68.93319781532045px] top-[131.71013832092285px] h-[110.98265838623047px] w-[118.38150024414062px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/storyboard-card-01.png`,
    alt: "Bright creator lifestyle storyboard grid",
    className:
      "left-[335.7225341796875px] top-[85.1535415649414px] h-[110.98265838623047px] w-[94.8093032836914px]",
  },
  {
    imageSrc: `${LOCAL_HERO_ASSET_BASE}/video-card-01.mp4`,
    mediaType: "video",
    posterSrc: `${LOCAL_HERO_ASSET_BASE}/video-card-01-poster.jpg`,
    alt: "Generated creator lifestyle video preview",
    className:
      "left-[603.6289672851562px] top-[110.86073303222656px] h-[110.98265838623047px] w-[94.8093032836914px]",
  },
];

const DESKTOP_CONNECTORS: Connector[] = [
  { d: "M 404 97 C 435 95, 465 110, 512 116", color: SOFT_CORAL },
  { d: "M 363 255 C 400 236, 412 177, 512 132", color: WARM_AMBER },
  { d: "M 1136 42 C 1186 46, 1230 70, 1282 85", color: SOFT_CORAL },
  { d: "M 1148 163 C 1187 161, 1230 97, 1282 96", color: WARM_AMBER },
  { d: "M 1478 84 C 1512 86, 1530 148, 1564 157", color: WARM_AMBER },
  { d: "M 1478 230 C 1520 205, 1523 163, 1564 144", color: SOFT_CORAL },
];

const MOBILE_CONNECTORS: Connector[] = [
  { d: "M 185 39 C 228 43, 268 91, 330 107", color: SOFT_CORAL },
  { d: "M 195 151 C 238 149, 277 119, 330 121", color: WARM_AMBER },
  { d: "M 437 109 C 490 112, 533 140, 596 140", color: WARM_AMBER },
  { d: "M 502 241 C 545 219, 542 150, 596 134", color: SOFT_CORAL },
];

const DESKTOP_HANDLES: PointHandle[] = [
  { className: "left-[404px] top-[97px]", color: SOFT_CORAL },
  { className: "left-[512px] top-[116px]", color: SOFT_CORAL },
  { className: "left-[363px] top-[255px]", color: WARM_AMBER },
  { className: "left-[512px] top-[132px]", color: WARM_AMBER },
  { className: "left-[1136px] top-[42px]", color: SOFT_CORAL },
  { className: "left-[1282px] top-[85px]", color: SOFT_CORAL },
  { className: "left-[1148px] top-[163px]", color: WARM_AMBER },
  { className: "left-[1282px] top-[96px]", color: WARM_AMBER },
  { className: "left-[1478px] top-[84px]", color: WARM_AMBER },
  { className: "left-[1564px] top-[157px]", color: WARM_AMBER },
  { className: "left-[1478px] top-[230px]", color: SOFT_CORAL },
  { className: "left-[1564px] top-[144px]", color: SOFT_CORAL },
];

const MOBILE_HANDLES: PointHandle[] = [
  { className: "left-[185px] top-[39px]", color: SOFT_CORAL },
  { className: "left-[330px] top-[107px]", color: SOFT_CORAL },
  { className: "left-[195px] top-[151px]", color: WARM_AMBER },
  { className: "left-[330px] top-[121px]", color: WARM_AMBER },
  { className: "left-[437px] top-[109px]", color: WARM_AMBER },
  { className: "left-[596px] top-[140px]", color: WARM_AMBER },
  { className: "left-[502px] top-[241px]", color: SOFT_CORAL },
  { className: "left-[596px] top-[134px]", color: SOFT_CORAL },
];

const DESKTOP_CURSORS: CursorMarker[] = [
  { label: "Emma", color: WARM_AMBER, className: "left-[472px] top-[245px]" },
  { label: "Amelia", color: BRAND_RED, className: "left-[778px] top-[117px]" },
];

const MOBILE_CURSORS: CursorMarker[] = [
  {
    label: "Emma",
    color: WARM_AMBER,
    className: "left-[233.721923828125px] top-[186.2997283935547px]",
  },
];

const COMMENT_CLASS = "left-[717.75px] top-[81px] h-[36px] w-[178px]";
const SPOTLIGHT_MASK =
  "radial-gradient(circle 500px at var(--glow-x) var(--glow-y), #000 0%, #000 35%, transparent 75%)";

export function HeroCanvas() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const laptopQuery = window.matchMedia("(min-width: 80rem)");
    if (motionQuery.matches || !laptopQuery.matches) return;

    let rafId = 0;
    let step = 0;

    const tick = () => {
      const eased = (1 - Math.cos((step += 0.0045))) / 2;
      const y = 0.45 - 0.44 * Math.sin(eased * Math.PI);

      node.style.setProperty("--glow-x", `${(100 * (0.06 + 0.88 * eased)).toFixed(2)}%`);
      node.style.setProperty("--glow-y", `${(100 * y).toFixed(2)}%`);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-0 overflow-hidden [--glow-x:50%] [--glow-y:28%]"
      style={{ height: BACKDROP_HEIGHT }}
    >
      <div className="absolute left-1/2 top-0 h-full w-full max-w-[1920px] -translate-x-1/2 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            maskImage: SPOTLIGHT_MASK,
            WebkitMaskImage: SPOTLIGHT_MASK,
          }}
        >
          <div
            className="absolute inset-0 opacity-90"
            style={{
              backgroundImage: `radial-gradient(circle, ${GRAPHITE_DOT} 1px, transparent 1.5px)`,
              backgroundSize: `${DOT_SIZE}px ${DOT_SIZE}px`,
            }}
          />
          <Scene
            className="hidden min-[80rem]:block"
            stage={DESKTOP_STAGE}
            prompts={DESKTOP_PROMPTS}
            media={DESKTOP_MEDIA}
            connectors={DESKTOP_CONNECTORS}
            handles={DESKTOP_HANDLES}
            cursors={DESKTOP_CURSORS}
            showComment
          />
          <Scene
            className="block min-[80rem]:hidden"
            stage={MOBILE_STAGE}
            prompts={MOBILE_PROMPTS}
            media={MOBILE_MEDIA}
            connectors={MOBILE_CONNECTORS}
            handles={MOBILE_HANDLES}
            cursors={MOBILE_CURSORS}
          />
        </div>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle 450px at var(--glow-x) var(--glow-y), rgb(229 34 39 / 0.055) 0%, transparent 70%)",
          }}
        />
        <div className="absolute inset-y-0 left-0 hidden w-[120px] bg-gradient-to-r from-[oklch(0.17_0_0)] to-transparent min-[1921px]:block" />
        <div className="absolute inset-y-0 right-0 hidden w-[120px] bg-gradient-to-l from-[oklch(0.17_0_0)] to-transparent min-[1921px]:block" />
      </div>
    </div>
  );
}

function Scene({
  className,
  stage,
  prompts,
  media,
  connectors,
  handles,
  cursors,
  showComment = false,
}: {
  className: string;
  stage: { width: number; height: number };
  prompts: PromptCard[];
  media: MediaCard[];
  connectors: Connector[];
  handles: PointHandle[];
  cursors: CursorMarker[];
  showComment?: boolean;
}) {
  return (
    <div
      className={`absolute left-1/2 top-0 -translate-x-1/2 ${className}`}
      style={{ width: stage.width, height: stage.height }}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        width={stage.width}
        height={stage.height}
        viewBox={`0 0 ${stage.width} ${stage.height}`}
        fill="none"
      >
        {connectors.map((connector) => (
          <path
            key={connector.d}
            d={connector.d}
            stroke={connector.color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {prompts.map((prompt) => (
        <PromptNode key={prompt.className} {...prompt} />
      ))}
      {media.map((item) => (
        <MediaNode key={item.className} {...item} />
      ))}
      {handles.map((handle) => (
        <Handle key={`${handle.className}-${handle.color}`} {...handle} />
      ))}
      {showComment ? <IterationComment /> : null}
      {cursors.map((cursor) => (
        <CursorNode key={cursor.label} {...cursor} />
      ))}
    </div>
  );
}

function PromptNode({ text, className }: PromptCard) {
  return (
    <div
      className={`absolute scale-90 overflow-hidden rounded-[12.152px] border-[0.506px] border-white/[0.08] bg-[#191919]/95 p-[8.101px] text-[8.101px] font-normal leading-[12.152px] tracking-[0.081px] text-white/60 shadow-[0_4px_10px_rgb(0_0_0/0.18)] ${className}`}
    >
      {text}
    </div>
  );
}

function MediaNode({
  imageSrc,
  alt,
  className,
  mediaType = "image",
  objectPositionClassName = "object-center",
  posterSrc,
}: MediaCard) {
  return (
    <div
      className={`absolute scale-90 overflow-hidden border-white/[0.12] shadow-[0_4px_10px_rgb(0_0_0/0.18)] after:absolute after:inset-0 after:bg-[rgb(0_0_0/0.3)] after:content-[''] ${className}`}
    >
      {mediaType === "video" ? (
        <video
          src={imageSrc}
          poster={posterSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover object-center"
        />
      ) : (
        <img
          src={imageSrc}
          alt={alt}
          draggable={false}
          className={`size-full object-cover ${objectPositionClassName}`}
        />
      )}
    </div>
  );
}

function Handle({ className, color }: PointHandle) {
  return (
    <span
      className={`absolute size-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white shadow-[0_2px_6px_rgb(0_0_0/0.28)] ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}

function CursorNode({ label, color, className }: CursorMarker) {
  return (
    <div className={`absolute flex items-start gap-1 ${className}`}>
      <svg width="28" height="27" viewBox="0 0 28 27" fill="none">
        <path
          d="M7.76 23.72L2.54 1.71L24.95 12.91L13.74 15.41L7.76 23.72Z"
          fill={color}
          stroke="#0F0F0F"
          strokeWidth="1.25"
        />
      </svg>
      <span
        className="mt-[58px] -ml-[2px] rounded-[10.5px] px-[14px] py-[5px] text-[13px] font-semibold leading-[16px] text-white shadow-[0_4px_10px_rgb(0_0_0/0.18)]"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    </div>
  );
}

function IterationComment() {
  return (
    <div className={`absolute scale-90 ${COMMENT_CLASS}`}>
      <div className="absolute left-[2.25px] top-[3px] h-[29.25px] w-[172.854px] bg-[#B93A3E]" />
      <div className="absolute left-[2.25px] top-[3px] h-[29.25px] w-[172.854px] border-[0.75px] border-white" />
      <span className="absolute left-[8.75px] top-[9px] whitespace-nowrap text-[18px] font-semibold leading-[20px] text-white">
        Loved this iteration
      </span>
      <SelectionHandle className="left-0 top-0" />
      <SelectionHandle className="right-0 top-0" />
      <SelectionHandle className="right-0 bottom-0" />
      <SelectionHandle className="left-0 bottom-[0.75px]" />
      <span className="absolute left-0 top-[12px] h-[10.5px] w-[3px] rounded-full border-[0.75px] border-white bg-[#F7F7F7]" />
      <span className="absolute right-[1.625px] top-[12px] h-[10.5px] w-[3px] rounded-full border-[0.75px] border-white bg-[#F7F7F7]" />
    </div>
  );
}

function SelectionHandle({ className }: { className: string }) {
  return (
    <span
      className={`absolute size-[4.5px] rounded-[0.75px] border-[0.75px] border-white bg-[#F7F7F7] ${className}`}
    />
  );
}
