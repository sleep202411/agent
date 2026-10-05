import {
  useServiceEditorState,
  useClearServiceEditorDraft,
  useServiceReceipt,
} from "./service-editor-drafts";
import { useServiceIntent } from "./service-intent";
import { orderOutbox } from "./order-outbox";
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
  const auth = useAuth();
  return (
    <ScopedServiceOrder
      key={JSON.stringify([service.id, auth.generation, auth.status])}
      service={service}
    />
  );
}
function ScopedServiceOrder({ service }: { service: CreatorServiceDetail }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const intentControl = useServiceIntent();
  const receipt = useServiceReceipt("order");
  const isOpen = intentControl ? intentControl.kind === "order" : open;
  const [hasPending, setHasPending] = useState(() => {
    if (auth.status !== "authenticated") return false;
    try {
      return !!orderOutbox(
        service.id,
        String(auth.user?.userId ?? auth.user?.id ?? ""),
        auth.generation
      ).read();
    } catch {
      return false;
    }
  });
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (
    String(auth.user?.userId ?? auth.user?.id ?? "") === service.creatorId ||
    (!hasPending &&
      !receipt.id &&
      (service.status !== "listed" ||
        !Number.isSafeInteger(service.version) ||
        !service.packages.length))
  )
    return null;
  return isOpen && auth.status === "authenticated" ? (
    <RequestForm
      key={JSON.stringify([service.id, service.version, auth.generation])}
      service={service}
      onPending={() => setHasPending(true)}
      close={() => {
        setOpen(false);
        intentControl?.close();
        try {
          setHasPending(
            !!orderOutbox(
              service.id,
              String(auth.user?.userId ?? auth.user?.id ?? ""),
              auth.generation
            ).read()
          );
        } catch {
          /* Preserve the recovery entry if storage is temporarily unavailable. */
        }
      }}
    />
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        intentControl
          ? intentControl.request("order")
          : gate.requireAuth({
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
function RequestForm({
  service,
  close,
  onPending,
}: {
  service: CreatorServiceDetail;
  close: () => void;
  onPending: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    router = useRouter();
  const auth = useAuth();
  const op = useAuthFormOperation(service.id, useIsFocused());
  const [outbox] = useState(() =>
    orderOutbox(service.id, String(auth.user?.userId ?? auth.user?.id ?? ""), auth.generation)
  );
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: undefined };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const receipt = useServiceReceipt("order");
  const clearDraft = useClearServiceEditorDraft("order");
  useServiceEditorState("order:open", true);
  const [reviewedVersion, setReviewedVersion] = useServiceEditorState(
    "order:version",
    service.version
  );
  const offer = initial.pending?.offer ?? service;
  const [tier, setTier] = useServiceEditorState(
      "order:tier",
      initial.pending?.payload.packageTier ?? service.packages[0]?.tier ?? ""
    ),
    [answers, setAnswers] = useServiceEditorState<Record<string, string>>(
      "order:answers",
      Object.fromEntries(
        initial.pending?.payload.answers.map((answer) => [answer.questionId, answer.answer]) ?? []
      )
    ),
    [note, setNote] = useServiceEditorState("order:note", initial.pending?.payload.note ?? ""),
    [error, setError] = useState<string | undefined>(initial.error),
    [localResult, setOrder] = useState<string>(),
    [locked, setLocked] = useState(!!initial.pending);
  const order = receipt.id ?? localResult;
  const intent = useRef(initial.pending ?? undefined);
  const needsReview = !locked && reviewedVersion !== service.version;
  const valid =
    locked ||
    (!needsReview &&
      offer.packages.some((pkg) => pkg.tier === tier) &&
      !offer.requirementQuestions.some((q) => q.required && !(answers[q.id] ?? "").trim()));
  const send = () =>
    void op.run(
      async () => {
        setError(undefined);
        if (initial.error) throw new Error(initial.error);
        const key = intent.current?.clientKey ?? inquiryKey();
        const pending = intent.current ?? {
          clientKey: key,
          payload: orderPayload(service, tier, answers, note, key),
          offer: { packages: service.packages, requirementQuestions: service.requirementQuestions },
        };
        intent.current = outbox.save(pending);
        onPending();
        setLocked(true);
        const id = await submitServiceOrder(intent.current.payload);
        outbox.clear(intent.current.clientKey);
        clearDraft();
        receipt.save(id);
        return id;
      },
      (id) => {
        setOrder(id);
      },
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
          {offer.packages.map((pkg) => (
            <Pressable
              key={pkg.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: pkg.tier === tier }}
              disabled={locked || op.busy || !!initial.error}
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
              <ThemedText type="small" themeColor="textSecondary">
                {pkg.deliveryDays} {t("serviceDetail.days")} ·{" "}
                {pkg.revisions < 0 ? t("serviceDetail.unlimitedRevisions") : pkg.revisions}{" "}
                {t("serviceDetail.revisions")}
              </ThemedText>
            </Pressable>
          ))}
          {offer.requirementQuestions.map((q) => (
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
                editable={!locked && !op.busy && !initial.error}
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
            editable={!locked && !op.busy && !initial.error}
            multiline
            maxLength={2000}
            style={inputStyle}
          />
          {needsReview && (
            <View style={{ gap: 8 }}>
              <ThemedText>{t("serviceOrder.offerChanged")}</ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReviewedVersion(service.version)}
              >
                <ThemedText>{t("serviceOrder.reviewOffer")}</ThemedText>
              </Pressable>
            </View>
          )}
          {locked && <ThemedText>{t("serviceOrder.retryHint")}</ThemedText>}
          <Pressable
            accessibilityRole="button"
            disabled={op.busy || !valid || !!initial.error}
            onPress={send}
          >
            <ThemedText>{t(locked ? "inbox.retry" : "serviceOrder.submit")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={() => {
          clearDraft();
          receipt.clear();
          close();
        }}
      >
        <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
