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
import { useTranslations } from "next-intl";
import type { Theme } from "../_pollo/theme";

const SOCIAL: Icon[] = [
  IconBrandX,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandYoutube,
  IconBrandDiscord,
];

export function Footer({ theme: t }: { theme: Theme }) {
  const th = useTranslations("home");
  const tc = useTranslations("common");

  return (
    <footer className="mt-24 px-6 pt-12 pb-10">
      {/* Model/tool link directory hidden for now (FOOTER_COLS retained above). */}
      <div className="flex flex-col gap-4 border-t border-white/[0.06] pt-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Image
            src="/logo.png"
            alt={tc("fizzDragon")}
            width={439}
            height={78}
            className="h-6 w-auto"
          />
          <span className="text-[13px] text-white/40">{th("footer.copyright")}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[13px] text-white/55">
            <span className="font-medium text-white/80">{th("footer.trustScore")}</span>
            <span className="flex" style={{ color: t.price }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <IconStarFilled key={i} className="size-3.5" />
              ))}
            </span>
            <span className="text-white/40">{th("footer.reviewCount")}</span>
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
