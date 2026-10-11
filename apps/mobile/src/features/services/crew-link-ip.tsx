import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useMyIps } from "@/features/profile/use-my-ips";
import { toHref } from "@/lib/navigation";
import { ApiRequestError } from "@/lib/api-client";
import { fetchCrewIpLinkAccess } from "./crew-linked-resources-api";

/** Reuse the existing versioned IP editor; choosing a row never writes a link. */
export function CrewLinkIp({ crewId }: { crewId: string }) {
  const auth = useAuth();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return auth.status === "authenticated" && userId ? (
    <Access
      key={`${crewId}:${userId}:${auth.generation}`}
      crewId={crewId}
      userId={userId}
      generation={auth.generation}
    />
  ) : null;
}
function Access({
  crewId,
  userId,
  generation,
}: {
  crewId: string;
  userId: string;
  generation: number;
}) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewIpLinkAccess(crewId, userId, generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setAllowed(value);
      },
      (cause) => {
        if (c.signal.aborted) return;
        if (!(cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)))
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [crewId, userId, generation, revision]);
  if (error)
    return (
      <View>
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
        <Action
          label={t("thread.refresh")}
          onPress={() => {
            setError("");
            setRevision((v) => v + 1);
          }}
        />
      </View>
    );
  if (!allowed) return null;
  return (
    <View style={{ gap: 8 }}>
      <Action label={t("crewLinks.linkIp")} onPress={() => setOpen((v) => !v)} />
      {open && <Choices crewId={crewId} owner={`${userId}:${generation}`} />}
    </View>
  );
}
function Choices({ crewId, owner }: { crewId: string; owner: string }) {
  const list = useMyIps(owner),
    t = useTranslations(),
    router = useRouter();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {t("crewLinks.linkIpHint")}
      </ThemedText>
      {list.items?.map((ip) => (
        <Action
          key={ip.id}
          label={ip.title}
          onPress={() =>
            router.push(
              toHref(
                `/ip-studio/${encodeURIComponent(ip.id)}/rights?kind=crew&crewId=${encodeURIComponent(crewId)}`
              )
            )
          }
        />
      ))}
      {list.loading && <ActivityIndicator />}
      {list.error ? (
        <View>
          <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
          <Action label={t("thread.refresh")} onPress={list.retry} />
        </View>
      ) : !list.loading && !list.items?.length ? (
        <ThemedText type="small">{t("crewLinks.noOwnedIps")}</ThemedText>
      ) : null}
      {list.hasMore && !list.loading && !list.error && (
        <Action label={t("crewLinks.more")} onPress={list.loadMore} />
      )}
    </View>
  );
}
function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={{ minHeight: 44, paddingVertical: 12 }}
      onPress={onPress}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
