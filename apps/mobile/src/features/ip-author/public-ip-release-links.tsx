import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import { z } from "zod";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { releaseLinks } from "./release-link-schema";
const response = z.object({ links: releaseLinks });
export function PublicIpReleaseLinks({ ipId }: { ipId: string }) {
  const auth = useAuth(),
    active = useScreenActive(),
    locale = useLocale();
  if (!active || auth.status === "hydrating") return null;
  return (
    <Links
      key={JSON.stringify([ipId, auth.generation, locale])}
      ipId={ipId}
      generation={auth.generation}
    />
  );
}
function Links({ ipId, generation }: { ipId: string; generation: number }) {
  const t = useTranslations();
  const [links, setLinks] = useState<z.infer<typeof releaseLinks>>(),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [opening, setOpening] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void api
      .get(`/ip-commerce/ips/${encodeURIComponent(ipId)}/release-links`, {
        service: "aurora",
        credentials: "omit",
        retry: false,
        signal: c.signal,
      })
      .then((value) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setLinks(response.parse(value).links);
      })
      .catch((e) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => c.abort();
  }, [ipId, generation, attempt]);
  const open = async (url: string) => {
    if (opening || generation !== getAuthGeneration()) return;
    setOpening(url);
    setError("");
    try {
      await openBrowserAsync(url);
    } catch (e) {
      if (generation === getAuthGeneration()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generation === getAuthGeneration()) setOpening(undefined);
    }
  };
  if (links?.length === 0 && !error) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("ipReleaseLinks.title")}</ThemedText>
      {!links && !error && <ActivityIndicator accessibilityLabel={t("ipReleaseLinks.loading")} />}
      {!!error && (
        <View>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError("");
              setLinks(undefined);
              setAttempt((v) => v + 1);
            }}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
      {links?.map((link) => (
        <Pressable
          key={link.url}
          accessibilityRole="link"
          disabled={!!opening}
          onPress={() => void open(link.url)}
          style={{ minHeight: 44, justifyContent: "center", opacity: opening ? 0.5 : 1 }}
        >
          <ThemedText>{link.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
