import { AgreementDetail } from "./agreement-detail";
import { TaskDetail } from "./task-detail";
import { AuthedWebView } from "@/components/authed-web-view";
import { PayoutDecision } from "./payout-decision";
import { EarningDecision } from "./earning-decision";
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
  userId: string;
  onChanged: () => void;
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
  const [agreementId, setAgreementId] = useState<string>();
  const [taskId, setTaskId] = useState<string>(),
    [webTask, setWebTask] = useState<string>();
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
  if (agreementId)
    return (
      <AgreementDetail
        crewId={props.crewId}
        agreementId={agreementId}
        memberUserId={props.selected.userId}
        userId={props.userId}
        generation={props.generation}
        onClose={() => {
          if (props.generation === getAuthGeneration()) {
            setAgreementId(undefined);
            setRevision((n) => n + 1);
          }
        }}
      />
    );
  if (webTask)
    return (
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setWebTask(undefined);
          }}
        >
          <ThemedText>{t("taskRelations.backToTask")}</ThemedText>
        </Pressable>
        <AuthedWebView
          path={`/crews/${encodeURIComponent(props.crewId)}/workspace?tab=tasks&task=${encodeURIComponent(webTask)}`}
          title={t("crewTasks.title")}
        />
      </View>
    );
  if (taskId)
    return (
      <TaskDetail
        crewId={props.crewId}
        taskId={taskId}
        userId={props.userId}
        generation={props.generation}
        closeLabel={t("crewFinance.backToRecord")}
        onClose={() => {
          if (props.generation !== getAuthGeneration()) return;
          setTaskId(undefined);
          setRevision((n) => n + 1);
        }}
        onOpenWeb={(id) => {
          if (props.generation !== getAuthGeneration()) return;
          setTaskId(id);
          setWebTask(id);
        }}
      />
    );
  const taskLink = (task: { id: string; number: number; title: string }) => (
    <Pressable
      accessibilityRole="button"
      style={{ paddingVertical: 12 }}
      onPress={() => {
        if (props.generation === getAuthGeneration()) setTaskId(task.id);
      }}
    >
      <ThemedText>
        {t("crewFinance.task")} {task.number} · {task.title} · {t("crewFinance.openTask")}
      </ThemedText>
    </Pressable>
  );
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
              {record.task && taskLink(record.task)}
              {record.agreement && (
                <Pressable
                  accessibilityRole="button"
                  style={{ paddingVertical: 12 }}
                  onPress={() => {
                    if (props.generation === getAuthGeneration())
                      setAgreementId(record.agreement!.id);
                  }}
                >
                  <ThemedText>
                    {t("crewFinance.agreement")} · {record.agreement.id} ·{" "}
                    {t("agreementDetail.open")}
                  </ThemedText>
                </Pressable>
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
                  {row.earning.task && taskLink(row.earning.task)}
                </View>
              ))}
            </>
          )}
          {"sourceType" in record && (
            <EarningDecision
              key={`${record.id}:${record.version}`}
              record={record}
              userId={props.userId}
              generation={props.generation}
              onSaved={props.onChanged}
            />
          )}
          {"allocations" in record && (
            <PayoutDecision
              key={`${record.id}:${record.version}`}
              record={record}
              userId={props.userId}
              generation={props.generation}
              onSaved={props.onChanged}
            />
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
