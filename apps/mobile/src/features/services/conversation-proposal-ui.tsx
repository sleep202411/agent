import { proposalOutbox } from "./proposal-outbox";
import { getAuthGeneration } from "@/auth/auth-store";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ALL_CURRENCIES } from "@repo/shared/crew";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { appEnv } from "@/config";
import { formatServicePrice } from "@/lib/creator-service-format";
import { inquiryKey } from "./inquiry-api";
import { parsePackageNumber } from "./service-packages-api";
import type { NativeConversation, NativeMessage } from "./conversation-api";
import {
  acceptProposal,
  declineProposal,
  sendProposal,
  canDecideProposal,
  canSendProposal,
  proposalInputSchema,
} from "./conversation-proposals";

type Props = { conversation: NativeConversation; userId: string; refresh: () => void };
export function ConversationProposal({
  conversation,
  userId,
  refresh,
  message,
  openOrder,
}: Props & { message: NativeMessage; openOrder: (id: string) => void }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const op = useAuthFormOperation(message.id, useScreenActive());
  const [decision, setDecision] = useState<"accept" | "decline">();
  const [error, setError] = useState<string>();
  const p = message.payload?.kind === "proposal" ? message.payload.proposal : undefined;
  if (!p) return null;
  const allowed = canDecideProposal(conversation, message, userId);
  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={op.busy}
      onPress={onPress}
      style={{ padding: 10 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  return (
    <View
      style={{ gap: 8, padding: 12, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
    >
      <ThemedText type="smallBold">
        {t("thread.proposal")} · {t(`thread.status.${p.status}`)}
      </ThemedText>
      <ThemedText>
        {t(`servicePackages.tier.${p.packageTier}`)} ·{" "}
        {formatServicePrice({ startingPrice: p.price, currency: p.currency }, locale)}
      </ThemedText>
      <ThemedText>
        {t("servicePackages.deliveryDays")}: {p.deliveryDays}
      </ThemedText>
      <ThemedText>
        {t("servicePackages.revisions")}: {p.revisions === -1 ? t("thread.unlimited") : p.revisions}
      </ThemedText>
      {!!p.note && <ThemedText>{p.note}</ThemedText>}
      {p.scope.map((line, index) => (
        <ThemedText key={index}>• {line}</ThemedText>
      ))}
      {p.orderId && button(t("thread.openOrder"), () => openOrder(p.orderId!))}
      {allowed && !decision && (
        <View style={{ flexDirection: "row" }}>
          {button(t("thread.accept"), () => setDecision("accept"))}
          {button(t("thread.decline"), () => setDecision("decline"))}
        </View>
      )}
      {allowed && decision && (
        <View>
          <ThemedText>
            {t(decision === "accept" ? "thread.acceptHint" : "thread.declineHint")}
          </ThemedText>
          {button(t("myServices.confirm"), () => {
            void op.run(
              async () =>
                decision === "accept"
                  ? acceptProposal(conversation, message, userId)
                  : declineProposal(conversation, message, userId),
              (result) => {
                setDecision(undefined);
                setError(undefined);
                refresh();
                if ("buyerId" in result) openOrder(result.id);
              },
              (cause) => {
                setError(cause instanceof Error ? cause.message : String(cause));
                refresh();
              }
            );
          })}
          {button(t("myServices.cancel"), () => setDecision(undefined))}
        </View>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
export function ConversationProposalEditor(props: Props) {
  if (!canSendProposal(props.conversation, props.userId)) return null;
  return (
    <ProposalEditor
      key={`${props.conversation.id}:${props.userId}:${getAuthGeneration()}`}
      {...props}
    />
  );
}
function ProposalEditor({ conversation, userId, refresh }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(conversation.id, useScreenActive());
  const [outbox] = useState(() => proposalOutbox(conversation.id, userId, getAuthGeneration()));
  const [initial] = useState(() => {
    try {
      return { saved: outbox.read(), error: undefined };
    } catch (cause) {
      return { saved: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [open, setOpen] = useState(!!initial.saved || !!initial.error),
    [error, setError] = useState<string | undefined>(initial.error);
  const [tier, setTier] = useState<(typeof SERVICE_TIERS)[number]>(
    initial.saved?.packageTier ?? "basic"
  );
  const [currency, setCurrency] = useState(
    initial.saved?.currency ?? (appEnv.siteRegion === "cn" ? "CNY" : "USD")
  );
  const [fields, setFields] = useState(
    initial.saved
      ? {
          price: String(initial.saved.price),
          deliveryDays: String(initial.saved.deliveryDays),
          revisions: String(initial.saved.revisions),
          scope: initial.saved.scope.join("\n"),
          note: initial.saved.note,
        }
      : { price: "", deliveryDays: "", revisions: "0", scope: "", note: "" }
  );
  const intent = useRef<ReturnType<typeof proposalInputSchema.parse> | undefined>(
    initial.saved ?? undefined
  );
  const parsed = proposalInputSchema.safeParse({
    ...fields,
    packageTier: tier,
    currency,
    clientKey: "validation",
    price: parsePackageNumber(fields.price),
    deliveryDays: parsePackageNumber(fields.deliveryDays),
    revisions: parsePackageNumber(fields.revisions),
    scope: fields.scope
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  });
  const [attempted, setAttempted] = useState(!!initial.saved);
  const frozen = !!initial.error || op.busy || attempted;
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={op.busy || disabled}
      onPress={onPress}
      style={{ padding: 10 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  if (!canSendProposal(conversation, userId)) return null;
  if (!open) return button(t("thread.sendProposal"), () => setOpen(true));
  return (
    <View
      style={{ gap: 8, padding: 12, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
    >
      <ThemedText type="smallBold">{t("thread.sendProposal")}</ThemedText>
      <ScrollView horizontal>
        {SERVICE_TIERS.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: tier === value }}
            disabled={frozen}
            onPress={() => setTier(value)}
            style={{
              padding: 10,
              backgroundColor: tier === value ? theme.backgroundSelected : undefined,
            }}
          >
            <ThemedText>{t(`servicePackages.tier.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal>
        {(appEnv.siteRegion === "cn" ? (["CNY"] as const) : ALL_CURRENCIES).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: currency === value }}
            disabled={frozen}
            onPress={() => setCurrency(value)}
            style={{
              padding: 10,
              backgroundColor: currency === value ? theme.backgroundSelected : undefined,
            }}
          >
            <ThemedText>{value}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      {(["price", "deliveryDays", "revisions", "scope", "note"] as const).map((field) => (
        <View key={field}>
          <ThemedText>
            {t(field === "note" ? "thread.note" : `servicePackages.${field}`)}
          </ThemedText>
          <TextInput
            accessibilityLabel={t(field === "note" ? "thread.note" : `servicePackages.${field}`)}
            value={fields[field]}
            editable={!frozen}
            multiline={field === "scope" || field === "note"}
            maxLength={field === "note" ? 2000 : field === "scope" ? 2411 : 20}
            onChangeText={(value) => setFields((current) => ({ ...current, [field]: value }))}
            style={{ color: theme.text, padding: 8 }}
          />
        </View>
      ))}
      {!parsed.success && <ThemedText>{t("servicePackages.invalid")}</ThemedText>}
      {attempted && <ThemedText>{t("thread.retryHint")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={!!initial.error || op.busy || !parsed.success}
        onPress={() => {
          if (initial.error || !parsed.success) return;
          if (!intent.current) intent.current = { ...parsed.data, clientKey: inquiryKey() };
          const submitted = intent.current;
          setAttempted(true);
          void op.run(
            () => {
              outbox.save(submitted);
              return sendProposal(conversation, userId, submitted);
            },
            () => {
              outbox.clear(submitted.clientKey);
              intent.current = undefined;
              setAttempted(false);
              setOpen(false);
              setError(undefined);
              setFields({ price: "", deliveryDays: "", revisions: "0", scope: "", note: "" });
              refresh();
            },
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
        style={{ padding: 10 }}
      >
        <ThemedText>{t(attempted ? "inbox.retry" : "thread.sendProposal")}</ThemedText>
      </Pressable>
      {button(t("myServices.cancel"), () => setOpen(false), attempted)}
    </View>
  );
}
