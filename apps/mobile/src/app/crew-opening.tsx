import { crewApplicationError } from "@/features/browse/crew-qualification-error";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, Pressable, ScrollView } from "react-native";
import { ZERO_DECIMAL_CURRENCIES } from "@repo/shared/crew";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { toHref } from "@/lib/navigation";
import {
  fetchCrewOpening,
  openingIsFull,
  openingViewerIsMember,
} from "@/features/browse/crew-opening-api";
import { useCrewApplication } from "@/features/browse/use-crew-application";
import { SaveOpening } from "@/features/browse/save-opening";
const subscribe = () => () => {};
export default function CrewOpeningScreen() {
  const auth = useAuth();
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const params = useLocalSearchParams<{ crewId?: string; positionId?: string }>();
  if (!ready) return <ActivityIndicator />;
  const crewId = typeof params.crewId === "string" ? params.crewId : "";
  const positionId = typeof params.positionId === "string" ? params.positionId : "";
  return (
    <Opening
      key={`${crewId}:${positionId}:${auth.generation}`}
      crewId={crewId}
      positionId={positionId}
    />
  );
}
function Opening({ crewId, positionId }: { crewId: string; positionId: string }) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter(),
    gate = useAuthGate(),
    auth = useAuth();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCrewOpening>>>();
  const [isMember, setIsMember] = useState(false);
  const [error, setError] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const { applying, submit } = useCrewApplication(crewId);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetchCrewOpening(crewId, positionId, controller.signal),
      auth.status === "authenticated"
        ? openingViewerIsMember(
            crewId,
            String(auth.user?.userId ?? auth.user?.id ?? ""),
            controller.signal
          )
        : Promise.resolve(false),
    ]).then(
      (value) => {
        if (!controller.signal.aborted) {
          setData(value[0]);
          setIsMember(value[1]);
        }
      },
      (e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : t("crewOpening.failed"));
      }
    );
    return () => controller.abort();
  }, [crewId, positionId, refresh, t, auth.status, auth.user?.userId, auth.user?.id]);
  const position = data?.position;
  const apply = () => {
    if (!position || isMember || openingIsFull(position)) return;
    gate.requireAuth({
      onAuthenticated: () => {
        Alert.alert(
          t("crewDetail.applyConfirmTitle"),
          crewPositionLabel(position.positionType, t),
          [
            { text: t("report.cancel"), style: "cancel" },
            {
              text: t("crewDetail.applyConfirmAction"),
              onPress: () => {
                setApplicationError("");
                void submit(
                  position.id,
                  () => {
                    Alert.alert(
                      t("crewDetail.applySubmittedTitle"),
                      t("crewDetail.applySubmittedBody")
                    );
                  },
                  (e) => {
                    setApplicationError(crewApplicationError(e, t));
                  }
                );
              },
            },
          ]
        );
      },
    });
  };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const labels = (code: string) => t(`positionCreate.${code}` as MessageKey);
  const amount = (value: number | null) =>
    value === null
      ? ""
      : String(
          value /
            (position?.salary.currency && ZERO_DECIMAL_CURRENCIES.has(position.salary.currency)
              ? 1
              : 100)
        );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("crewOpening.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          {button(t("common.retry"), () => {
            setData(undefined);
            setError("");
            setRefresh((v) => v + 1);
          })}
        </>
      ) : data === undefined ? (
        <ActivityIndicator />
      ) : null}
      {data === null ? <ThemedText>{t("crewOpening.unavailable")}</ThemedText> : null}
      {data && position && !error ? (
        <>
          {button(data.crew.name, () => router.push(toHref(`/crew/${crewId}`)))}
          <ThemedText type="subtitle">{crewPositionLabel(position.positionType, t)}</ThemedText>
          <ThemedText>
            {[
              labels(position.employmentType),
              labels(position.workMode),
              position.location,
              labels(position.experienceLevel),
            ]
              .filter(Boolean)
              .join(" · ")}
          </ThemedText>
          {position.salary.currency &&
          (position.salary.minAmount !== null || position.salary.maxAmount !== null) ? (
            <ThemedText>
              {position.salary.currency}{" "}
              {[amount(position.salary.minAmount), amount(position.salary.maxAmount)]
                .filter(Boolean)
                .join(" – ")}{" "}
              {position.salary.period ? t(`crewTerms.${position.salary.period}`) : ""}
            </ThemedText>
          ) : null}
          {position.salary.negotiable ? (
            <ThemedText>{t("positionCreate.negotiable")}</ThemedText>
          ) : null}
          <ThemedText>{position.description}</ThemedText>
          {position.requiredSkills.length ? (
            <ThemedText>{position.requiredSkills.join(" · ")}</ThemedText>
          ) : null}
          {position.closeDate ? (
            <ThemedText>
              {t("positionCreate.closeDate")}: {position.closeDate}
            </ThemedText>
          ) : null}
          <SaveOpening positionId={position.id} />
          {applicationError ? (
            <ThemedText accessibilityRole="alert">{applicationError}</ThemedText>
          ) : null}
          {button(
            isMember
              ? t("crewOpening.member")
              : openingIsFull(position)
                ? t("crewOpening.full")
                : t("crewDetail.applyButton"),
            apply,
            isMember || openingIsFull(position) || applying
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
