"use client";

/** Shared owner/public portfolio. IP is first per stage-modification Slide 26.
 * Service packages are available here and at /profile/services.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeUserId } from "@/src/lib/user-id-codec";
import { IconCheck, IconCopy, IconLoader2 } from "@tabler/icons-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useCurrentUser, useReferralCode, useUserInfo } from "@/src/hooks/use-user";
import { useCreatorDetail, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { ProfileEditDialog } from "@/app/(site)/profile/profile-edit-dialog";
import { CreatorHero } from "./hero";
import { CreatorLeftRail } from "./left-rail";
import {
  CreatorTabBar,
  CREATOR_TAB_ORDER,
  CREATOR_SECTION_ID,
  CREATOR_TAB_ID,
  type CreatorTabId,
} from "./tab-bar";
import { AccountSecurityDialog } from "./dialogs/account-security-dialog";
import { WorksTab } from "./tabs/works-tab";
import { CertificatesTab } from "./tabs/certificates-tab";
import { IpsTab } from "./tabs/ips-tab";
import { CrewsTab } from "./tabs/crews-tab";
import { ServicesTab } from "./tabs/services-tab";
import { PublicStudioServices } from "./public-studio-services";

export interface CreatorCenterProps {
  /** Creator userId to render. For the owner self-view this is the
   *  logged-in user's id; for the visitor view it's the URL param. */
  creatorId: string;
}

const DEFAULT_TAB: CreatorTabId = "ips";

/** Public creator page: always renders the complete scrollable profile. */
export function CreatorCenter({ creatorId }: CreatorCenterProps) {
  return <SharedCreatorCenterLayout creatorId={creatorId} contentMode="sections" />;
}

interface SharedCreatorCenterLayoutProps extends CreatorCenterProps {
  contentMode: "sections" | "tabs";
}

/**
 * Shared profile data, hero, rail, and dialogs. Route-owned components choose
 * the right-pane presentation so public pages cannot accidentally opt into
 * creator-center-only behavior.
 */
export function SharedCreatorCenterLayout({
  creatorId,
  contentMode,
}: SharedCreatorCenterLayoutProps) {
  const t = useTranslations("creatorCenter");
  const locale = useLocale() as Locale;
  const { user: currentUser } = useCurrentUser();
  const { data: creator, isLoading } = useCreatorDetail(creatorId);

  // Owner detection. The Java userId comes back as a number on the
  // wire, but `currentUser.id` is the string projection — coerce both
  // sides through String() for a clean equality.
  const isOwner = useMemo(
    () => Boolean(currentUser && String(currentUser.id) === String(creatorId)),
    [currentUser, creatorId]
  );

  // Public pages use `activeTab` as a scrollspy highlight while `/profile`
  // uses it as real panel state. Keeping the mode route-driven prevents a
  // signed-in owner visiting their public URL from changing that page's
  // presentation.
  const [activeTab, setActiveTab] = useState<CreatorTabId>(DEFAULT_TAB);
  const sectionRefs = useRef<Partial<Record<CreatorTabId, HTMLElement | null>>>({});

  const handlePickTab = useCallback(
    (id: CreatorTabId) => {
      setActiveTab(id);
      if (contentMode === "tabs") return;
      const el = sectionRefs.current[id];
      if (!el) return;
      // 60px = tab bar sticky height; pad so the section title isn't
      // hidden underneath.
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "smooth" });
    },
    [contentMode]
  );

  useEffect(() => {
    if (contentMode !== "sections") return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with greatest intersectionRatio that's still
        // intersecting; ties break by document order via TAB_ORDER.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const id = (visible.target as HTMLElement).dataset.sectionId as CreatorTabId | undefined;
        if (id) setActiveTab(id);
      },
      {
        // Section becomes "current" once its top crosses ~25% from the
        // viewport top; gives the tab bar enough lead time to flip.
        rootMargin: "-25% 0px -60% 0px",
        threshold: [0, 0.1, 0.25, 0.5],
      }
    );
    for (const id of CREATOR_TAB_ORDER) {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [contentMode]);

  // Edit-profile + referral are owner-only and share state pattern
  // with /profile (the original location). We reuse ProfileEditDialog
  // verbatim and inline a small share-link dialog here so we don't
  // have to import the whole profile-header — it carries cover/avatar
  // uploads that this hero already handles its own way.
  const { data: userInfo } = useUserInfo();
  const { mutate: doGetReferralCode, isPending: referralPending } = useReferralCode();
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralLink, setReferralLink] = useState("");
  const [referralQrDataUrl, setReferralQrDataUrl] = useState("");
  const [referralCopied, setReferralCopied] = useState(false);
  const visibleReferralQrDataUrl = referralLink ? referralQrDataUrl : "";

  // Regenerate the share QR whenever the link changes. Same pattern as
  // profile-header.tsx — inline data-uri PNG so we don't depend on any
  // image host and the QR refreshes per session.
  useEffect(() => {
    if (!referralLink) return;
    let cancelled = false;
    QRCode.toDataURL(referralLink, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: { dark: "#0a0a0b", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setReferralQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setReferralQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [referralLink]);

  const tp = useTranslations("profile");

  const handleShareReferral = () => {
    doGetReferralCode(undefined, {
      onSuccess: (code) => {
        const link = `${window.location.origin}/register?recommendationCode=${code}`;
        setReferralLink(link);
        setReferralCopied(false);
        setReferralOpen(true);
      },
      onError: () => toast.error(tp("referralLinkFailed")),
    });
  };

  // Share public profile link: copy `${origin}/{locale}/creators/{id}` to
  // clipboard so the owner can paste it anywhere (chat, social, business
  // card). No dialog — single click → toast.
  const handleShareProfile = async () => {
    const url = `${window.location.origin}${localizePath(`/creators/${encodeUserId(creatorId)}`, locale)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("cta.shareProfileCopied"));
    } catch {
      toast.error(t("cta.shareProfileManualCopy", { url }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="flex h-[calc(100dvh-56px)] items-center justify-center px-6 text-center">
        <div className="flex max-w-md flex-col items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{t("notFoundTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("notFoundDesc")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-56px)] bg-background text-foreground">
      <CreatorHero
        creator={creator}
        isOwner={isOwner}
        onShareReferral={isOwner ? handleShareReferral : undefined}
        referralPending={referralPending}
        onShareProfile={isOwner ? handleShareProfile : undefined}
      />
      <div className="mx-auto grid max-w-[1680px] gap-6 px-4 pb-16 md:px-8 lg:grid-cols-[360px_1fr]">
        <CreatorLeftRail
          creator={creator}
          isOwner={isOwner}
          onEditProfile={isOwner ? () => setEditProfileOpen(true) : undefined}
          onOpenSecurity={isOwner ? () => setSecurityOpen(true) : undefined}
        />
        <main className="min-w-0">
          {/* Public pages use this as an anchor menu. `/profile` supplies
              `contentMode="tabs"`, where it controls the single rendered
              panel instead. */}
          <div>
            <CreatorTabBar active={activeTab} mode={contentMode} onPick={handlePickTab} />
          </div>
          {contentMode === "tabs" ? (
            <div className="mt-6">
              <section
                id={CREATOR_SECTION_ID(activeTab)}
                role="tabpanel"
                aria-labelledby={CREATOR_TAB_ID(activeTab)}
              >
                <SectionContent
                  tab={activeTab}
                  creator={creator}
                  isOwner={isOwner}
                  contentMode={contentMode}
                />
              </section>
            </div>
          ) : (
            <div className="mt-6 space-y-12">
              {CREATOR_TAB_ORDER.map((id) => (
                <section
                  key={id}
                  id={CREATOR_SECTION_ID(id)}
                  data-section-id={id}
                  ref={(el) => {
                    sectionRefs.current[id] = el;
                  }}
                  // scroll-mt = sticky bar height + breathing room; matches
                  // the offset handlePickTab uses so anchored navigation
                  // lands at the same place every time.
                  className="scroll-mt-24"
                >
                  {/* Section heading mirrors the tab label so users scrolling
                      past the tab bar still see what section they're in. */}
                  <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
                    {t(`tabs.${id}`)}
                  </h2>
                  <SectionContent
                    tab={id}
                    creator={creator}
                    isOwner={isOwner}
                    contentMode={contentMode}
                  />
                </section>
              ))}
            </div>
          )}
        </main>
      </div>

      {isOwner ? (
        <>
          <ProfileEditDialog
            open={editProfileOpen}
            onOpenChange={setEditProfileOpen}
            userInfo={userInfo ?? null}
          />
          <AccountSecurityDialog open={securityOpen} onOpenChange={setSecurityOpen} />
          <Dialog open={referralOpen} onOpenChange={setReferralOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{tp("referralLinkTitle")}</DialogTitle>
                <DialogDescription>{tp("referralLinkDesc")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 p-4">
                {visibleReferralQrDataUrl ? (
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={visibleReferralQrDataUrl}
                      alt={tp("referralLinkTitle")}
                      className="size-44 rounded-lg bg-white p-2"
                    />
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={referralLink}
                    className="h-10 flex-1 rounded-lg border border-border bg-muted px-3 text-sm text-foreground"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    size="sm"
                    variant={referralCopied ? "outline" : "solid"}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(referralLink);
                        setReferralCopied(true);
                        toast.success(tp("referralLinkCopied"));
                      } catch {
                        toast.error(tp("referralLinkManualCopy"));
                      }
                    }}
                  >
                    {referralCopied ? (
                      <IconCheck className="size-4" />
                    ) : (
                      <IconCopy className="size-4" />
                    )}
                    {referralCopied ? tp("copied") : tp("copy")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

function SectionContent({
  tab,
  creator,
  isOwner,
  contentMode,
}: {
  tab: CreatorTabId;
  creator: Creator;
  isOwner: boolean;
  contentMode: "sections" | "tabs";
}) {
  switch (tab) {
    case "services":
      return contentMode === "sections" ? (
        <PublicStudioServices creator={creator} />
      ) : (
        <ServicesTab creator={creator} isOwner={isOwner} />
      );
    case "works":
      return <WorksTab creator={creator} isOwner={isOwner} />;
    case "certificates":
      return <CertificatesTab creator={creator} isOwner={isOwner} />;
    case "ips":
      return <IpsTab creator={creator} isOwner={isOwner} />;
    case "crews":
      return (
        <CrewsTab
          creator={creator}
          isOwner={isOwner}
          variant={contentMode === "tabs" ? "profile" : "public"}
        />
      );
  }
}
