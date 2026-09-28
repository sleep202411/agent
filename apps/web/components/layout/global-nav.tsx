"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { CommunityCreditsChip } from "@/components/layout/community-credits-chip";
import { BellButton } from "@/components/notifications/bell-button";
import { UserAvatar } from "@/components/user-avatar";
import { ShinyText } from "@/components/ui/shiny-text";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser, type CurrentUser } from "@/src/hooks/use-user";
import { useLogout } from "@/src/hooks/use-logout";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useTranslations, useLocale, setLanguage } from "@/src/i18n/i18n";
import { setCurrentLocale, localizePath, stripLocalePrefix } from "@/src/i18n/locale-url";
import { LOCALE_OPTIONS, type Locale } from "@/src/i18n/config";
import { getStudioHref } from "@/src/lib/region/cell";
import { AppDownloadMenu, APP_DOWNLOADS } from "./app-download-menu";
import { encodeUserId } from "@/src/lib/user-id-codec";
import {
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconLanguage,
  IconLogout,
  IconMessageCircle,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useInbox } from "@/app/(site)/creators/_hooks/use-conversations";
import { cn } from "@/lib/utils";
import styles from "./global-nav.module.css";

const HIDDEN_PATTERNS = ["/editor"];
const USER_GUIDE_URL = "https://flowus.cn/share/cca82279-3553-47eb-beea-f71bc4cfb5c6?code=81LL9V";

function navCx(...values: Array<string | false | null | undefined>) {
  return cn(
    ...values.map((value) => {
      if (!value) return value;
      return value
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => styles[token] ?? token)
        .join(" ");
    })
  );
}

type NavItem = {
  href: string;
  linkHref?: string;
  label: string;
  requiresAuth?: boolean;
  external?: boolean;
};

export function GlobalNav() {
  const pathname = usePathname() ?? "/";
  const normalizedPathname = stripLocalePrefix(pathname);
  const router = useRouter();
  const t = useTranslations("nav");
  const commonT = useTranslations("common");
  const locale = useLocale() as Locale;

  const { user } = useCurrentUser();
  const logout = useLogout();
  // "Get started" opens the sign-in dialog over whatever the visitor is
  // reading instead of navigating to /login and losing the page. The
  // /login URL still exists for the proxy, deep links and the mobile
  // WebView — it just isn't how the nav asks any more.
  const { open: openAuthDialog } = useAuthDialog();

  const headerRef = useRef<HTMLElement | null>(null);
  const navListRef = useRef<HTMLUListElement | null>(null);
  const navLinkRefs = useRef<Array<HTMLElement | null>>([]);

  const [mobileDrawer, setMobileDrawer] = useState(() => ({
    pathname,
    open: false,
  }));
  const [hoveredNavIndex, setHoveredNavIndex] = useState<number | null>(null);

  const mobileOpen = mobileDrawer.pathname === pathname && mobileDrawer.open;
  const closeMobile = () => setMobileDrawer({ pathname, open: false });
  const toggleMobile = () =>
    setMobileDrawer((state) => ({
      pathname,
      open: !(state.pathname === pathname && state.open),
    }));

  const navItems: NavItem[] = [
    { href: "/ips", label: t("ipPlaza") },
    { href: "/games", label: t("games") },
    { href: "/crews", label: t("studioHall") },
    { href: "/creators", label: t("creators") },
    {
      href: "/courses",
      label: t("course"),
      requiresAuth: true,
    },
    { href: "/news", label: t("news") },
  ];

  const ctaItem: NavItem = {
    href: "/art-studio",
    linkHref: getStudioHref(locale),
    label: t("fizzStudio"),
    // No web-side auth gate: FizzStudio is a standalone app on its own subdomain
    // (getStudioHref → https://studio.fizzspace.cn/...). Let visitors go straight
    // there and let studio handle its own login — gating here would build a
    // /login?redirect=/art-studio bounce to the retired in-web studio path.
  };

  const isActive = (href: string) =>
    !href.startsWith("http") && !href.startsWith("mailto:") && normalizedPathname.startsWith(href);

  const activeNavIndex = navItems.findIndex((item) => isActive(item.href));
  const markerIndex = hoveredNavIndex ?? (activeNavIndex === -1 ? null : activeNavIndex);
  const [navMarker, setNavMarker] = useState({ x: 0, visible: false });

  const itemHref = (item: NavItem) =>
    item.linkHref ?? (item.external ? item.href : localizePath(item.href, locale));

  const ctaHref = itemHref(ctaItem);
  const ctaOpensNewTab = ctaHref.startsWith("http");

  const onNavClick = (e: React.MouseEvent<HTMLAnchorElement>, item: NavItem) => {
    if (!item.requiresAuth) return;
    if (user) return;
    e.preventDefault();
    router.push(`/login?redirect=${encodeURIComponent(item.href)}`);
  };

  const switchLocale = (next: Locale) => {
    if (next === locale) return;
    setCurrentLocale(next);
    setLanguage(next);
    router.replace(
      localizePath(stripLocalePrefix(pathname), next) +
        window.location.search +
        window.location.hash
    );
  };

  useGSAP(
    () => {
      if (!headerRef.current) return;
      gsap.to(headerRef.current, { opacity: 1, duration: 0.2, ease: "linear" });
    },
    { scope: headerRef }
  );

  useEffect(() => {
    const updateMarker = () => {
      const list = navListRef.current;
      const link = markerIndex === null ? null : navLinkRefs.current[markerIndex];

      if (!list || !link) {
        setNavMarker((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }

      const listRect = list.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const x = linkRect.left - listRect.left + linkRect.width / 2;
      setNavMarker({ x, visible: true });
    };

    updateMarker();
    window.addEventListener("resize", updateMarker);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateMarker);
      if (navListRef.current) resizeObserver.observe(navListRef.current);
      const activeLink = markerIndex === null ? null : navLinkRefs.current[markerIndex];
      if (activeLink) resizeObserver.observe(activeLink);
    }

    return () => {
      window.removeEventListener("resize", updateMarker);
      resizeObserver?.disconnect();
    };
  }, [markerIndex, locale]);

  const shouldHide = HIDDEN_PATTERNS.some((pattern) => pathname.includes(pattern));
  if (shouldHide) return null;

  return (
    <header
      ref={headerRef}
      className={navCx("fd-secret-header")}
      data-mobile-open={mobileOpen ? "true" : "false"}
      style={{ opacity: 0 }}
    >
      <SecretGlassFilter />

      <Link
        href={localizePath("/", locale)}
        className={navCx("fd-secret-wordmark fd-secret-standalone-wordmark js-header-logotype")}
        aria-label="FizzDragon"
      >
        <Image src="/logo.png" alt="FizzDragon" width={439} height={78} priority />
      </Link>

      <nav
        className={navCx(
          "fd-secret-glass-wrapper fd-secret-nav-shell hidden md:flex js-header-nav"
        )}
        aria-label="Primary"
      >
        <span className={navCx("fd-secret-glass-effect")} aria-hidden />
        <div className={navCx("fd-secret-glass-content fd-secret-nav-content")}>
          <Link
            href={localizePath("/", locale)}
            className={navCx("fd-secret-nav-wordmark")}
            aria-label="FizzDragon"
          >
            <Image src="/logo.png" alt="FizzDragon" width={439} height={78} priority />
          </Link>
          <ul className={navCx("fd-secret-nav-list")} ref={navListRef}>
            {navItems.map((item, index) => {
              const active = isActive(item.href);
              const href = itemHref(item);
              const opensNewTab = href.startsWith("http");
              return (
                <li
                  key={item.href}
                  className={navCx("fd-secret-nav-item")}
                  onMouseEnter={() => setHoveredNavIndex(index)}
                  onMouseLeave={() => setHoveredNavIndex(null)}
                  onFocus={() => setHoveredNavIndex(index)}
                  onBlur={() => setHoveredNavIndex(null)}
                >
                  <Link
                    ref={(node) => {
                      navLinkRefs.current[index] = node;
                    }}
                    href={href}
                    target={opensNewTab ? "_blank" : undefined}
                    rel={opensNewTab ? "noopener noreferrer" : undefined}
                    onClick={(e) => onNavClick(e, item)}
                    className={navCx("fd-secret-nav-link", active && "is-active")}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <span
              className={navCx("fd-secret-nav-marker", navMarker.visible && "is-visible")}
              style={{ "--fd-secret-marker-x": `${navMarker.x}px` } as CSSProperties}
              aria-hidden
            />
          </ul>
        </div>
      </nav>

      <div className={navCx("fd-secret-right-cluster hidden md:flex js-header-cta")}>
        <span className={navCx("fd-secret-glass-wrapper fd-secret-cta-shell")}>
          <span className={navCx("fd-secret-glass-effect")} aria-hidden />
          <AppDownloadMenu className={navCx("fd-secret-glass-content fd-secret-cta")} />
        </span>
        <span className={navCx("fd-secret-glass-wrapper fd-secret-cta-shell")}>
          <span className={navCx("fd-secret-glass-effect")} aria-hidden />
          <Link
            href={ctaHref}
            target={ctaOpensNewTab ? "_blank" : undefined}
            rel={ctaOpensNewTab ? "noopener noreferrer" : undefined}
            onClick={(e) => onNavClick(e, ctaItem)}
            className={navCx("fd-secret-glass-content fd-secret-cta")}
          >
            <ShinyText text={ctaItem.label} color="#ffffff" shineColor="#ff3d42" speed={2.5} yoyo />
          </Link>
        </span>

        {user ? (
          <div className={navCx("fd-secret-account-cluster")}>
            <span className={navCx("fd-secret-glass-wrapper fd-secret-account-bell")}>
              <span className={navCx("fd-secret-glass-effect")} aria-hidden />
              <span className={navCx("fd-secret-glass-content fd-secret-account-bell-content")}>
                <BellButton />
              </span>
            </span>
            <SecretAccountMenu
              user={user}
              locale={locale}
              switchLocale={switchLocale}
              logout={logout}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openAuthDialog()}
            className={navCx(
              "fd-secret-glass-wrapper fd-secret-cta-shell fd-secret-cta fd-secret-get-started"
            )}
          >
            <span className={navCx("fd-secret-glass-effect")} aria-hidden />
            <span className={navCx("fd-secret-glass-content fd-secret-cta")}>
              {t("getStarted")}
            </span>
          </button>
        )}
      </div>

      <div className={navCx("fd-secret-mobile-button-wrap md:hidden")}>
        <button
          type="button"
          onClick={toggleMobile}
          aria-label={t("menu")}
          aria-expanded={mobileOpen}
          className={navCx("fd-secret-glass-wrapper fd-secret-mobile-button")}
        >
          <span className={navCx("fd-secret-glass-effect")} aria-hidden />
          <span className={navCx("fd-secret-glass-content fd-secret-mobile-button-content")}>
            <span>{t("menu")}</span>
            <span className={navCx("fd-secret-menu-box")} aria-hidden>
              {mobileOpen ? (
                <IconX className="size-3.5" />
              ) : (
                <span className={navCx("fd-secret-menu-glyph")} />
              )}
            </span>
          </span>
        </button>
      </div>

      {mobileOpen ? (
        <div className={navCx("fd-secret-mobile-drawer md:hidden")}>
          <div className={navCx("fd-secret-glass-wrapper fd-secret-mobile-panel")}>
            <span className={navCx("fd-secret-glass-effect")} aria-hidden />
            <nav
              className={navCx("fd-secret-glass-content fd-secret-mobile-panel-content")}
              aria-label="Mobile"
            >
              <Link
                href={ctaHref}
                target={ctaOpensNewTab ? "_blank" : undefined}
                rel={ctaOpensNewTab ? "noopener noreferrer" : undefined}
                onClick={(e) => {
                  onNavClick(e, ctaItem);
                  closeMobile();
                }}
                className={navCx("fd-secret-mobile-cta")}
              >
                <span>{ctaItem.label}</span>
                <span className={navCx("fd-secret-mobile-arrow")} aria-hidden>
                  <IconChevronRight className="size-4" />
                </span>
              </Link>

              <div className={navCx("fd-secret-mobile-list")}>
                {navItems.map((item) => {
                  const href = itemHref(item);
                  const opensNewTab = href.startsWith("http");
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      target={opensNewTab ? "_blank" : undefined}
                      rel={opensNewTab ? "noopener noreferrer" : undefined}
                      onClick={(e) => {
                        onNavClick(e, item);
                        closeMobile();
                      }}
                      className={navCx("fd-secret-mobile-row")}
                    >
                      <span>{item.label}</span>
                      <span className={navCx("fd-secret-mobile-row-icon")} aria-hidden>
                        <IconChevronRight className="size-4" />
                      </span>
                    </Link>
                  );
                })}
                {APP_DOWNLOADS.map((item) => (
                  <a
                    key={item.platform}
                    href={item.href}
                    download={item.download}
                    target={item.download ? undefined : "_blank"}
                    rel={item.download ? undefined : "noopener noreferrer"}
                    onClick={closeMobile}
                    className={navCx("fd-secret-mobile-row")}
                  >
                    <span>{t(item.labelKey)}</span>
                    <span className={navCx("fd-secret-mobile-row-icon")} aria-hidden>
                      <IconDownload className="size-4" />
                    </span>
                  </a>
                ))}
                <a
                  href={USER_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMobile}
                  className={navCx("fd-secret-mobile-row")}
                >
                  <span>{t("userGuide")}</span>
                  <span className={navCx("fd-secret-mobile-row-icon")} aria-hidden>
                    <IconChevronRight className="size-4" />
                  </span>
                </a>
              </div>

              <div className={navCx("fd-secret-mobile-section")}>
                <span className={navCx("fd-secret-mobile-section-label")}>{t("language")}</span>
                {LOCALE_OPTIONS.map((opt) => {
                  const current = opt.value === locale;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        closeMobile();
                        switchLocale(opt.value);
                      }}
                      className={navCx("fd-secret-mobile-row", current && "is-active")}
                    >
                      <span>{opt.label}</span>
                      {current ? <IconCheck className="size-4" /> : null}
                    </button>
                  );
                })}
              </div>

              <div className={navCx("fd-secret-mobile-section")}>
                {user ? (
                  <>
                    <CommunityCreditsChip layout="row" />
                    <Link
                      href={localizePath("/messages", locale)}
                      onClick={closeMobile}
                      className={navCx("fd-secret-mobile-row")}
                    >
                      <MobileInboxLine />
                    </Link>
                    <Link
                      href={localizePath("/profile", locale)}
                      onClick={closeMobile}
                      className={navCx("fd-secret-mobile-row")}
                    >
                      <IconUser className="size-4" />
                      <span className="flex-1">{user.nickname || "Profile"}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        closeMobile();
                        void logout();
                      }}
                      className={navCx("fd-secret-mobile-row")}
                    >
                      <IconLogout className="size-4" />
                      <span className="flex-1">{commonT("logout")}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      closeMobile();
                      openAuthDialog();
                    }}
                    className={navCx("fd-secret-mobile-login")}
                  >
                    {t("getStarted")}
                  </button>
                )}
              </div>
            </nav>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function SecretAccountMenu({
  user,
  locale,
  switchLocale,
  logout,
}: {
  user: CurrentUser;
  locale: Locale;
  switchLocale: (next: Locale) => void;
  logout: () => void;
}) {
  const navT = useTranslations("nav");
  const commonT = useTranslations("common");
  const [copied, setCopied] = useState(false);

  const displayName = user.nickname || user.email || commonT("personalAccount");
  const accountId = encodeUserId(user.id);
  const accountIdLabel =
    accountId.length > 12 ? `${accountId.slice(0, 6)}...${accountId.slice(-4)}` : accountId;

  const copyAccountId = async () => {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={navCx("fd-secret-glass-wrapper fd-secret-account-trigger")}
          aria-label={navT("accountMenu")}
        >
          <span className={navCx("fd-secret-glass-effect")} aria-hidden />
          <span className={navCx("fd-secret-glass-content fd-secret-account-trigger-content")}>
            <UserAvatar
              src={user.avatar}
              seed={user.id}
              name={displayName}
              size={36}
              className={navCx("fd-secret-account-trigger-avatar")}
            />
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className={navCx("fd-secret-glass-wrapper fd-secret-account-menu")}
      >
        <span className={navCx("fd-secret-glass-effect")} aria-hidden />
        <div className={navCx("fd-secret-glass-content fd-secret-account-panel")}>
          <div className={navCx("fd-secret-account-card")}>
            <UserAvatar
              src={user.avatar}
              seed={user.id}
              name={displayName}
              size={56}
              className={navCx("fd-secret-account-avatar")}
            />
            <div className={navCx("fd-secret-account-meta")}>
              <div className={navCx("fd-secret-account-name")}>{displayName}</div>
              <button
                type="button"
                onClick={copyAccountId}
                className={navCx("fd-secret-account-id")}
                aria-label={navT("copyAccountId")}
              >
                <span>
                  {navT("accountId")} {accountIdLabel}
                </span>
                <IconCopy className="size-4" />
              </button>
            </div>
          </div>

          {copied ? (
            <div className={navCx("fd-secret-account-toast")}>{commonT("copied")}</div>
          ) : null}

          {/* Directly under the identity card: the profile is who you are, so it
              reads with the name and avatar rather than below the wallet. */}
          <div className={navCx("fd-secret-account-section")}>
            <Link
              href={localizePath("/profile", locale)}
              className={navCx("fd-secret-account-row")}
            >
              <IconUser className="size-5" />
              <span className="flex-1">{commonT("myProfile")}</span>
              <IconChevronRight className={navCx("fd-secret-account-row-arrow size-4")} />
            </Link>
          </div>

          <CommunityCreditsChip layout="row" className={navCx("fd-secret-account-wallet")} />

          <div className={navCx("fd-secret-account-section")}>
            <Link
              href={localizePath("/messages", locale)}
              className={navCx("fd-secret-account-row")}
            >
              <MobileInboxLine />
              <IconChevronRight className={navCx("fd-secret-account-row-arrow size-4")} />
            </Link>
            <a
              href={USER_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={navCx("fd-secret-account-row")}
            >
              <IconBook2 className="size-5" />
              <span className="flex-1">{navT("userGuide")}</span>
              <IconChevronRight className={navCx("fd-secret-account-row-arrow size-4")} />
            </a>
          </div>

          <div className={navCx("fd-secret-account-section")}>
            <div className={navCx("fd-secret-account-row is-static")}>
              <IconLanguage className="size-5" />
              <span className="flex-1">{navT("language")}</span>
            </div>
            <div className={navCx("fd-secret-locale-grid")} aria-label={navT("language")}>
              {LOCALE_OPTIONS.map((opt) => {
                const current = opt.value === locale;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => switchLocale(opt.value)}
                    className={navCx("fd-secret-locale-pill", current && "is-active")}
                    aria-current={current ? "true" : undefined}
                  >
                    <span>{opt.label}</span>
                    {current ? <IconCheck className="size-3.5" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className={navCx("fd-secret-account-row fd-secret-account-logout")}
          >
            <IconLogout className="size-5" />
            <span className="flex-1">{commonT("logout")}</span>
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SecretGlassFilter() {
  return (
    <svg className="pointer-events-none fixed size-0 opacity-0" aria-hidden>
      <defs>
        <filter
          id="fd-secret-glass-distortion"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          filterUnits="objectBoundingBox"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.01 0.01"
            numOctaves="1"
            seed="5"
            result="turbulence"
          />
          <feComponentTransfer in="turbulence" result="mapped">
            <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
            <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
            <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
          </feComponentTransfer>
          <feGaussianBlur in="turbulence" stdDeviation="5" result="softMap" />
          <feSpecularLighting
            in="softMap"
            surfaceScale="5"
            specularConstant="1"
            specularExponent="100"
            lightingColor="white"
            result="specLight"
          >
            <fePointLight x="-200" y="-200" z="300" />
          </feSpecularLighting>
          <feComposite
            in="specLight"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3="1"
            k4="0"
            result="litImage"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale="160"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced1"
          />
          <feColorMatrix
            in="displaced1"
            type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="displacedR"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale="150"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced2"
          />
          <feColorMatrix
            in="displaced2"
            type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="displacedG"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softMap"
            scale="140"
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced3"
          />
          <feColorMatrix
            in="displaced3"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
            result="displacedB"
          />
          <feBlend in="displacedR" in2="displacedG" mode="screen" result="blend1" />
          <feBlend in="blend1" in2="displacedB" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}

function MobileInboxLine() {
  const t = useTranslations("messages");
  const inbox = useInbox();
  const items = inbox.data?.items ?? [];
  const unread = items.reduce((s, c) => s + c.unreadCount, 0);
  return (
    <>
      <IconMessageCircle className="size-4" />
      <span className="flex-1">{t("centerTitle")}</span>
      {unread > 0 ? (
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold tabular-nums text-primary-foreground">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </>
  );
}
