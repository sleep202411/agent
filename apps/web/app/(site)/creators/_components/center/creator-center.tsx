"use client";

/**
 * CreatorCenter — unified profile page layout. Same shell renders for:
 *
 *   - `/creators/[id]`  (public visit, any creator)
 *   - `/profile` (or `/creators/<self>`)  (owner self-view; same
 *     URL would also work, just bounces through `/profile`)
 *
 * The layout (per 2026-05-21 product spec, modelled after the
 * 新片场 creator profile reference):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  HERO  cover · avatar · name · level · bio · primary CTAs   │
 *   ├──────────────┬──────────────────────────────────────────────┤
 *   │ left rail    │  tab bar: 服务包 / 作品 / IP / 剧组 / 关于   │
 *   │ stats        ├──────────────────────────────────────────────┤
 *   │ business     │  active-tab content                          │
 *   │ info         │                                              │
 *   └──────────────┴──────────────────────────────────────────────┘
 *
 * Hero is full-width and capped at 1680px on large screens; the
 * body grid below sits inside the same 1680px container.
 *
 * Visitor sees: 关注 / 私信 / 下单 CTAs in the hero.
 * Owner sees:  编辑资料 / + 服务包 / 收件箱 / 收益 in the hero.
 *
 * Service packages tab is the **primary commercial entry** and
 * therefore the default-selected tab — see doc § 10.1 "do not turn
 * this into a resume wall". Until the Phase 1a backend ships, the
 * tab renders an owner-side "create your first service" empty
 * state and (for visitors) a "this creator hasn't published a
 * service yet" message.
 */
import { useMemo, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useCreatorDetail, type Creator } from "@/app/(site)/creators/_hooks/use-creator";
import { CreatorHero } from "./hero";
import { CreatorLeftRail } from "./left-rail";
import { CreatorTabBar, type CreatorTabId } from "./tab-bar";
import { ServicesTab } from "./tabs/services-tab";
import { WorksTab } from "./tabs/works-tab";
import { IpsTab } from "./tabs/ips-tab";
import { CrewsTab } from "./tabs/crews-tab";
import { AboutTab } from "./tabs/about-tab";

export interface CreatorCenterProps {
  /** Creator userId to render. For the owner self-view this is the
   *  logged-in user's id; for the visitor view it's the URL param. */
  creatorId: string;
}

const DEFAULT_TAB: CreatorTabId = "services";

export function CreatorCenter({ creatorId }: CreatorCenterProps) {
  const t = useTranslations("creatorCenter");
  const { user: currentUser } = useCurrentUser();
  const { data: creator, isLoading } = useCreatorDetail(creatorId);

  // Owner detection. The Java userId comes back as a number on the
  // wire, but `currentUser.id` is the string projection — coerce both
  // sides through String() for a clean equality.
  const isOwner = useMemo(
    () => Boolean(currentUser && String(currentUser.id) === String(creatorId)),
    [currentUser, creatorId]
  );

  const [activeTab, setActiveTab] = useState<CreatorTabId>(DEFAULT_TAB);

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
      <CreatorHero creator={creator} isOwner={isOwner} />
      <div className="mx-auto grid max-w-[1680px] gap-6 px-4 pb-16 md:px-8 lg:grid-cols-[300px_1fr]">
        <CreatorLeftRail creator={creator} isOwner={isOwner} />
        <main className="min-w-0">
          <CreatorTabBar value={activeTab} onChange={setActiveTab} />
          <div className="mt-6">
            <ActiveTabContent tab={activeTab} creator={creator} isOwner={isOwner} />
          </div>
        </main>
      </div>
    </div>
  );
}

function ActiveTabContent({
  tab,
  creator,
  isOwner,
}: {
  tab: CreatorTabId;
  creator: Creator;
  isOwner: boolean;
}) {
  switch (tab) {
    case "services":
      return <ServicesTab creator={creator} isOwner={isOwner} />;
    case "works":
      return <WorksTab creator={creator} isOwner={isOwner} />;
    case "ips":
      return <IpsTab creator={creator} isOwner={isOwner} />;
    case "crews":
      return <CrewsTab creator={creator} isOwner={isOwner} />;
    case "about":
      return <AboutTab creator={creator} isOwner={isOwner} />;
  }
}
