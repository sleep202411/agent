import { CrewLinkIp } from "./crew-link-ip";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import { toHref } from "@/lib/navigation";
import {
  fetchLinkedFilms,
  fetchLinkedIps,
  fetchLinkedWorkspace,
} from "./crew-linked-resources-api";
export function CrewLinkedResources({ crewId }: { crewId: string }) {
  const auth = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={{ minHeight: 44, paddingVertical: 12 }}
      >
        <ThemedText type="smallBold">{t("crewLinks.title")}</ThemedText>
      </Pressable>
      {expanded && active && auth.status !== "hydrating" ? (
        <Resources
          key={`${crewId}:${auth.generation}:${auth.status}`}
          crewId={crewId}
          generation={auth.generation}
          signedIn={auth.status === "authenticated"}
        />
      ) : null}
    </View>
  );
}
type Result<T> = { data: T; error?: never } | { error: string; data?: never };
function Resources({
  crewId,
  generation,
  signedIn,
}: {
  crewId: string;
  generation: number;
  signedIn: boolean;
}) {
  const t = useTranslations(),
    router = useRouter(),
    gate = useAuthGate();
  const [revision, setRevision] = useState(0);
  const [ips, setIps] = useState<Result<Awaited<ReturnType<typeof fetchLinkedIps>>>>();
  const [workspace, setWorkspace] =
    useState<Result<Awaited<ReturnType<typeof fetchLinkedWorkspace>>>>();
  useEffect(() => {
    const c = new AbortController();
    void fetchLinkedIps(crewId, generation, c.signal).then(
      (data) => {
        if (!c.signal.aborted) setIps({ data });
      },
      (e) => {
        if (!c.signal.aborted) setIps({ error: String(e instanceof Error ? e.message : e) });
      }
    );
    if (signedIn)
      void fetchLinkedWorkspace(crewId, generation, c.signal).then(
        (data) => {
          if (!c.signal.aborted) setWorkspace({ data });
        },
        (e) => {
          if (!c.signal.aborted)
            setWorkspace({ error: String(e instanceof Error ? e.message : e) });
        }
      );
    return () => c.abort();
  }, [crewId, generation, signedIn, revision]);
  const link = (label: string, path: string) => (
    <Pressable
      key={path}
      accessibilityRole="button"
      onPress={() => router.push(toHref(path))}
      style={{ minHeight: 44, paddingVertical: 12 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("crewLinks.ip")}</ThemedText>
      {!ips ? (
        <ActivityIndicator />
      ) : ips.error ? (
        <ThemedText accessibilityRole="alert">{ips.error}</ThemedText>
      ) : ips.data?.length ? (
        ips.data.map((ip, i) =>
          link(
            t("crewLinks.openIp").replace("{number}", String(i + 1)),
            `/ip/${encodeURIComponent(ip.id)}`
          )
        )
      ) : (
        <View>
          <ThemedText>{t("crewLinks.none")}</ThemedText>
          {signedIn && <CrewLinkIp key={revision} crewId={crewId} />}
        </View>
      )}
      <ThemedText type="smallBold">{t("crewLinks.workspace")}</ThemedText>
      {!signedIn ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, paddingVertical: 12 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("crewTerms.signIn")}</ThemedText>
        </Pressable>
      ) : !workspace ? (
        <ActivityIndicator />
      ) : workspace.error ? (
        <ThemedText accessibilityRole="alert">{workspace.error}</ThemedText>
      ) : workspace.data ? (
        link(workspace.data.name, `/agent?workspace=${encodeURIComponent(workspace.data.id)}`)
      ) : (
        <ThemedText>{t("crewLinks.none")}</ThemedText>
      )}
      <ThemedText type="smallBold">{t("crewLinks.films")}</ThemedText>
      {!signedIn ? (
        <ThemedText>{t("crewLinks.filmsSignIn")}</ThemedText>
      ) : !workspace || !ips ? (
        <ActivityIndicator />
      ) : "error" in workspace || "error" in ips ? (
        <ThemedText>{t("crewLinks.filmsUnavailable")}</ThemedText>
      ) : workspace.data && ips.data.length > 1 ? (
        <ThemedText>{t("crewLinks.filmsMultipleIps")}</ThemedText>
      ) : workspace.data && ips.data.length === 1 ? (
        <Films
          key={`${workspace.data.id}:${ips.data[0]!.id}:${revision}`}
          workspaceId={workspace.data.id}
          ipId={ips.data[0]!.id}
          generation={generation}
        />
      ) : (
        <ThemedText>{t("crewLinks.none")}</ThemedText>
      )}
      <Pressable
        accessibilityRole="button"
        style={{ minHeight: 44, paddingVertical: 12 }}
        onPress={() => {
          setIps(undefined);
          setWorkspace(undefined);
          setRevision((v) => v + 1);
        }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Films({
  workspaceId,
  ipId,
  generation,
}: {
  workspaceId: string;
  ipId: string;
  generation: number;
}) {
  const t = useTranslations(),
    router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result<Awaited<ReturnType<typeof fetchLinkedFilms>>>>();
  const [items, setItems] = useState<Awaited<ReturnType<typeof fetchLinkedFilms>>["items"]>([]);
  const records = useRef<Awaited<ReturnType<typeof fetchLinkedFilms>>["items"]>([]);
  const seen = useRef(new Set<string>());
  const pending = useRef(true);
  const restart = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchLinkedFilms(workspaceId, ipId, cursor, generation, c.signal)
      .then((data) => {
        if (c.signal.aborted) return;
        if (
          data.items.some((row) => records.current.some((old) => old.id === row.id)) ||
          (data.nextCursor && seen.current.has(data.nextCursor))
        )
          throw Error("Linked film pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        records.current = [...records.current, ...data.items];
        setItems(records.current);
        setResult({ data: { ...data, items: records.current } });
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
            records.current = [];
            setItems([]);
            seen.current.clear();
            restart.current = true;
          }
          setResult({ error: String(e instanceof Error ? e.message : e) });
        }
      })
      .finally(() => {
        if (!c.signal.aborted) pending.current = false;
      });
    return () => c.abort();
  }, [workspaceId, ipId, cursor, generation, revision]);
  return (
    <View style={{ gap: 8 }}>
      {items.map((film) => (
        <Pressable
          key={film.id}
          accessibilityRole="button"
          style={{ minHeight: 44, paddingVertical: 12 }}
          onPress={() => router.push(toHref(`/agent/${encodeURIComponent(film.id)}`))}
        >
          <ThemedText>{film.title}</ThemedText>
        </Pressable>
      ))}
      {!result ? (
        <ActivityIndicator />
      ) : result.error ? (
        <ThemedText accessibilityRole="alert">{result.error}</ThemedText>
      ) : !items.length ? (
        <ThemedText>{t("crewLinks.none")}</ThemedText>
      ) : null}
      {result?.data?.nextCursor ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, paddingVertical: 12 }}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setCursor(result.data.nextCursor);
            setResult(undefined);
          }}
        >
          <ThemedText>{t("crewLinks.more")}</ThemedText>
        </Pressable>
      ) : null}
      {result?.error ? (
        <Pressable
          accessibilityRole="button"
          style={{ minHeight: 44, paddingVertical: 12 }}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            if (restart.current) {
              setCursor(null);
              restart.current = false;
            }
            setResult(undefined);
            setRevision((v) => v + 1);
          }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}
