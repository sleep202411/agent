"use client";

/**
 * Home-page chrome: the top-right header actions (with the brand wordmark on
 * the left, since the shared icon rail carries no logo), and the footer.
 * Navigation itself is the app's shared `StudioSidebar` (icon rail).
 */

import {
  IconBell,
  IconBrandDiscord,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandX,
  IconBrandYoutube,
  IconCrown,
  IconMessageCircle,
  IconStarFilled,
  type Icon,
} from "@tabler/icons-react";
import Image from "next/image";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/app/_components/auth-provider";
import { AccountMenu } from "@/app/_components/account-menu";
import { SubscriptionDialog } from "@/app/_components/subscription-dialog";
import { WorkspaceSwitcher } from "@/app/_components/workspace-switcher";
import type { Theme } from "../_pollo/theme";
import { toast } from "sonner";

const SOCIAL: Icon[] = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandYoutube,
  IconBrandDiscord,
];

export function HeaderBar() {
  // Real auth. Home mirrors the imagine.art account cluster: Upgrade,
  // workspace, message, notification, avatar. Search + Contact Sales are
  // intentionally omitted. Signed-out users keep a compact sign-in entry so the
  // public home is still usable.
  const { user, loading, signIn } = useAuth();
  const [pricingOpen, setPricingOpen] = useState(false);

  return (
    <header className="flex h-16 items-center justify-between gap-4 overflow-visible px-6 text-[14px]">
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

      <div className="flex items-center gap-2">
        {loading ? (
          <>
            <div className="h-8 w-28 animate-pulse rounded-[12px] bg-white/[0.06]" />
            <div className="h-8 w-52 animate-pulse rounded-[12px] bg-white/[0.06]" />
            <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
          </>
        ) : user ? (
          <>
            <UpgradeButton onClick={() => setPricingOpen(true)} />
            <WorkspaceSwitcher
              triggerClassName="h-8 min-w-[220px] max-w-[260px] gap-1.5 rounded-[12px] border border-[#2C263D] bg-[#15151A]/80 py-1.5 pr-2.5 pl-1.5 hover:bg-[#1B1B22]/90 data-[state=open]:bg-[#1B1B22]/90"
              avatarSize="size-5"
              avatarFallbackClassName="bg-[#744717] text-[12px] text-white"
              nameClassName="max-w-[170px] text-[14px] leading-5 font-medium text-white"
              chevronClassName="size-4 text-white/65"
            />
            <HeaderIconButton
              label="Messages"
              Icon={IconMessageCircle}
              onClick={() => toast.info("Messages are coming soon.")}
            />
            <HeaderIconButton
              label="Notifications"
              Icon={IconBell}
              onClick={() => toast.info("Notifications are coming soon.")}
            />
            <AccountMenu
              fallback="initial"
              triggerClassName="size-8 bg-[#744717] text-white hover:bg-[#86531C] data-[state=open]:bg-[#86531C] [&_span]:text-[13px]"
            />
          </>
        ) : (
          <>
            <UpgradeButton onClick={() => setPricingOpen(true)} />
            <button
              type="button"
              onClick={signIn}
              className="h-8 rounded-[12px] bg-white px-2.5 py-1.5 text-[14px] leading-5 font-medium text-black transition hover:bg-white/90"
            >
              Sign In
            </button>
          </>
        )}
      </div>

      <SubscriptionDialog open={pricingOpen} onOpenChange={setPricingOpen} />
    </header>
  );
}

function UpgradeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-[12px] bg-[#E52227] px-2.5 py-1.5 text-[14px] leading-5 font-medium text-white shadow-[0_0_18px_rgb(229_34_39/0.22)] transition hover:bg-[#c91e22]"
    >
      <IconCrown className="size-4 text-white" stroke={2} />
      Upgrade
    </button>
  );
}

function HeaderIconButton({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: Icon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full text-white transition hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:outline-none"
    >
      <Icon className="size-5" stroke={1.7} />
    </button>
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
