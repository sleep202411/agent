import { useLayoutEffect, useRef, useState } from "react";
import { useIsFocused, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import type { CreatorServiceDetail } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { formatServicePrice } from "@/lib/creator-service-format";
import { inquiryKey } from "./inquiry-api";
import { orderPayload, submitServiceOrder } from "./order-api";
export function ServiceOrder({ service }: { service: CreatorServiceDetail }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (
    service.status !== "listed" ||
    String(auth.user?.userId ?? auth.user?.id ?? "") === service.creatorId ||
    !Number.isSafeInteger(service.version) ||
    !service.packages.length
  )
    return null;
  return open && auth.status === "authenticated" ? (
    <RequestForm
      key={JSON.stringify([service.id, service.version, auth.generation])}
      service={service}
      close={() => setOpen(false)}
    />
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        gate.requireAuth({
          onAuthenticated: () => {
            if (active.current) setOpen(true);
          },
        })
      }
    >
      <ThemedText type="smallBold">{t("serviceOrder.title")}</ThemedText>
    </Pressable>
  );
}
function RequestForm({ service, close }: { service: CreatorServiceDetail; close: () => void }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    router = useRouter();
  const op = useAuthFormOperation(service.id, useIsFocused());
  const [tier, setTier] = useState(service.packages[0]!.tier),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [note, setNote] = useState(""),
    [error, setError] = useState<string>(),
    [order, setOrder] = useState<string>(),
    [locked, setLocked] = useState(false);
  const intent = useRef<ReturnType<typeof orderPayload> | undefined>(undefined);
  const valid = !service.requirementQuestions.some(
    (q) => q.required && !(answers[q.id] ?? "").trim()
  );
  const send = () =>
    void op.run(
      async () => {
        setError(undefined);
        intent.current ??= orderPayload(service, tier, answers, note, inquiryKey());
        setLocked(true);
        return submitServiceOrder(intent.current);
      },
      setOrder,
      (cause) => setError(cause instanceof Error ? cause.message : t("profileEdit.failed"))
    );
  const inputStyle = {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    borderColor: theme.border,
    color: theme.text,
    backgroundColor: theme.backgroundElement,
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("serviceOrder.title")}</ThemedText>
      <ThemedText>{t("serviceOrder.hint")}</ThemedText>
      {order ? (
        <>
          <ThemedText>{t("serviceOrder.sent")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(toHref(`/order/${encodeURIComponent(order)}`))}
          >
            <ThemedText>{t("serviceOrder.open")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          {service.packages.map((pkg) => (
            <Pressable
              key={pkg.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: pkg.tier === tier }}
              disabled={locked || op.busy}
              onPress={() => setTier(pkg.tier)}
              style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor:
                  pkg.tier === tier ? theme.backgroundSelected : theme.backgroundElement,
              }}
            >
              <ThemedText>
                {pkg.title} ·{" "}
                {formatServicePrice({ startingPrice: pkg.price, currency: pkg.currency }, locale)}
              </ThemedText>
            </Pressable>
          ))}
          {service.requirementQuestions.map((q) => (
            <View key={q.id}>
              <ThemedText>
                {q.prompt}
                {q.required ? " *" : ""}
              </ThemedText>
              {q.helpText && <ThemedText>{q.helpText}</ThemedText>}
              <TextInput
                accessibilityLabel={q.prompt}
                value={answers[q.id] ?? ""}
                onChangeText={(value) => setAnswers((current) => ({ ...current, [q.id]: value }))}
                editable={!locked && !op.busy}
                multiline
                maxLength={4000}
                style={inputStyle}
              />
            </View>
          ))}
          <ThemedText>{t("serviceOrder.note")}</ThemedText>
          <TextInput
            accessibilityLabel={t("serviceOrder.note")}
            value={note}
            onChangeText={setNote}
            editable={!locked && !op.busy}
            multiline
            maxLength={2000}
            style={inputStyle}
          />
          {locked && error && <ThemedText>{t("serviceOrder.retryHint")}</ThemedText>}
          <Pressable accessibilityRole="button" disabled={op.busy || !valid} onPress={send}>
            <ThemedText>{t("serviceOrder.submit")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Pressable accessibilityRole="button" disabled={op.busy} onPress={close}>
        <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
