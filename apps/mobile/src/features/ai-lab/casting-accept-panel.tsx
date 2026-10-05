import { ProjectLikenessConsent } from "./project-likeness-consent";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import {
  acceptCastingInvitation,
  castingAcceptanceBox,
  prepareCastingAcceptance,
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
  const router = useRouter();
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
  function accept(readAll: boolean, attested: boolean) {
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
  const openLibrary = () => {
    void op.run(
      async () => router.push("/character-library"),
      () => {},
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  if (done)
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <ThemedText>{t("castingAccept.done")}</ThemedText>
        <ThemedText type="small">{t("castingAccept.noMembership")}</ThemedText>
        <Button
          label={t("likenessGrants.title")}
          onPress={() => router.push("/likeness-authorizations")}
          disabled={op.busy}
        />
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
          <Button
            label={t("likenessGrants.title")}
            onPress={() => router.push("/likeness-authorizations")}
            disabled={op.busy}
          />
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
                setConsent(true);
              }}
              disabled={op.busy}
            />
          ) : null}
          {consent ? (
            <ProjectLikenessConsent
              key={`${selected}:${review.preview.projectName}`}
              projectName={review.preview.projectName}
              confirmLabel={t("castingAccept.accept")}
              busy={op.busy}
              onConfirm={accept}
              onBack={() => setConsent(false)}
            />
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
