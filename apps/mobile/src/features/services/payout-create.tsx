import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { isChinaRegion } from "@/config/app-env";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskMentionPicker } from "./task-mention-picker";
import {
  createPayout,
  withholdingAmountMinor,
  fetchPayoutCreateAccess,
  newPayout,
  type NewPayout,
} from "./payout-create-api";
import { earningAmountMinor } from "./earning-create-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  refreshKey?: number;
  onSaved: () => void;
};
export function PayoutCreate(props: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  const [lastRefreshKey, setLastRefreshKey] = useState(props.refreshKey);
  if (lastRefreshKey !== props.refreshKey) {
    setLastRefreshKey(props.refreshKey);
    setAllowed(false);
    setError(undefined);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetchPayoutCreateAccess(props.crewId, props.userId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAllowed(value);
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, props.refreshKey]);
  return (
    <>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {allowed && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setOpen(true);
          }}
        >
          <ThemedText>{t("payoutCreate.add")}</ThemedText>
        </Pressable>
      )}
      {open && <Form {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
function Form(props: Props & { onClose: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const currency = isChinaRegion ? "CNY" : "USD";
  const [recipient, setRecipient] = useState<{
      crewMemberId: string;
      userId: string;
      label: string;
    }>(),
    [picking, setPicking] = useState(false);
  const [note, setNote] = useState(""),
    [withholding, setWithholding] = useState("0"),
    [amount, setAmount] = useState("");
  const [review, setReview] = useState(false),
    [error, setError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const request = useRef<NewPayout | null>(null),
    finished = useRef(false);
  const amountMinor = earningAmountMinor(amount);
  const withheldMinor = withholdingAmountMinor(withholding);
  const netMinor =
    amountMinor !== undefined && withheldMinor !== undefined
      ? BigInt(amountMinor) - BigInt(withheldMinor)
      : null;
  const valid = !!recipient && netMinor !== null && netMinor > 0n && note.trim().length <= 10000;
  const close = () => {
    if (!op.busy && props.generation === getAuthGeneration()) props.onClose();
  };
  const save = () => {
    if (
      !valid ||
      !review ||
      !recipient ||
      finished.current ||
      props.generation !== getAuthGeneration()
    )
      return;
    void op.run(
      async () => {
        if (!request.current)
          request.current = newPayout.parse({
            crewMemberId: recipient.crewMemberId,
            withholdingAmountMinor: withheldMinor,
            note: note.trim() || undefined,
            currency,
            amountMinor,
            idempotencyKey: uuid.v4(),
          });
        setAttempted(true);
        setError(undefined);
        return createPayout(
          props.crewId,
          recipient.userId,
          request.current,
          props.userId,
          props.generation
        );
      },
      () => {
        finished.current = true;
        props.onSaved();
        props.onClose();
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        {picking ? (
          <TaskMentionPicker
            crewId={props.crewId}
            userId={props.userId}
            generation={props.generation}
            excludedIds={[]}
            includeSelf
            title={t("crewFinance.recipient")}
            onSelectMember={(member) => {
              setRecipient(member);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        ) : (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 12 }}
          >
            <ThemedText>{t("payoutCreate.add")}</ThemedText>
            <ThemedText>{t("payoutCreate.help")}</ThemedText>
            {review ? (
              <>
                <ThemedText>
                  {recipient?.label} · {recipient?.userId}
                </ThemedText>
                <ThemedText>
                  {t("payoutCreate.gross")} · {formatFinanceMoney(amountMinor!, currency)}
                </ThemedText>
                <ThemedText>
                  {t("crewFinance.withheld")} · {formatFinanceMoney(withheldMinor!, currency)}
                </ThemedText>
                <ThemedText>
                  {t("crewFinance.net")} · {formatFinanceMoney(String(netMinor), currency)}
                </ThemedText>
                {!!note.trim() && <ThemedText>{note.trim()}</ThemedText>}
                <Pressable
                  accessibilityRole="button"
                  disabled={op.busy}
                  style={{ padding: 12 }}
                  onPress={save}
                >
                  <ThemedText>
                    {t(attempted ? "payoutCreate.retry" : "payoutCreate.confirm")}
                  </ThemedText>
                </Pressable>
                {!attempted && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={op.busy}
                    style={{ padding: 12 }}
                    onPress={() => setReview(false)}
                  >
                    <ThemedText>{t("payoutCreate.edit")}</ThemedText>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  style={{ padding: 12 }}
                  onPress={() => setPicking(true)}
                >
                  <ThemedText>
                    {t("crewFinance.recipient")} * · {recipient?.label ?? t("payoutCreate.select")}
                  </ThemedText>
                </Pressable>
                <ThemedText>
                  {t("payoutCreate.amount")} * · {currency}
                </ThemedText>
                <TextInput
                  accessibilityLabel={t("payoutCreate.amount")}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  maxLength={20}
                  style={{ padding: 12, color: theme.text }}
                />
                {!!amount && !amountMinor && (
                  <ThemedText accessibilityRole="alert">
                    {t("payoutCreate.invalidAmount")}
                  </ThemedText>
                )}
                <ThemedText>
                  {t("crewFinance.withheld")} · {currency}
                </ThemedText>
                <TextInput
                  accessibilityLabel={t("crewFinance.withheld")}
                  value={withholding}
                  onChangeText={setWithholding}
                  keyboardType="decimal-pad"
                  maxLength={20}
                  style={{ padding: 12, color: theme.text }}
                />
                {netMinor !== null && netMinor > 0n ? (
                  <ThemedText>
                    {t("crewFinance.net")} · {formatFinanceMoney(String(netMinor), currency)}
                  </ThemedText>
                ) : (
                  <ThemedText>{t("payoutCreate.invalidNet")}</ThemedText>
                )}
                <TextInput
                  accessibilityLabel={t("payoutCreate.note")}
                  placeholder={t("payoutCreate.note")}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={10000}
                  style={{ padding: 12, color: theme.text }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!valid}
                  style={{ padding: 12 }}
                  onPress={() => setReview(true)}
                >
                  <ThemedText>{t("payoutCreate.review")}</ThemedText>
                </Pressable>
              </>
            )}
            {op.busy && <ActivityIndicator />}
            {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
            {attempted && <ThemedText>{t("payoutCreate.retryHelp")}</ThemedText>}
            <Pressable
              accessibilityRole="button"
              disabled={op.busy}
              style={{ padding: 12 }}
              onPress={close}
            >
              <ThemedText>{t("crewTasks.back")}</ThemedText>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}
