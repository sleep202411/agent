"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  IconBell,
  IconCrown,
  IconMessageCircle,
  IconPhone,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StudioAccountMenu } from "@/components/studio-account-menu";
import { UpgradeDialog } from "@/components/payment/upgrade-dialog";
import { setApiWorkspaceId } from "@/src/lib/api";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { useEnsureDefaultWorkspace, useWorkspaces } from "../../_hooks/use-workspace";
import type { FizzWorkspace } from "../../_lib/api";
import { ComputeTopupButton } from "./compute-topup-dialog";
import { FizzStudioSidebar } from "./fizzstudio-sidebar";
import { WorkspaceSwitcher } from "./workspace-switcher";

export type FizzStudioWorkspaceState = {
  activeWorkspaceId: string;
  currentLocale: Locale;
  isWorkspaceLoading: boolean;
  setActiveWorkspaceId: (id: string) => void;
  workspaceId: string;
  workspaces: FizzWorkspace[];
};

export function useFizzStudioWorkspace(initialWorkspaceId = ""): FizzStudioWorkspaceState {
  const locale = useLocale();
  const currentLocale = locale as Locale;
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(initialWorkspaceId);
  const bootstrappedRef = useRef(false);

  const ensureWs = useEnsureDefaultWorkspace();
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    ensureWs.mutate(undefined, {
      onSuccess: (ws) => {
        setActiveWorkspaceId((prev) => prev || ws.id);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: workspaces = [], isLoading } = useWorkspaces();
  const workspaceId = activeWorkspaceId || workspaces[0]?.id || "";

  return {
    activeWorkspaceId,
    currentLocale,
    isWorkspaceLoading: isLoading,
    setActiveWorkspaceId,
    workspaceId,
    workspaces,
  };
}

export function FizzStudioShell({
  children,
  className,
  footer,
  headerVariant = "studio",
  mainClassName,
  sidebarVariant = "studio",
  workspaceState,
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  headerVariant?: "enterprise" | "studio";
  mainClassName?: string;
  sidebarVariant?: "enterprise" | "studio";
  workspaceState: FizzStudioWorkspaceState;
}) {
  const isEnterprise = sidebarVariant === "enterprise";

  useLayoutEffect(() => {
    setApiWorkspaceId(workspaceState.workspaceId || null);
    return () => setApiWorkspaceId(null);
  }, [workspaceState.workspaceId]);

  return (
    <div
      className={cn(
        "min-h-screen bg-[#0f0f10] text-white",
        headerVariant === "studio" && "pb-36",
        className
      )}
    >
      <FizzStudioSidebar variant={sidebarVariant} />

      <div className="min-w-0 lg:pl-[72px]">
        <StudioHeader
          activeWorkspaceId={workspaceState.workspaceId}
          currentLocale={workspaceState.currentLocale}
          variant={headerVariant}
          onSwitchWorkspace={workspaceState.setActiveWorkspaceId}
        />

        <main
          className={cn(
            isEnterprise ? "w-full max-w-none" : "mx-auto max-w-[1480px] px-4 pt-8 sm:px-6 xl:px-8",
            mainClassName
          )}
        >
          {children}
        </main>
      </div>

      {footer}
    </div>
  );
}

function StudioHeader({
  currentLocale,
  activeWorkspaceId,
  variant,
  onSwitchWorkspace,
}: {
  activeWorkspaceId: string;
  currentLocale: Locale;
  variant: "enterprise" | "studio";
  onSwitchWorkspace: (id: string) => void;
}) {
  const t = useTranslations("fizzStudio");
  const searchParams = useSearchParams();
  const upgradeParam = searchParams.get("upgrade");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Search still needs an agreed scope; inbox links use the platform message center.
  const comingSoon = (label: string) => toast.info(t("shell.comingSoon", { label }));

  useEffect(() => {
    if (upgradeParam !== "1") return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setUpgradeOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [upgradeParam]);

  if (variant === "enterprise") {
    return (
      <header className="sticky top-0 z-40 bg-transparent">
        <div className="flex h-16 items-center justify-end gap-4 px-4 sm:px-5">
          <Link
            href={localizePath("/fizzstudio", currentLocale)}
            aria-label={t("brand")}
            className="mr-auto flex shrink-0 items-center"
          >
            <Image
              src="/logo.png"
              alt="FizzDragon"
              width={439}
              height={78}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="relative hidden h-10 items-center gap-2 rounded-[20px] bg-[#3b1b61] px-4 text-sm font-semibold text-[#e8d7ff] shadow-[0_18px_42px_rgba(0,0,0,0.34)] transition-colors hover:bg-[#4a2378] sm:inline-flex"
          >
            <IconCrown className="size-4 fill-[#d8b8ff] text-[#d8b8ff]" />
            {t("shell.upgrade")}
            <span className="absolute left-1/2 top-[calc(100%-6px)] -translate-x-1/2 rounded-full bg-[#ff1493] px-2.5 py-0.5 text-xs font-black leading-5 text-white shadow-[0_10px_24px_rgba(255,20,147,0.28)]">
              {t("shell.upgradeDiscount")}
            </span>
          </button>

          <ComputeTopupButton variant="enterprise" />

          <WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} onSwitch={onSwitchWorkspace} />

          <Link
            href={localizePath("/messages", currentLocale)}
            aria-label={t("shell.chat")}
            className="flex size-9 items-center justify-center text-white transition-colors hover:text-white/72"
          >
            <IconMessageCircle className="size-5 fill-white" stroke={1.9} />
          </Link>

          <Link
            href={localizePath("/messages?tab=notifications", currentLocale)}
            aria-label={t("shell.notifications")}
            className="flex size-9 items-center justify-center text-white transition-colors hover:text-white/72"
          >
            <IconBell className="size-5" stroke={1.9} />
          </Link>

          <StudioAccountMenu
            className="ml-0"
            showStatusDot={false}
            showStoreButton={false}
            triggerMode="avatar"
          />
        </div>
        <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#0f0f10]/92 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={localizePath("/fizzstudio", currentLocale)}
            className="flex shrink-0 items-center gap-2.5 lg:hidden"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#111]">
              <IconSparkles className="size-4" />
            </span>
            <span className="text-base font-semibold">{t("brand")}</span>
          </Link>
          <div className="hidden lg:block" />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-label={t("shell.search")}
            onClick={() => comingSoon(t("shell.search"))}
            className="flex size-10 items-center justify-center rounded-full text-white/54 transition-colors hover:bg-white/8 hover:text-white"
          >
            <IconSearch className="size-5" />
          </button>

          <a
            href="mailto:business@fizzdragon.com"
            className="hidden h-10 items-center gap-2 rounded-full bg-[#242426] px-4 text-sm font-semibold text-white/86 transition-colors hover:bg-[#2d2d30] hover:text-white sm:inline-flex"
          >
            <IconPhone className="size-4" />
            {t("shell.contactSales")}
          </a>

          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="hidden h-10 items-center gap-2 rounded-full bg-[#3d1b66] px-4 text-sm font-semibold text-[#dec6ff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-[#4c2480] hover:text-white sm:inline-flex"
          >
            <IconCrown className="size-4 fill-[#d8b7ff] text-[#d8b7ff]" />
            {t("shell.upgrade")}
          </button>

          <ComputeTopupButton variant="studio" />

          <WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} onSwitch={onSwitchWorkspace} />

          <Link
            href={localizePath("/messages", currentLocale)}
            aria-label={t("shell.chat")}
            className="flex size-10 items-center justify-center rounded-full text-white/54 transition-colors hover:bg-white/8 hover:text-white"
          >
            <IconMessageCircle className="size-5" />
          </Link>

          <Link
            href={localizePath("/messages?tab=notifications", currentLocale)}
            aria-label={t("shell.notifications")}
            className="flex size-10 items-center justify-center rounded-full text-white/54 transition-colors hover:bg-white/8 hover:text-white"
          >
            <IconBell className="size-5" />
          </Link>

          <StudioAccountMenu className="ml-1" showStoreButton={false} triggerMode="avatar" />
        </div>
      </div>
      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </header>
  );
}
