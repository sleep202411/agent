import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useRouter } from "expo-router";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { fetchIpStudios, type IpStudiosPage } from "./ip-studios-api";

const roleKeys: Record<string, MessageKey> = {
  owner: "contentGpsDiscovery.contributorRoles.owner",
  producer: "contentGpsDiscovery.contributorRoles.producer",
  director: "contentGpsDiscovery.contributorRoles.director",
  writer: "contentGpsDiscovery.contributorRoles.writer",
  artist: "contentGpsDiscovery.contributorRoles.artist",
  editor: "contentGpsDiscovery.contributorRoles.editor",
  performer: "contentGpsDiscovery.contributorRoles.performer",
  other: "contentGpsDiscovery.contributorRoles.other",
};

export function IpContributingStudios({ ipId }: { ipId: string }) {
  const auth = useAuth(),
    locale = useLocale(),
    active = useScreenActive();
  if (!active) return null;
  return (
    <Relationships
      key={JSON.stringify([ipId, locale, auth.generation])}
      ipId={ipId}
      locale={locale}
      generation={auth.generation}
      viewerId={
        auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null
      }
    />
  );
}
function Relationships(props: {
  ipId: string;
  locale: string;
  generation: number;
  viewerId: string | null;
}) {
  const { ipId, locale, generation, viewerId } = props;
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter(),
    gate = useAuthGate();
  const [page, setPage] = useState<IpStudiosPage>();
  const [items, setItems] = useState<IpStudiosPage["items"]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const reset = useCallback(() => {
    setBusy(true);
    setError(undefined);
    setPage(undefined);
    setItems([]);
    setRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void fetchIpStudios({ generation, viewerId }, ipId, locale, null, uuid.v4(), controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) {
            setPage(value);
            setItems(value.items);
          }
        },
        (cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      )
      .finally(() => {
        if (!controller.signal.aborted) {
          request.current = null;
          setBusy(false);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [ipId, locale, generation, viewerId, revision]);
  useEffect(() => {
    // Hide old relationship claims before periodic permission rechecks.
    if (busy || error) return;
    const timer = setTimeout(reset, 30_000);
    return () => clearTimeout(timer);
  }, [busy, error, page, reset]);
  const more = () => {
    if (!page?.nextCursor || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    void fetchIpStudios(
      props,
      props.ipId,
      props.locale,
      page.nextCursor,
      uuid.v4(),
      controller.signal
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        const ids = new Set(items.map((item) => item.studio.id));
        if (value.items.some((item) => ids.has(item.studio.id)))
          throw Error(t("contentGpsDiscovery.responseMismatch"));
        setItems([...items, ...value.items]);
        setPage(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setPage(undefined);
          setItems([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          request.current = null;
          setBusy(false);
        }
      });
  };
  const action = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      accessibilityState={{ disabled: busy }}
      onPress={onPress}
      style={{ paddingVertical: 10 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("contentGpsDiscovery.studiosTitle")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t("contentGpsDiscovery.studiosDescription")}
      </ThemedText>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          {action(t("contentGpsDiscovery.retry"), reset)}
        </>
      ) : (
        <>
          {page && items.length === 0 && (
            <ThemedText type="small">{t("contentGpsDiscovery.studiosEmpty")}</ThemedText>
          )}
          {items.map(({ studio, roles }) => (
            <View
              key={studio.id}
              style={{
                padding: 12,
                gap: 4,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              {action(studio.name, () =>
                router.push(toHref(`/creator/${encodeURIComponent(studio.id)}`))
              )}
              <ThemedText type="small" themeColor="textSecondary">
                {roles
                  .map(
                    (role) =>
                      role.customRole ||
                      t(roleKeys[role.role] ?? "contentGpsDiscovery.contributorRoles.other")
                  )
                  .join(" · ")}
              </ThemedText>
              {studio.basedIn && (
                <ThemedText type="small">
                  {t("contentGpsDiscovery.studioBasedIn").replace("{city}", studio.basedIn.city)}
                </ThemedText>
              )}
              {studio.remote && (
                <ThemedText type="small">{t("contentGpsDiscovery.studioRemote")}</ThemedText>
              )}
              {action(
                t("contentGpsDiscovery.studioServices").replace(
                  "{count}",
                  String(studio.serviceCount)
                ),
                () =>
                  router.push(toHref(`/creator/${encodeURIComponent(studio.id)}?section=services`))
              )}
              {action(t("contentGpsDiscovery.studioDiscovery"), () =>
                router.push(toHref(`/studios?selected=${encodeURIComponent(studio.id)}`))
              )}
            </View>
          ))}
          {page?.nextCursor && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              onPress={more}
              style={{ paddingVertical: 10 }}
            >
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {t("contentGpsDiscovery.studiosMore")}
              </ThemedText>
            </Pressable>
          )}
          {page?.requiresLogin &&
            action(t("contentGpsDiscovery.studiosLogin"), () => gate.openLogin())}
        </>
      )}
      {busy && <ActivityIndicator />}
    </View>
  );
}
