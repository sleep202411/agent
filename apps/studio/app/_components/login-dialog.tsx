"use client";

import { useCallback, useMemo } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { AuthDialog, createFetchTransport, type AuthTranslate } from "@repo/auth-flow";
import { resolveUserAvatarUrl as resolveSharedUserAvatarUrl } from "@repo/shared/avatar";
import { getAuthUser } from "@/lib/auth";
import { buildWebHref, WEB_PATHS } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";

/**
 * Studio's mount point for the ONE product-wide sign-in dialog
 * (`@repo/auth-flow`). apps/web renders the exact same component with the
 * same steps and the same markup — identifier → code (auto-registers) →
 * profile → invite, with "use password instead" as the legacy side door.
 *
 * Everything visual lives in the package; this file only supplies what is
 * genuinely studio-specific: the `auth` message namespace, the bare `/user/*`
 * path space (studio rewrites it in `next.config.ts`; web prefixes its cell),
 * the post-login session probe, and the cell-keyed legal links.
 */
export function LoginDialog({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: () => void;
}) {
  const messages = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const siteRegion = useSiteRegion();

  // next-intl's translator already has the package's `(key, vars) => string`
  // shape; the cast-free wrapper just narrows it to the key union so a key the
  // package adds later fails to compile here instead of rendering raw.
  const t = useCallback<AuthTranslate>((key, vars) => messages(key, vars), [messages]);

  // Studio talks to Java through its own `/user/*` rewrite, so no path
  // resolver. Memoized: the transport identity drives the flow's client and
  // action identities inside `useAuthFlow`.
  const transport = useMemo(
    () => createFetchTransport({ headers: () => ({ "accept-language": locale }) }),
    [locale]
  );

  /**
   * Don't dismiss until the exact cookie the rest of Studio rides has passed
   * the Nest → Java session check. This is the old dialog's guarantee, kept:
   * it turns a cookie-scope / proxy regression into an actionable inline
   * error instead of a silent "dialog closed, still signed out".
   */
  const verifySession = useCallback(async () => {
    try {
      return (await getAuthUser()) !== null;
    } catch {
      // Probe unreachable — unverified, which keeps the user in the flow.
      return false;
    }
  }, []);

  const onSuccess = useCallback(() => onLoggedIn(), [onLoggedIn]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose]
  );

  return (
    <AuthDialog
      open
      onOpenChange={onOpenChange}
      t={t}
      transport={transport}
      steps={{ profile: true, invite: true }}
      verifySession={verifySession}
      resolveAvatarUrl={resolveAvatarUrl}
      onSuccess={onSuccess}
      brand={
        <Image
          src="/logo.png"
          alt={tc("fizzDragon")}
          width={439}
          height={78}
          className="h-7 w-auto"
        />
      }
      legal={
        <div className="space-y-0.5">
          <p>
            {messages.rich("termsNotice", {
              terms: (chunks) => (
                <LegalLink href={buildWebHref(siteRegion, locale, WEB_PATHS.terms)}>
                  {chunks}
                </LegalLink>
              ),
            })}
          </p>
          <p>
            {messages.rich("privacyNotice", {
              privacy: (chunks) => (
                <LegalLink href={buildWebHref(siteRegion, locale, WEB_PATHS.privacy)}>
                  {chunks}
                </LegalLink>
              ),
            })}
          </p>
        </div>
      }
    />
  );
}

function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-semibold text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
    >
      {children}
    </a>
  );
}

/**
 * Java's avatar upload answers with a bare OSS key, and studio has NO
 * client-side avatar base — every avatar it renders is resolved server-side by
 * Nest (`/aurora/users/me`, see `apps/server/src/users/avatar.ts`). So only an
 * already-absolute URL can be previewed in-dialog; a bare key resolves to `""`,
 * which the package renders as "no photo yet" rather than a broken image. The
 * committed upload still shows up everywhere else the moment the auth query
 * invalidates on success.
 */
function resolveAvatarUrl(path: string): string {
  return resolveSharedUserAvatarUrl(path) ?? "";
}
