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
import {
  IconCircleCheck,
  IconDots,
  IconInbox,
  IconLink,
  IconMail,
  IconMessage,
  IconPlus,
  IconShare3,
  IconUserPlus,
  IconWallet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "@/src/i18n/i18n";
import type { Creator } from "@/app/(site)/creators/_hooks/use-creator";

const FALLBACK_HERO_BACKGROUND =
  "radial-gradient(circle at 18% 20%, rgba(229,34,39,0.20), transparent 34%), radial-gradient(circle at 80% 10%, rgba(245,158,11,0.10), transparent 30%), linear-gradient(135deg, #171717 0%, #0b0b0d 58%, #050506 100%)";

interface CreatorHeroProps {
  creator: Creator;
  isOwner: boolean;
  /**
   * Owner clicked the hero "+ 新建服务包" CTA. The parent owns the
   * dialog so the hero doesn't have to import the services data
   * layer; it also lets the parent flip the active tab to Services
   * on save so the user lands on the page that just changed.
   */
  onCreateService?: () => void;
  /** Owner clicked the referral-link CTA — parent generates the
   *  code and opens the referral-link share dialog. */
  onShareReferral?: () => void;
  /** Whether the referral-link generation request is in flight, so
   *  the menu item can show a spinner / disabled state. */
  referralPending?: boolean;
  /** Owner clicked "分享主页" — parent copies the public
   *  `/creators/{id}` link to clipboard. */
  onShareProfile?: () => void;
}

export function CreatorHero({
  creator,
  isOwner,
  onCreateService,
  onShareReferral,
  referralPending,
  onShareProfile,
}: CreatorHeroProps) {
  const t = useTranslations("creatorCenter");
  const name = (creator.name || "").trim() || "—";
  const bio = (creator.bio || "").trim();
  const levels = Array.isArray(creator.levels) ? creator.levels.filter((l) => !!l?.name) : [];

  return (
    <section className="relative w-full">
      {/* ─── Cover layer ─────────────────────────────────── */}
      <div
        className="absolute inset-x-0 top-0 h-[320px] overflow-hidden md:h-[360px]"
        style={creator.banner ? undefined : { background: FALLBACK_HERO_BACKGROUND }}
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
          {isOwner ? (
            <OwnerCtas
              t={t}
              onCreateService={onCreateService}
              onShareReferral={onShareReferral}
              referralPending={referralPending}
              onShareProfile={onShareProfile}
            />
          ) : (
            <VisitorCtas t={t} />
          )}
        </div>
      </div>
    </section>
  );
}

function OwnerCtas({
  t,
  onCreateService,
  onShareReferral,
  referralPending,
  onShareProfile,
}: {
  t: (k: string) => string;
  onCreateService?: () => void;
  onShareReferral?: () => void;
  referralPending?: boolean;
  onShareProfile?: () => void;
}) {
  // Secondary owner CTAs (inbox / earnings / referral / share-profile)
  // and the profile-edit affordance moved off the hero — share/inbox/
  // earnings collapse into this overflow menu, and edit lives next to
  // each editable section in the left rail. The hero now carries only
  // the single primary "+ new service" action so the band stops
  // crowding the avatar / name on common laptop widths.
  return (
    <>
      <Button type="button" variant="solid" color="primary" onClick={() => onCreateService?.()}>
        <IconPlus className="size-4" />
        {t("cta.createService")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" color="muted" aria-label={t("cta.more")}>
            <IconDots className="size-4" />
            {t("cta.more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => toast.info(t("ctaPhase1bHint"))}>
            <IconInbox className="size-4 text-muted-foreground" />
            <span>{t("cta.inbox")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toast.info(t("ctaPhase1bHint"))}>
            <IconWallet className="size-4 text-muted-foreground" />
            <span>{t("cta.earnings")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={referralPending} onSelect={() => onShareReferral?.()}>
            <IconLink className="size-4 text-muted-foreground" />
            <span>{t("cta.referralLink")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onShareProfile?.()}>
            <IconShare3 className="size-4 text-muted-foreground" />
            <span>{t("cta.shareProfile")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
