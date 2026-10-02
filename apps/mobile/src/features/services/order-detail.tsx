import { useUserDisplays } from "./user-displays";
import { useEffect, useMemo, useState } from "react";
import { useRouter, Stack } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import type { OrderAction } from "@repo/shared/order";
import { useAuth, useAuthGate } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { formatServicePrice } from "@/lib/creator-service-format";
import { toHref } from "@/lib/navigation";
import {
  fetchOrder,
  orderActions,
  reasonLimit,
  transitionOrder,
  type NativeOrder,
} from "./order-detail-api";
export function OrderDetail({ id }: { id: string }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    t = useTranslations(),
    theme = useTheme();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("serviceOrder.open"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("orders.signIn")}</ThemedText>
        </Pressable>
      ) : id && userId ? (
        <Content
          key={JSON.stringify([id, auth.generation, userId])}
          id={id}
          userId={userId}
          active={active}
        />
      ) : null}
    </View>
  );
}
function Content({ id, userId, active }: { id: string; userId: string; active: boolean }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    router = useRouter();
  const [revision, setRevision] = useState(0);
  const scope = useMemo(
    () => ({ id, userId, active, revision, t }),
    [id, userId, active, revision, t]
  );
  const [snapshot, setSnapshot] = useState<{
    scope: object;
    order?: NativeOrder;
    error?: string;
  }>();
  const visible = active && snapshot?.scope === scope ? snapshot : undefined;
  const order = visible?.order;
  const error = visible?.error;
  const loading = active && !visible;
  const [action, setAction] = useState<OrderAction>(),
    [reason, setReason] = useState("");
  const op = useAuthFormOperation(id, active);
  const auth = useAuth();
  const otherId = order ? (order.buyerId === userId ? order.creatorId : order.buyerId) : "";
  const displays = useUserDisplays(active ? String(auth.generation) : undefined, [otherId]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void fetchOrder(id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.buyerId !== userId && result.creatorId !== userId)
          throw new Error("Order is not available to this account");
        setSnapshot({ scope, order: result });
        setAction((current) =>
          current && orderActions(result, userId).includes(current) ? current : undefined
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setSnapshot({
            scope,
            error: cause instanceof Error ? cause.message : t("profileEdit.failed"),
          });
        }
      });
    return () => controller.abort();
  }, [id, userId, scope, active, t]);
  const refresh = () => {
    setRevision((value) => value + 1);
  };
  const submit = () => {
    if (!active || !order || !action || loading || !orderActions(order, userId).includes(action))
      return;
    void op.run(
      () => transitionOrder(order, userId, action, reason),
      (result) => {
        setSnapshot({ scope, order: result });
        setAction(undefined);
        setReason("");
      },
      (cause) => {
        // A failed response does not prove the transition failed. Require a
        // fresh authoritative read before offering another order action.
        setSnapshot({
          scope,
          error: cause instanceof Error ? cause.message : t("profileEdit.failed"),
        });
        setAction(undefined);
      }
    );
  };
  if (!active) return null;
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
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {button(t("orderDetail.refresh"), refresh, op.busy || loading)}
      {(loading || op.busy) && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {order && (
        <>
          <ThemedText type="smallBold">{order.packageSnapshot.title}</ThemedText>
          <ThemedText>
            {t(`orders.status.${order.status}`)} · #{order.id}
          </ThemedText>
          <ThemedText>
            {t(order.buyerId === userId ? "orderDetail.creator" : "orderDetail.buyer")}{" "}
            {displays?.get(otherId)?.nickname?.trim() || otherId}
          </ThemedText>
          <ThemedText>
            {formatServicePrice(
              {
                startingPrice: order.packageSnapshot.price,
                currency: order.packageSnapshot.currency,
              },
              locale
            )}
          </ThemedText>
          <ThemedText>{order.packageSnapshot.description}</ThemedText>
          <ThemedText>
            {t("orderDetail.days")} {order.packageSnapshot.deliveryDays} ·{" "}
            {t("orderDetail.revisions")}{" "}
            {order.packageSnapshot.revisions === -1
              ? t("orderDetail.unlimited")
              : order.packageSnapshot.revisions}
          </ThemedText>
          {order.packageSnapshot.scope.map((text, i) => (
            <ThemedText key={i}>• {text}</ThemedText>
          ))}
          {order.questionnaire.map((q, i) => (
            <View key={i}>
              <ThemedText type="smallBold">
                {q.prompt}
                {q.required ? " *" : ""}
              </ThemedText>
              <ThemedText>{q.answer || "—"}</ThemedText>
            </View>
          ))}
          {(["ipId", "episodeId", "crewId", "crewPositionId"] as const).map((key) =>
            order.bindings[key] ? (
              <ThemedText key={key}>
                {t(`orderDetail.binding.${key}`)} {order.bindings[key]}
              </ThemedText>
            ) : null
          )}
          {(["createdAt", "acceptedAt", "deliveredAt", "completedAt", "cancelledAt"] as const).map(
            (key) =>
              order[key] ? (
                <ThemedText key={key}>
                  {t(`orderDetail.time.${key}`)}{" "}
                  {Number.isNaN(Date.parse(order[key]!))
                    ? order[key]
                    : new Date(order[key]!).toLocaleString(locale)}
                </ThemedText>
              ) : null
          )}
          {order.cancelInfo && (
            <ThemedText>
              {t("orderDetail.cancelReason")} {order.cancelInfo.reason}
            </ThemedText>
          )}
          {button(
            t("serviceContact.open"),
            () => router.push(toHref(`/conversation/${encodeURIComponent(order.conversationId)}`)),
            op.busy
          )}
          {!action &&
            orderActions(order, userId).map((value) => (
              <View key={value}>
                {button(
                  t(`orderDetail.action.${value}`),
                  () => {
                    setReason("");
                    setAction(value);
                  },
                  op.busy || loading
                )}
              </View>
            ))}
          {action && (
            <View style={{ gap: 12 }}>
              <ThemedText type="smallBold">{t(`orderDetail.action.${action}`)}</ThemedText>
              <ThemedText>{t("orderDetail.confirmHint")}</ThemedText>
              {reasonLimit(action) > 0 && (
                <>
                  <ThemedText>{t("orderDetail.reason")}</ThemedText>
                  <TextInput
                    accessibilityLabel={t("orderDetail.reason")}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    maxLength={reasonLimit(action)}
                    editable={!op.busy}
                    style={{
                      minHeight: 80,
                      padding: 12,
                      borderRadius: 8,
                      color: theme.text,
                      backgroundColor: theme.backgroundElement,
                    }}
                  />
                </>
              )}
              {button(
                t("orderDetail.confirm"),
                submit,
                op.busy || loading || (reasonLimit(action) > 0 && !reason.trim())
              )}
              {button(t("experienceEdit.cancel"), () => setAction(undefined), op.busy)}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
