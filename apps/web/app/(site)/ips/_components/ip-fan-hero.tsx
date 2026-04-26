"use client";

/**
 * IP Plaza fanned-card hero — auto-rotating, infinite-loop, no overlap.
 *
 * Layout: 5 cards visible in a fan (center active + 2 cards on each
 * side, no overlap), with 2 hidden buffer slots at the edges so cards
 * can wrap around invisibly when the carousel cycles past the end.
 *
 * Behaviour:
 * - Active card cycles every 5s. Hover pauses the timer.
 * - Click a side card to make it active immediately.
 * - Wraparound is seamless: when the leftmost card needs to become the
 *   rightmost, it teleports through the hidden buffer at opacity 0.
 * - Title / tagline / tags / social-proof below the cards reflect the
 *   currently-active IP and cross-fade on change.
 *
 * Placeholder imagery (when API returns sparse data) uses cinematic
 * Unsplash stills that match the AI-animation aesthetic. Swap with real
 * production stills before launch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { IconArrowRight, IconBolt } from "@tabler/icons-react";

function smoothScrollTo(id: string) {
  if (typeof document === "undefined") return;
  const target = document.getElementById(id);
  if (!target) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
import { useIPProjects, ipImageUrl, type IPProject } from "../_hooks/use-ip";

// 7 total slots = 5 visible + 2 hidden buffer for invisible wraparound.
const SLOT_COUNT = 7;
const ROTATE_INTERVAL_MS = 5000;

// Cinematic placeholder stills — used when the API hasn't populated 7 IPs
// yet. Cyberpunk / anime / neon aesthetic to match FizzDragon's AI-animation
// positioning. Swap with real stills before launch.
const PLACEHOLDER_STILLS = [
  "https://images.unsplash.com/photo-1631878139457-3175fd1c824d?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1697205153149-a60e3a2ddc61?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1641071651748-274f40fa5fde?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1640903581708-8d491706515b?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1709595303000-8eac8137440f?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1614851099175-e5b30eb6f696?w=900&q=85&fit=crop",
  "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=85&fit=crop",
];

const PLACEHOLDER_LABELS = [
  "Neon Bloom",
  "Hallway Echo",
  "Crimson District",
  "Forest Cipher",
  "First Light",
  "Vapor Drift",
  "Skyline 2099",
];

interface SlotItem {
  id: string;
  name: string;
  cover: string;
  ownerName?: string;
  ownerAvatar?: string;
  description?: string;
  tags?: string[];
  href?: string;
}

interface SlotStyle {
  x: number;
  rotate: number;
  scale: number;
  y: number;
  z: number;
  opacity: number;
}

// Card base width = 260px. Spread keeps clean gaps even at full rotation.
function styleForRelative(r: number): SlotStyle {
  switch (r) {
    case 0:
      return { x: 0, rotate: 0, scale: 1.15, y: -24, z: 50, opacity: 1 };
    case -1:
      return { x: -310, rotate: -8, scale: 0.96, y: 28, z: 30, opacity: 0.96 };
    case 1:
      return { x: 310, rotate: 8, scale: 0.96, y: 28, z: 30, opacity: 0.96 };
    case -2:
      return { x: -590, rotate: -16, scale: 0.82, y: 78, z: 10, opacity: 0.65 };
    case 2:
      return { x: 590, rotate: 16, scale: 0.82, y: 78, z: 10, opacity: 0.65 };
    default:
      // r = ±3 (hidden buffer for wraparound) — opacity 0, farther out
      return {
        x: r < 0 ? -820 : 820,
        rotate: r < 0 ? -22 : 22,
        scale: 0.7,
        y: 120,
        z: 0,
        opacity: 0,
      };
  }
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function ipToSlot(ip: IPProject): SlotItem {
  return {
    id: String(ip.id),
    name: ip.name,
    cover: ipImageUrl(ip.bannerLink),
    ownerName: ip.ownerName,
    ownerAvatar: ipImageUrl(ip.ownerAvatar),
    description: ip.description,
    tags: parseTags(ip.tag),
    href: `/ips/${ip.id}`,
  };
}

function placeholderSlot(i: number): SlotItem {
  return {
    id: `placeholder-${i}`,
    name: PLACEHOLDER_LABELS[i % PLACEHOLDER_LABELS.length],
    cover: PLACEHOLDER_STILLS[i % PLACEHOLDER_STILLS.length],
  };
}

interface Props {
  onCreateClick: () => void;
  listingsAnchorId?: string;
}

export function IPFanHero({ onCreateClick, listingsAnchorId = "listings" }: Props) {
  const { data } = useIPProjects({ page: 1, pageSize: SLOT_COUNT });
  const realItems = data?.list ?? [];

  // Build SLOT_COUNT items: real first, padded with placeholders.
  const cards: SlotItem[] = useMemo(() => {
    const slots: SlotItem[] = realItems.map(ipToSlot);
    for (let i = slots.length; i < SLOT_COUNT; i++) slots.push(placeholderSlot(i));
    return slots.slice(0, SLOT_COUNT);
  }, [realItems]);

  const [active, setActive] = useState(0);
  const prevActiveRef = useRef(0);
  const [paused, setPaused] = useState(false);

  // Auto-advance.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % SLOT_COUNT), ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  // Track previous active so we can detect wraparound and teleport instantly.
  useEffect(() => {
    prevActiveRef.current = active;
  });

  function getRelative(i: number, a: number): number {
    const half = Math.floor(SLOT_COUNT / 2);
    let r = i - a;
    if (r > half) r -= SLOT_COUNT;
    if (r < -half) r += SLOT_COUNT;
    return r;
  }

  const activeCard = cards[active];

  return (
    <section className="relative -mt-16 min-h-screen overflow-hidden border-b border-border pt-16">
      {/* Ambient blurred banner of the active card — cross-fades on change. */}
      <AnimatePresence mode="sync">
        {activeCard.cover ? (
          <motion.img
            key={activeCard.id}
            src={activeCard.cover}
            alt=""
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.32 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute inset-0 -z-20 size-full scale-150 object-cover blur-3xl"
          />
        ) : null}
      </AnimatePresence>

      {/* Color tint */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 60% 40% at 50% 25%, hsl(42 95% 55% / 0.18) 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 50% 90%, hsl(0 80% 50% / 0.10) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-background/30 via-transparent to-background"
      />

      <div
        className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-screen-2xl flex-col px-6 pt-6 pb-10"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Fanned cards (desktop) — flex-1 absorbs spare height so cards
            stay vertically centered and the info row sits at the bottom. */}
        <div className="relative hidden min-h-[420px] flex-1 items-center justify-center md:flex">
          {cards.map((item, i) => {
            const r = getRelative(i, active);
            const prevR = getRelative(i, prevActiveRef.current);
            // Wraparound: card jumped more than 1 slot in one tick. Teleport
            // instantly through the hidden buffer (opacity 0) instead of
            // animating across the visible fan.
            const isWrapping = Math.abs(r - prevR) > 1;
            return (
              <FanCard
                key={i}
                item={item}
                slot={styleForRelative(r)}
                isActive={r === 0}
                isWrapping={isWrapping}
                onClick={() => setActive(i)}
              />
            );
          })}
        </div>

        {/* Mobile: just the active card + dots */}
        <div className="mt-8 md:hidden">
          <div className="mx-auto w-[240px]">
            <CardLink item={activeCard} active>
              <CardBody item={activeCard} />
            </CardLink>
          </div>
          <div className="mt-5 flex justify-center gap-2">
            {cards.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show card ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === active ? "w-6 bg-foreground" : "w-1.5 bg-foreground/30"
                }`}
              />
            ))}
          </div>
        </div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
        >
          <button
            type="button"
            onClick={() => smoothScrollTo(listingsAnchorId)}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-7 text-sm font-semibold text-background transition-colors hover:bg-foreground/90"
          >
            Browse all IPs
            <IconArrowRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={onCreateClick}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 text-sm font-semibold text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-colors hover:bg-white/[0.08]"
          >
            <IconBolt className="size-4 text-amber-300" />
            Create IP Project
          </button>
        </motion.div>

        {/* Active card info — title, tags, description, social proof */}
        <ActiveCardInfo card={activeCard} />
      </div>
    </section>
  );
}

// ─── Active info block (cross-fades on change) ────────

function ActiveCardInfo({ card }: { card: SlotItem }) {
  const tags = card.tags ?? [];
  const fallbackTags = ["Investment", "Pre-order", "Production"];
  const visibleTags = tags.length > 0 ? tags.slice(0, 4) : fallbackTags;
  const fallbackDesc =
    "Discover original IPs at every stage — back a creator as an investor, pre-order to fund production, or buy the finished series.";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={card.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end"
      >
        <div>
          <div className="mb-5 flex flex-wrap gap-2">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
              >
                {tag}
              </span>
            ))}
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-5xl">
            {card.name}
          </h1>
        </div>
        <div className="flex flex-col gap-4 lg:items-end lg:text-right">
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {card.description?.trim() || fallbackDesc}
          </p>
          {card.ownerName ? (
            <div className="inline-flex items-center gap-3 self-start rounded-full border border-white/10 bg-white/[0.04] py-2 pl-2 pr-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl lg:self-end">
              <Avatar src={card.ownerAvatar ?? ""} fallback={card.ownerName} />
              <span className="text-xs text-muted-foreground">
                <strong className="text-foreground">{card.ownerName}</strong> & community
              </span>
            </div>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Card primitives ──────────────────────────────────

function FanCard({
  item,
  slot,
  isActive,
  isWrapping,
  onClick,
}: {
  item: SlotItem;
  slot: SlotStyle;
  isActive: boolean;
  isWrapping: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      className="absolute"
      style={{ transformOrigin: "center bottom" }}
      animate={{
        x: slot.x,
        y: slot.y,
        rotate: slot.rotate,
        scale: slot.scale,
        opacity: slot.opacity,
        zIndex: slot.z,
      }}
      transition={
        isWrapping ? { duration: 0 } : { type: "spring", stiffness: 110, damping: 22, mass: 0.9 }
      }
    >
      <div onClick={onClick} className={isActive ? "" : "cursor-pointer"}>
        <CardLink item={item} active={isActive} clickable={isActive}>
          <CardBody item={item} />
        </CardLink>
      </div>
    </motion.div>
  );
}

function CardLink({
  item,
  active,
  clickable = true,
  children,
}: {
  item: SlotItem;
  active: boolean;
  clickable?: boolean;
  children: React.ReactNode;
}) {
  const className = `block w-[260px] overflow-hidden rounded-3xl border ${
    active ? "border-white/25" : "border-white/10"
  } bg-white/[0.04] shadow-[0_10px_40px_-12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-shadow hover:shadow-[0_20px_60px_-16px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.14)]`;
  if (clickable && item.href) {
    return (
      <Link href={item.href} className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    );
  }
  return <div className={className}>{children}</div>;
}

function CardBody({ item }: { item: SlotItem }) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
      <img src={item.cover} alt={item.name} className="size-full object-cover" loading="lazy" />
      <div className="absolute left-3 top-3">
        <span className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md">
          {item.href ? "Live" : "Featured"}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-4 pb-4 pt-12">
        <div className="line-clamp-1 text-sm font-semibold text-white">{item.name}</div>
        {item.ownerName ? (
          <div className="mt-0.5 line-clamp-1 text-xs text-white/65">by {item.ownerName}</div>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ src, fallback }: { src: string; fallback: string }) {
  return (
    <div className="relative size-7 overflow-hidden rounded-full border-2 border-background bg-gradient-to-br from-amber-400/60 to-rose-400/60">
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-[10px] font-semibold text-white">
          {(fallback || "?")[0].toUpperCase()}
        </div>
      )}
    </div>
  );
}
