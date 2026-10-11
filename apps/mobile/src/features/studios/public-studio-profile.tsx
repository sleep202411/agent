import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { CreatorDiscoveryCardSchema } from "@repo/shared/creator-location";
import { regionLabel } from "@repo/shared/regions";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api, ApiRequestError } from "@/lib/api-client";
import { ThemedText } from "@/components/themed-text";

type Props = { creatorId: string; header: ReactNode; children: ReactNode };
export function PublicStudioProfile(props: Props) {
  const auth = useAuth(),
    locale = useLocale(),
    active = useScreenActive();
  if (!active || auth.status === "hydrating") return null;
  return (
    <Profile
      key={JSON.stringify([props.creatorId, auth.generation, locale])}
      {...props}
      generation={auth.generation}
      signedIn={auth.status === "authenticated"}
    />
  );
}
function Profile({
  creatorId,
  generation,
  signedIn,
  header,
  children,
}: Props & { generation: number; signedIn: boolean }) {
  const t = useTranslations(),
    locale = useLocale();
  const [profile, setProfile] = useState<ReturnType<typeof CreatorDiscoveryCardSchema.parse>>();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    void api
      .get(`/creator-location/profiles/${encodeURIComponent(creatorId)}`, {
        service: "aurora",
        signal: controller.signal,
        credentials: signedIn ? "include" : "omit",
        retry: false,
      })
      .then((value) => {
        if (!current()) return;
        const parsed = CreatorDiscoveryCardSchema.safeParse(value);
        if (!parsed.success || parsed.data.id !== creatorId)
          throw Error(t("contentGpsDiscovery.responseMismatch"));
        setProfile(parsed.data);
      })
      .catch((cause) => {
        if (!current()) return;
        if (cause instanceof ApiRequestError && cause.status === 404) setMissing(true);
        else
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : t("contentGpsDiscovery.responseMismatch")
          );
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
  }, [creatorId, generation, signedIn, revision, t]);
  const place = (value: { city: string; countryCode: string }) =>
    `${value.city}, ${regionLabel(value.countryCode, locale)}`;
  return (
    <View style={{ gap: 12 }}>
      {header}
      {missing ? null : loading ? (
        <ActivityIndicator accessibilityLabel={t("creatorStudio.loading")} />
      ) : error ? (
        <View style={{ gap: 8 }}>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: "center" }}
            onPress={() => {
              if (generation !== getAuthGeneration()) return;
              setLoading(true);
              setError(undefined);
              setProfile(undefined);
              setRevision((value) => value + 1);
            }}
          >
            <ThemedText>{t("creatorStudio.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : profile ? (
        <>
          <View style={{ gap: 8 }}>
            {profile.showOnMap && profile.basedIn && (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creatorStudio.basedIn")}: {place(profile.basedIn)}
              </ThemedText>
            )}
            {profile.serves.length > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creatorStudio.serves")}: {profile.serves.map(place).join(" · ")}
              </ThemedText>
            )}
            {profile.remote && (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creatorStudio.delivery")}: {t("creatorStudio.remote")}
              </ThemedText>
            )}
          </View>
        </>
      ) : null}
      {children}
    </View>
  );
}
