import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  fetchPricing,
  parsePriceDate,
  priceDateText,
  priceFields,
  pricingOutbox,
  savePricing,
  type PricingCommand,
  type PricingSnapshot,
  type PriceFields,
} from "./pricing-api";
type Props = { ipId: string; userId: string; generation: number };
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
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function IpPricingPanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [box] = useState(() => pricingOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [snapshot, setSnapshot] = useState<PricingSnapshot>(),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [mode, setMode] = useState<"bundle" | "episodes" | "free">("bundle");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchPricing(ipId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) {
          setSnapshot(value);
          setMode(
            value.price ? "bundle" : value.episodes.some((item) => item.price) ? "episodes" : "free"
          );
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, generation]);
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    try {
      setPending(box.read());
    } catch {}
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setReviewed(false);
      setConfirm(false);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setReviewed(false);
    setConfirm(false);
    setError(initial.error);
    void op.run(
      () => fetchPricing(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setReviewed(true);
        setSaved(false);
      },
      fail
    );
  };
  const submit = (command: PricingCommand) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setSaved(false);
    setError("");
    setReviewed(false);
    setConfirm(false);
    void op.run(
      async () => {
        setPending(box.start(command));
        return savePricing(ipId, userId, generation, command, signal);
      },
      (value) => {
        setSnapshot(value);
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      fail
    );
  };
  const frozen = loading || op.busy || !!pending || !!initial.error;
  const command = (
    episodeId: string | null,
    action: "price" | "preview" | "unpriced",
    data?: PriceFields
  ) => {
    if (!snapshot) return;
    const base = {
      clientKey: uuid.v4(),
      expectedVersion: snapshot.version,
      episodeId,
      initialPreview:
        snapshot.episodes.find((item) => item.id === episodeId)?.isFreePreview ?? false,
    };
    if (action === "price" && data) submit({ ...base, action, data });
    else if (episodeId && action !== "price") submit({ ...base, episodeId, action });
  };
  const episodes =
    snapshot?.episodes.filter((item) => ["published", "scheduled"].includes(item.status)) ?? [];
  return (
    <ScrollView
      style={!active ? { display: "none" } : undefined}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t("ipPricing.hint")}
      </ThemedText>
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipPricing.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} disabled={loading || op.busy} onPress={refresh} />
      {snapshot && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(["bundle", "episodes", "free"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === value }}
                disabled={op.busy}
                onPress={() => setMode(value)}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: mode === value ? theme.backgroundElement : undefined,
                }}
              >
                <ThemedText type="small">{t(`ipPricing.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t("ipPricing.modeHint")}
          </ThemedText>
          {mode === "free" && <ThemedText>{t("ipPricing.freeHint")}</ThemedText>}
          {mode === "bundle" && (
            <PriceForm
              key={`bundle:${snapshot.version}`}
              price={snapshot.price}
              disabled={frozen}
              onSave={(data) => command(null, "price", data)}
            />
          )}
          {mode === "episodes" && (
            <>
              {!episodes.length && <ThemedText>{t("ipPricing.noEpisodes")}</ThemedText>}
              {episodes.map((episode) => (
                <View
                  key={episode.id}
                  style={{
                    padding: 12,
                    gap: 8,
                    borderRadius: 8,
                    backgroundColor: theme.backgroundElement,
                  }}
                >
                  <ThemedText type="smallBold">{episode.title}</ThemedText>
                  <ThemedText type="small">
                    {t(
                      episode.isFreePreview
                        ? "ipPricing.preview"
                        : episode.price
                          ? "ipPricing.priced"
                          : "ipPricing.unpriced"
                    )}
                    {episode.price ? ` · ${episode.price.amount} ${t("ipCommerce.points")}` : ""}
                  </ThemedText>
                  <PriceForm
                    key={`${episode.id}:${snapshot.version}`}
                    price={episode.price}
                    disabled={frozen}
                    onSave={(data) => command(episode.id, "price", data)}
                  />
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    <Button
                      label={t("ipPricing.setPreview")}
                      disabled={frozen || episode.isFreePreview}
                      onPress={() => command(episode.id, "preview")}
                    />
                    <Button
                      label={t("ipPricing.clearPrice")}
                      disabled={frozen}
                      onPress={() => command(episode.id, "unpriced")}
                    />
                  </View>
                </View>
              ))}
            </>
          )}
        </>
      )}
      {pending && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("ipPricing.pending")}</ThemedText>
          <ThemedText type="small">
            {pending.command.episodeId
              ? (snapshot?.episodes.find((item) => item.id === pending.command.episodeId)?.title ??
                pending.command.episodeId)
              : t("ipPricing.bundle")}{" "}
            · {t(`ipPricing.intent_${pending.command.action}`)} · {t("ipPricing.stepsDone")}:{" "}
            {pending.index}
          </ThemedText>
          {pending.command.action === "price" && (
            <ThemedText type="small">
              {pending.command.data.amount} {t("ipCommerce.points")}
              {pending.command.data.startsAt
                ? ` · ${priceDateText(pending.command.data.startsAt)}`
                : ""}
              {pending.command.data.endsAt
                ? ` → ${priceDateText(pending.command.data.endsAt)}`
                : ""}
            </ThemedText>
          )}
          <Button
            label={t("common.retry")}
            disabled={loading || op.busy || !!initial.error}
            onPress={() => submit(pending.command)}
          />
          {snapshot && reviewed && (
            <Button
              label={t("ipPricing.reviewed")}
              disabled={op.busy}
              onPress={() => setConfirm(true)}
            />
          )}
          {confirm && (
            <>
              <ThemedText>{t("ipPricing.clearHint")}</ThemedText>
              <Button
                label={t("ipPricing.confirmClear")}
                disabled={op.busy}
                onPress={() => {
                  try {
                    box.clear(pending.command.clientKey);
                    setPending(null);
                    setConfirm(false);
                    setError("");
                  } catch (e) {
                    fail(e);
                  }
                }}
              />
              <Button
                label={t("common.cancel")}
                disabled={op.busy}
                onPress={() => setConfirm(false)}
              />
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
function PriceForm({
  price,
  disabled,
  onSave,
}: {
  price: PricingSnapshot["price"];
  disabled: boolean;
  onSave: (value: PriceFields) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [values, setValues] = useState({
      amount: price?.amount ?? "",
      originalAmount: price?.originalAmount ?? "",
      startsAt: priceDateText(price?.startsAt ?? null),
      endsAt: priceDateText(price?.endsAt ?? null),
    }),
    [open, setOpen] = useState(!!(price?.originalAmount || price?.startsAt || price?.endsAt));
  let parsed: PriceFields | undefined;
  try {
    parsed = priceFields.parse({
      ...values,
      originalAmount: values.originalAmount.trim() || null,
      startsAt: parsePriceDate(values.startsAt),
      endsAt: parsePriceDate(values.endsAt),
    });
  } catch {}
  const field = (name: keyof typeof values) => (
    <View key={name} style={{ gap: 4 }}>
      <ThemedText type="small">{t(`ipPricing.${name}`)}</ThemedText>
      <TextInput
        accessibilityLabel={t(`ipPricing.${name}`)}
        value={values[name]}
        onChangeText={(value) => setValues({ ...values, [name]: value })}
        editable={!disabled}
        keyboardType={name === "amount" || name === "originalAmount" ? "number-pad" : "default"}
        autoCapitalize="none"
        maxLength={name === "amount" || name === "originalAmount" ? 18 : 16}
        style={{
          padding: 12,
          color: theme.text,
          backgroundColor: theme.background,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      />
    </View>
  );
  return (
    <View style={{ gap: 8 }}>
      {field("amount")}
      <Button
        label={t("ipPricing.schedule")}
        disabled={disabled}
        onPress={() => setOpen((value) => !value)}
      />
      {open && (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {t("ipPricing.dateHint")}
          </ThemedText>
          {field("originalAmount")}
          {field("startsAt")}
          {field("endsAt")}
        </>
      )}
      {!parsed && !!values.amount && <ThemedText type="small">{t("ipPricing.invalid")}</ThemedText>}
      <Button
        label={t("ipPricing.save")}
        disabled={disabled || !parsed}
        onPress={() => {
          if (parsed) onSave(parsed);
        }}
      />
    </View>
  );
}
