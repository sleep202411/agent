"use client";

/**
 * Home-page chrome: the footer. The header moved to the shared
 * `LandingHeader` (app/_components/landing-header.tsx), mounted by the
 * (landing) layout; navigation is the app's shared `StudioSidebar`.
 */

import {
  IconBrandDiscord,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandX,
  IconBrandYoutube,
  IconStarFilled,
  type Icon,
} from "@tabler/icons-react";
import Image from "next/image";
import type { Theme } from "../_pollo/theme";

const SOCIAL: Icon[] = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandYoutube,
  IconBrandDiscord,
];

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- link directory hidden for now; data retained
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
      {/* Model/tool link directory hidden for now (FOOTER_COLS retained above). */}
      <div className="flex flex-col gap-4 border-t border-white/[0.06] pt-6 md:flex-row md:items-center md:justify-between">
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
