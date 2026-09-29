import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations, type MessageKey } from "@/i18n";
import { fetchFinanceDetail, financeProofUrl } from "./crew-finance-detail-api";
import { formatFinanceMoney, type FinanceRow, type FinanceView } from "./crew-finance-api";
type Props = {
  crewId: string;
  view: FinanceView;
  selected: FinanceRow;
  generation: number;
  onClose: () => void;
};
const actions: Record<string, MessageKey> = {
  "earning.created": "crewFinance.eventCreated",
  "earning.posted": "crewFinance.eventPosted",
  "earning.rejected": "crewFinance.eventRejected",
  "earning.reversed": "crewFinance.eventReversed",
  "earning.task_reward_posted": "crewFinance.eventTaskReward",
  "payout.created": "crewFinance.eventCreated",
  "payout.paid": "crewFinance.eventPaid",
  "payout.voided": "crewFinance.eventVoided",
};
export function CrewFinanceDetail(props: Props) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return (
    <Session
      key={`${props.crewId}:${props.view}:${props.selected.id}:${props.generation}`}
      {...props}
    />
  );
}
function Session(props: Props) {
  const t = useTranslations(),
    [revision, setRevision] = useState(0),
    [proofError, setProofError] = useState<string>();
  const [snapshot, setSnapshot] = useState<{
    revision: number;
    record?: Awaited<ReturnType<typeof fetchFinanceDetail>>;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchFinanceDetail(props.crewId, props.view, props.selected, controller.signal).then(
      (record) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, record });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.view, props.selected, props.generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined,
    record = visible?.record;
  const money = (value: string) => formatFinanceMoney(value, props.selected.currency);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewFinance.details")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {record && (
        <>
          <ThemedText>{"title" in record ? record.title : t("crewFinance.payouts")}</ThemedText>
          <ThemedText>
            {money(record.amountMinor)} · {t(`crewFinance.${record.status}`)}
          </ThemedText>
          <ThemedText>
            {t("crewFinance.recipient")} · {record.userId}
          </ThemedText>
          <ThemedText>{new Date(record.createdAt).toLocaleString()}</ThemedText>
          {"sourceType" in record ? (
            <>
              <ThemedText>{t(`crewFinance.source_${record.sourceType}`)}</ThemedText>
              {!!record.description && <ThemedText>{record.description}</ThemedText>}
              {record.task && (
                <ThemedText>
                  {t("crewFinance.task")} {record.task.number} · {record.task.title}
                </ThemedText>
              )}
              {record.agreement && (
                <ThemedText>
                  {t("crewFinance.agreement")} · {record.agreement.id} · {record.agreement.status}
                </ThemedText>
              )}
              {!!record.rejectionReason && (
                <ThemedText>
                  {t("crewFinance.rejectionReason")} · {record.rejectionReason}
                </ThemedText>
              )}
              {!!record.reversalReason && (
                <ThemedText>
                  {t("crewFinance.reversalReason")} · {record.reversalReason}
                </ThemedText>
              )}
            </>
          ) : (
            <>
              <ThemedText>
                {t("crewFinance.net")} · {money(record.netAmountMinor)}
              </ThemedText>
              <ThemedText>
                {t("crewFinance.withheld")} · {money(record.withholdingAmountMinor)}
              </ThemedText>
              {!!record.note && <ThemedText>{record.note}</ThemedText>}
              {record.paymentMethod && (
                <ThemedText>{t(`crewFinance.method_${record.paymentMethod}`)}</ThemedText>
              )}
              {!!record.paymentReference && (
                <ThemedText>
                  {t("crewFinance.reference")} · {record.paymentReference}
                </ThemedText>
              )}
              {!!record.voidReason && (
                <ThemedText>
                  {t("crewFinance.voidReason")} · {record.voidReason}
                </ThemedText>
              )}
              {financeProofUrl(record.paymentProofUrl) && (
                <Pressable
                  accessibilityRole="link"
                  style={{ padding: 12 }}
                  onPress={() => {
                    const url = financeProofUrl(record.paymentProofUrl);
                    if (!url || props.generation !== getAuthGeneration()) return;
                    void Linking.openURL(url).catch((cause) => {
                      if (props.generation === getAuthGeneration())
                        setProofError(cause instanceof Error ? cause.message : String(cause));
                    });
                  }}
                >
                  <ThemedText>{t("crewFinance.proof")}</ThemedText>
                </Pressable>
              )}
              {proofError && <ThemedText accessibilityRole="alert">{proofError}</ThemedText>}
              <ThemedText>{t("crewFinance.allocations")}</ThemedText>
              {record.allocations.map((row) => (
                <View key={row.id} style={{ gap: 6 }}>
                  <ThemedText>
                    {row.earning.title} · {money(row.amountMinor)}
                  </ThemedText>
                  {row.earning.task && (
                    <ThemedText>
                      {t("crewFinance.task")} {row.earning.task.number} · {row.earning.task.title}
                    </ThemedText>
                  )}
                </View>
              ))}
            </>
          )}
          <ThemedText>{t("crewFinance.audit")}</ThemedText>
          {record.events.length === 0 && <ThemedText>{t("crewFinance.noEvents")}</ThemedText>}
          {record.events.map((event) => (
            <View key={event.id} style={{ gap: 6 }}>
              <ThemedText>
                {actions[event.action] ? t(actions[event.action]!) : event.action}
              </ThemedText>
              <ThemedText>
                {new Date(event.createdAt).toLocaleString()} · {event.actorUserId}
              </ThemedText>
            </View>
          ))}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewFinance.backToLedger")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
