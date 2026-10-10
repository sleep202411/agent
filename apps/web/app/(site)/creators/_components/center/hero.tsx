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
import Link from "next/link";
import { CREATOR_SECTION_ID } from "./tab-bar";
import { creatorQualificationKind } from "@/src/services/creator-qualification";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconCamera,
  IconCircleCheck,
  IconDots,
  IconInbox,
  IconLink,
  IconLoader2,
  IconShare3,
  IconWallet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { useUploadAvatar } from "@/src/hooks/use-user";
import { type Creator } from "@/app/(site)/creators/_hooks/use-creator";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

const FALLBACK_HERO_BACKGROUND =
  "radial-gradient(circle at 18% 20%, rgba(229,34,39,0.20), transparent 34%), radial-gradient(circle at 80% 10%, rgba(245,158,11,0.10), transparent 30%), linear-gradient(135deg, #171717 0%, #0b0b0d 58%, #050506 100%)";

interface CreatorHeroProps {
  creator: Creator;
  isOwner: boolean;
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
  onShareReferral,
  referralPending,
  onShareProfile,
}: CreatorHeroProps) {
  const t = useTranslations("creatorCenter");
  const name = (creator.name || "").trim() || "—";
  const bio = (creator.bio || "").trim();
  const levels = (Array.isArray(creator.levels) ? creator.levels : [])
    .filter((level) => level?.name && creatorQualificationKind(level))
    .sort(
      (left, right) =>
        Number(creatorQualificationKind(right) === "producer") -
        Number(creatorQualificationKind(left) === "producer")
    );

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
          {isOwner ? (
            <HeroAvatarUploader creator={creator} name={name} />
          ) : (
            <UserAvatar
              src={creator.avatar}
              seed={creator.id}
              name={name}
              className="size-28 shrink-0 rounded-full ring-4 ring-background md:size-32"
            />
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                {name}
              </h1>
              {levels.map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-foreground/80"
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
  onShareReferral,
  referralPending,
  onShareProfile,
}: {
  t: (k: string) => string;
  onShareReferral?: () => void;
  referralPending?: boolean;
  onShareProfile?: () => void;
}) {
  const locale = useLocale() as Locale;
  return (
    <>
      <Button variant="outline" color="muted" asChild>
        <Link href={localizePath("/profile/earnings", locale)}>
          <IconWallet className="size-4" />
          {t("cta.earnings")}
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" color="muted" aria-label={t("cta.more")}>
            <IconDots className="size-4" />
            {t("cta.more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem asChild>
            <Link href={localizePath("/profile/services", locale)}>{t("cta.manageServices")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={localizePath("/messages", locale)}>
              <IconInbox className="size-4 text-muted-foreground" />
              <span>{t("cta.inbox")}</span>
            </Link>
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
  // Requests and first contact require a service context. Let visitors choose
  // a real package before entering its existing request/message workflow.
  return (
    <Button variant="solid" color="primary" asChild>
      <a href={`#${CREATOR_SECTION_ID("services")}`}>{t("cta.viewServices")}</a>
    </Button>
  );
}

/**
 * Owner-only clickable avatar with a hover camera overlay. Upload commits
 * directly via /user/uploadAratar; the user-info query invalidates on
 * success so the avatar re-renders without any local state. Visitor view
 * keeps the plain read-only UserAvatar and never mounts this component.
 */
function HeroAvatarUploader({ creator, name }: { creator: Creator; name: string }) {
  const tp = useTranslations("profile");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAvatar = useUploadAvatar();
  const queryClient = useQueryClient();
  const uploading = uploadAvatar.isPending;

  const handleClick = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(tp("pleaseUploadImage"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error(tp("avatarSizeLimit"));
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      // useUploadAvatar invalidates the user-info query, but the hero
      // reads from useCreatorDetail(creatorId), which is a separate
      // cache entry. Without this the avatar shown here stays stale
      // until next route load / page refresh.
      await queryClient.invalidateQueries({
        queryKey: ["creator", "detail", creator.id],
      });
      toast.success(tp("avatarUpdated"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || tp("avatarUploadFailed"));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={uploading}
        aria-label={tp("avatarChange")}
        className="group relative size-28 shrink-0 overflow-hidden rounded-full outline-none ring-4 ring-background transition-all hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait md:size-32"
      >
        <UserAvatar src={creator.avatar} seed={creator.id} name={name} className="size-full" />
        {/* Overlay: forced visible while uploading so the spinner is
            always shown, otherwise revealed only on hover. */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity",
            uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          {uploading ? (
            <IconLoader2 className="size-7 animate-spin text-white" />
          ) : (
            <IconCamera className="size-7 text-white" />
          )}
        </div>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </>
  );
}
