"use client";

/**
 * Home-page chrome: the top promo banner, the top-right header actions (with the
 * brand wordmark on the left, since the shared icon rail carries no logo), and
 * the footer. Navigation itself is the app's shared `StudioSidebar` (icon rail) —
 * we don't have pollo's ~15 menu items, so the home uses the same rail as the
 * rest of the app. Themed via the `theme` prop (CTA accent = t.genBg, promo
 * highlights = t.price).
 */

import {
  IconBrandDiscord,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandX,
  IconBrandYoutube,
  IconCrown,
  IconStarFilled,
  type Icon,
} from "@tabler/icons-react";
import Image from "next/image";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/app/_components/auth-provider";
import { AccountMenu } from "@/app/_components/account-menu";
import { CreditsBadge } from "@/app/_components/credits-badge";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { WorkspaceSwitcher } from "@/app/_components/workspace-switcher";
import type { Theme } from "../_pollo/theme";

const SOCIAL: Icon[] = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandYoutube,
  IconBrandDiscord,
];

export function HeaderBar({ theme: t }: { theme: Theme }) {
  // Real auth. Logged-in → workspace switcher + compute credits + a themed
  // membership/Upgrade CTA + the account menu. Logged-out → a single themed
  // Login CTA (one button, accent color) beside the Pricing link. The brand
  // wordmark sits at the left edge (the icon rail has no logo).
  const { user, loading, signIn } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);

  // The one shared accent CTA style — brand accent per the active theme preset.
  const ctaStyle = { background: t.genBg, color: t.genText, boxShadow: t.genShadow };

  return (
    <header className="flex h-16 items-center justify-between gap-4 px-6 text-[14px]">
      <Link href="/" aria-label="FizzDragon home" className="flex shrink-0 items-center">
        <Image
          src="/logo.png"
          alt="FizzDragon"
          width={439}
          height={78}
          priority
          className="h-7 w-auto"
        />
      </Link>

      <div className="flex items-center gap-3">
        {loading ? (
          <>
            <div className="h-10 w-44 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="size-9 animate-pulse rounded-full bg-white/[0.06]" />
          </>
        ) : user ? (
          <>
            {/* workspace — the active pot/team (workspace-owned compute) */}
            <WorkspaceSwitcher />
            {/* compute credits — matched to the h-10 controls beside it */}
            <CreditsBadge className="flex h-10 items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 text-sm font-medium tabular-nums" />
            {/* membership / upgrade — the accent CTA */}
            <button
              type="button"
              onClick={() => setPricingOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110"
              style={ctaStyle}
            >
              <IconCrown className="size-4" stroke={1.8} />
              Upgrade
            </button>
            <AccountMenu />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPricingOpen(true)}
              className="text-white/70 transition hover:text-white"
            >
              Pricing
            </button>
            <button
              type="button"
              onClick={signIn}
              className="rounded-full px-5 py-2 text-[13px] font-semibold transition hover:brightness-110"
              style={ctaStyle}
            >
              Login
            </button>
          </>
        )}
      </div>

      <SubscriptionDialog open={pricingOpen} onOpenChange={setPricingOpen} />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
const FOOTER_COLS: { title: string; links: string[] }[] = [
  {
    title: "Creative Tools",
    links: [
      "Agent",
      "AI Video Generator",
      "Text to Video AI",
      "Image to Video AI",
      "Reference to Video",
      "Photo to Video Avatar",
      "AI Video Editor",
      "Mimic Motion",
      "Video to Video AI",
      "AI Image Generator",
      "AI Photo Editor",
      "AI Voice Generator",
    ],
  },
  {
    title: "Video Models",
    links: [
      "Seedance 2.0",
      "Veo 3",
      "Sora 2",
      "Kling 3.0",
      "Happy Horse",
      "Hailuo AI",
      "Runway",
      "Vidu AI",
      "Luma AI",
      "Wan AI",
      "Hunyuan",
      "More Models",
    ],
  },
  {
    title: "Image Models",
    links: [
      "GPT Image 2",
      "Nano Banana 2",
      "Recraft",
      "Ideogram",
      "Stable Diffusion",
      "Flux AI",
      "Seedream",
      "Dall-E",
      "Imagen",
      "Flux Kontext",
      "Qwen Image",
      "More Models",
    ],
  },
  {
    title: "Apps",
    links: [
      "Clone Viral Video",
      "UGC Video Ads",
      "Clone Video Ads",
      "Anime Video",
      "Story Video",
      "Music Video",
      "News Video",
      "Explainer Video",
      "Marketing Video",
      "Instagram Video",
      "B-Roll Video",
      "More Apps",
    ],
  },
  {
    title: "Company",
    links: [
      "About Us",
      "Contact Us",
      "Pricing",
      "API",
      "What's New",
      "MCP Server",
      "Download App",
      "Creative Partner Program",
      "Affiliate Program",
      "Refund Policy",
      "Privacy Policy",
      "Terms and Conditions",
    ],
  },
];

export function Footer({ theme: t }: { theme: Theme }) {
  return (
    <footer className="mt-24 px-6 pt-12 pb-10">
      <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
        {FOOTER_COLS.map((col) => (
          <div key={col.title} className="flex flex-col gap-3">
            <div className="text-[14px] font-semibold text-white/90">{col.title}</div>
            {col.links.map((l) => (
              <button
                key={l}
                type="button"
                className="text-left text-[13px] text-white/45 transition hover:text-white/80"
              >
                {l}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-4 border-t border-white/[0.06] pt-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/logo.png" alt="FizzDragon" width={439} height={78} className="h-6 w-auto" />
          <span className="text-[13px] text-white/40">© 2026 FizzDragon. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[13px] text-white/55">
            <span className="font-medium text-white/80">Trustscore 4.4</span>
            <span className="flex" style={{ color: t.price }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <IconStarFilled key={i} className="size-3.5" />
              ))}
            </span>
            <span className="text-white/40">3600+ reviews</span>
          </span>
          <span className="text-white/25">|</span>
          <div className="flex items-center gap-3 text-white/45">
            {SOCIAL.map((S, i) => (
              <S
                key={i}
                className="size-4 cursor-pointer transition hover:text-white/80"
                stroke={1.6}
              />
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
