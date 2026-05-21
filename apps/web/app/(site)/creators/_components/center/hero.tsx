"use client";

/**
 * CreatorHero — the top identity band. Full-width, sits above the
 * two-column body. Carries everything that anchors the page: cover
 * image, avatar, name, level badges, bio, and the primary CTA row.
 *
 * The original design baked all of this into the left rail, but
 * that left the right column floating in a sea of dark when
 * empty. Lifting identity + CTAs into a hero gives the page a
 * "this is whose profile you're on" anchor regardless of which
 * tab is active or how full it is, and lets the left rail stay
 * laser-focused on stats + business info.
 */
import { useMemo } from "react";
import {
  IconCircleCheck,
  IconEdit,
  IconInbox,
  IconMail,
  IconMessage,
  IconPlus,
  IconUserPlus,
  IconWallet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

interface CreatorHeroProps {
  creator: Creator;
  isOwner: boolean;
}

export function CreatorHero({ creator, isOwner }: CreatorHeroProps) {
  const t = useTranslations("creatorCenter");
  const name = (creator.name || "").trim() || "—";
  const bio = (creator.bio || "").trim();
  const levels = Array.isArray(creator.levels) ? creator.levels.filter((l) => !!l?.name) : [];

  const gradient = useMemo(() => gradientFromSeed(name || "fizz"), [name]);

  return (
    <section className="relative w-full">
      {/* ─── Cover layer ─────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 h-[320px] overflow-hidden md:h-[360px]"
        style={creator.banner ? undefined : { background: gradient }}
        aria-hidden
      >
        {creator.banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={creator.banner} alt="" className="size-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-background/40 to-background" />
      </div>

      {/* ─── Hero content ────────────────────────────────── */}
      <div className="relative mx-auto flex max-w-[1680px] flex-col gap-6 px-4 pb-8 pt-[200px] md:flex-row md:items-end md:gap-8 md:px-8 md:pt-[240px]">
        {/* Identity (avatar + text) */}
        <div className="flex flex-1 flex-col items-center gap-4 text-center md:flex-row md:items-end md:gap-6 md:text-left">
          <UserAvatar
            src={creator.avatar}
            seed={creator.id}
            name={name}
            className="size-28 shrink-0 rounded-full ring-4 ring-background md:size-32"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {name}
              </h1>
              {levels.slice(0, 3).map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary"
                >
                  <IconCircleCheck className="size-3" />
                  {l.name}
                </span>
              ))}
            </div>
            {bio ? (
              <p className="line-clamp-2 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                {bio}
              </p>
            ) : null}
          </div>
        </div>

        {/* CTA cluster */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 md:justify-end">
          {isOwner ? <OwnerCtas t={t} /> : <VisitorCtas t={t} />}
        </div>
      </div>
    </section>
  );
}

function OwnerCtas({ t }: { t: (k: string) => string }) {
  return (
    <>
      <Button
        type="button"
        variant="solid"
        color="primary"
        onClick={() => toast.info(t("ctaPhase1aHint"))}
      >
        <IconPlus className="size-4" />
        {t("cta.createService")}
      </Button>
      <Button
        type="button"
        variant="outline"
        color="muted"
        onClick={() => toast.info(t("ctaPhase1bHint"))}
      >
        <IconInbox className="size-4" />
        {t("cta.inbox")}
      </Button>
      <Button
        type="button"
        variant="outline"
        color="muted"
        onClick={() => toast.info(t("ctaPhase1bHint"))}
      >
        <IconWallet className="size-4" />
        {t("cta.earnings")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        color="muted"
        onClick={() => toast.info(t("ctaEditComingSoon"))}
      >
        <IconEdit className="size-4" />
        {t("cta.editProfile")}
      </Button>
    </>
  );
}

function VisitorCtas({ t }: { t: (k: string) => string }) {
  return (
    <>
      <Button
        type="button"
        variant="solid"
        color="primary"
        onClick={() => toast.info(t("ctaPhase1bHint"))}
      >
        <IconUserPlus className="size-4" />
        {t("cta.startRequest")}
      </Button>
      <Button
        type="button"
        variant="outline"
        color="muted"
        onClick={() => toast.info(t("ctaPhase1bHint"))}
      >
        <IconMessage className="size-4" />
        {t("cta.message")}
      </Button>
      <Button
        type="button"
        variant="outline"
        color="muted"
        onClick={() => toast.info(t("ctaFollowComingSoon"))}
      >
        <IconMail className="size-4" />
        {t("cta.follow")}
      </Button>
    </>
  );
}

function gradientFromSeed(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 47) % 360;
  return `linear-gradient(135deg, hsl(${hue} 60% 22%) 0%, hsl(${hue2} 50% 14%) 60%, hsl(0 0% 8%) 100%)`;
}
