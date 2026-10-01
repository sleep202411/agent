import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { appEnv } from "@/config/app-env";
import { ThemedText } from "@/components/themed-text";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import {
  acceptCastingInvitation,
  castingAcceptanceBox,
  prepareCastingAcceptance,
  PROJECT_LIKENESS_CONSENT_VERSION,
  reviewCastingInvite,
  type CastingReview,
} from "./casting-accept-api";
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
function Cover({ assetId, generation }: { assetId: string; generation: number }) {
  const [url, setUrl] = useState<string>();
  const t = useTranslations();
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewAssetAccess(assetId, c.signal)
      .then((r) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setUrl(r.url);
      })
      .catch(() => {});
    return () => c.abort();
  }, [assetId, generation]);
  return url ? (
    <Image
      source={{ uri: url }}
      accessibilityLabel={t("castingAccept.cover")}
      cachePolicy="none"
      style={{ width: 40, height: 40, borderRadius: 6 }}
      onError={() => setUrl(undefined)}
    />
  ) : (
    <ThemedText type="small">{t("castingAccept.cover")}</ThemedText>
  );
}
export function CastingAcceptPanel(props: { token: string; userId: string; generation: number }) {
  return useScreenActive() && props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}:${props.token}`} {...props} />
  ) : null;
}
function Session({
  token,
  userId,
  generation,
}: {
  token: string;
  userId: string;
  generation: number;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("casting-accept", true);
  const [box] = useState(() => castingAcceptanceBox(userId, generation, token));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [review, setReview] = useState<CastingReview>(),
    [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [epoch, setEpoch] = useState(0),
    [selected, setSelected] = useState<string>(),
    [consent, setConsent] = useState(false),
    [read, setRead] = useState(false),
    [attested, setAttested] = useState(false),
    [height, setHeight] = useState(0),
    [viewport, setViewport] = useState(0),
    [done, setDone] = useState(false),
    [clear, setClear] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setReview(undefined);
    setSelected(undefined);
    setConsent(false);
    setRead(false);
    setAttested(false);
    setHeight(0);
    setViewport(0);
    void reviewCastingInvite(token, generation, c.signal)
      .then((r) => {
        if (!c.signal.aborted) {
          setReview(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [token, generation, epoch]);
  const readAll = read || (height > 0 && viewport > 0 && height <= viewport + 12);
  function accept() {
    if (!review || op.busy || pending) return;
    let intent;
    try {
      intent = prepareCastingAcceptance(
        token,
        review,
        selected ?? "",
        uuid.v4(),
        readAll,
        attested
      );
    } catch (e) {
      setError(String(e));
      return;
    }
    void op.run(
      () => acceptCastingInvitation(token, intent, userId, generation, controller.current!.signal),
      () => {
        setPending(null);
        setDone(true);
        setError("");
      },
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setRead(false);
        setAttested(false);
        setConsent(false);
        setReview(undefined);
        try {
          setPending(box.read());
        } catch {
          /* A corrupt pending record stays intact. */
        }
      }
    );
  }
  const studio = `https://${appEnv.appRegion === "cn" ? "studio.fizzspace.cn" : "studio.fizzdragon.com"}/characters`;
  const openLibrary = () => {
    void op.run(
      () => Linking.openURL(studio),
      () => {},
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (done)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <ThemedText>{t("castingAccept.done")}</ThemedText>
        <ThemedText type="small">{t("castingAccept.noMembership")}</ThemedText>
        <Button label={t("castingAccept.manage")} onPress={openLibrary} disabled={op.busy} />
      </View>
    );
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <Button
        label={t("castingAccept.refresh")}
        onPress={() => setEpoch((v) => v + 1)}
        disabled={loading || op.busy}
      />
      {loading ? <ActivityIndicator /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("castingAccept.pending")}</ThemedText>
          <ThemedText type="small">
            {pending.projectName} · {pending.characterName}
          </ThemedText>
          <Button label={t("castingAccept.manage")} onPress={openLibrary} disabled={op.busy} />
          <Button label={t("casting.clear")} onPress={() => setClear(true)} disabled={op.busy} />
          {clear ? (
            <>
              <ThemedText>{t("castingAccept.clearHint")}</ThemedText>
              <Button
                label={t("casting.confirm")}
                onPress={() => {
                  try {
                    box.clear(pending.clientKey);
                    setPending(null);
                    setClear(false);
                    setEpoch((v) => v + 1);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
                disabled={op.busy}
              />
              <Button
                label={t("common.cancel")}
                onPress={() => setClear(false)}
                disabled={op.busy}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {review && !pending ? (
        <>
          <ThemedText type="smallBold">{review.preview.projectName}</ThemedText>
          <ThemedText type="small">{t("castingAccept.hint")}</ThemedText>
          {!review.likenesses.length ? (
            <>
              <ThemedText>{t("castingAccept.noLikeness")}</ThemedText>
              <Button label={t("castingAccept.enroll")} onPress={openLibrary} disabled={op.busy} />
              <ThemedText type="small">{t("castingAccept.return")}</ThemedText>
            </>
          ) : null}
          {!consent
            ? review.likenesses.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selected === c.id }}
                  disabled={op.busy}
                  onPress={() => {
                    setSelected(c.id);
                    setRead(false);
                    setAttested(false);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderRadius: 8,
                    backgroundColor: theme.backgroundElement,
                  }}
                >
                  {c.coverAssetId ? (
                    <Cover assetId={c.coverAssetId} generation={generation} />
                  ) : null}
                  <ThemedText style={{ flexShrink: 1 }}>
                    {selected === c.id ? "✓ " : ""}
                    {c.name}
                  </ThemedText>
                </Pressable>
              ))
            : null}
          {!consent && selected ? (
            <Button
              label={t("castingAccept.reviewConsent")}
              onPress={() => {
                setRead(false);
                setAttested(false);
                setHeight(0);
                setViewport(0);
                setConsent(true);
              }}
              disabled={op.busy}
            />
          ) : null}
          {consent ? (
            <View style={{ gap: 10 }}>
              <ScrollView
                testID="casting-consent-copy"
                nestedScrollEnabled
                style={{ height: 300, borderRadius: 8, backgroundColor: theme.backgroundElement }}
                contentContainerStyle={{ padding: 12, gap: 10 }}
                onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
                onContentSizeChange={(_w, h) => setHeight(h)}
                scrollEventThrottle={16}
                onScroll={(e) => {
                  const n = e.nativeEvent;
                  if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 12)
                    setRead(true);
                }}
              >
                <ThemedText type="small">{PROJECT_LIKENESS_CONSENT_VERSION}</ThemedText>
                {(["Project", "Purpose", "Prohibited", "Transfer", "Controls"] as const).map(
                  (s) => (
                    <View key={s} style={{ gap: 4 }}>
                      <ThemedText type="smallBold">{t(`castingConsent.grant${s}Title`)}</ThemedText>
                      <ThemedText type="small">
                        {t(`castingConsent.grant${s}Body`).replace(
                          "{project}",
                          review.preview.projectName
                        )}
                      </ThemedText>
                    </View>
                  )
                )}
              </ScrollView>
              {!readAll ? (
                <ThemedText type="small">{t("castingConsent.consentScrollHint")}</ThemedText>
              ) : null}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: attested }}
                disabled={op.busy}
                onPress={() => setAttested((v) => !v)}
                style={{ padding: 10 }}
              >
                <ThemedText>
                  {attested ? "✓ " : "□ "}
                  {t("castingConsent.grantAttestation")}
                </ThemedText>
              </Pressable>
              <Button
                label={t("castingAccept.accept")}
                onPress={accept}
                disabled={op.busy || !readAll || !attested}
              />
              <Button
                label={t("common.back")}
                onPress={() => {
                  setConsent(false);
                  setRead(false);
                  setAttested(false);
                }}
                disabled={op.busy}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
