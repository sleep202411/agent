import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchPayoutDecisionAccess,
  decidePayout,
  payoutDecisionInput,
  payoutMethods,
  type DecisionPayout,
} from "./payout-decision-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = {
  record: DecisionPayout;
  userId: string;
  generation: number;
  onSaved: () => void;
};
export function PayoutDecision(props: Props) {
  return (
    <PayoutDecisionForm
      key={JSON.stringify([
        props.record.crewId,
        props.record.id,
        props.record.version,
        props.userId,
        props.generation,
      ])}
      {...props}
    />
  );
}
function PayoutDecisionForm({ record, userId, generation, onSaved }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${record.id}:${record.version}`, true);
  const [allowed, setAllowed] = useState(false),
    [error, setError] = useState<string>(),
    [accessError, setAccessError] = useState<string>(),
    [revision, setRevision] = useState(0),
    [choice, setChoice] = useState<"pay" | "void">(),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [proof, setProof] = useState(""),
    [method, setMethod] = useState<(typeof payoutMethods)[number]>("bank_transfer"),
    [attempted, setAttempted] = useState(false);
  const sent = useRef(false),
    locked = attempted || op.busy;
  useEffect(() => {
    const controller = new AbortController();
    void fetchPayoutDecisionAccess(record.crewId, userId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setAllowed(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAccessError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [record.crewId, userId, generation, revision]);
  const parsed = payoutDecisionInput.safeParse(
    choice === "pay"
      ? {
          action: "pay",
          paymentMethod: method,
          paymentReference: reference,
          ...(proof.trim() ? { paymentProofUrl: proof } : {}),
        }
      : { action: "void", reason }
  );
  return (
    <View style={{ gap: 12 }}>
      {accessError && (
        <View style={{ gap: 6 }}>
          <ThemedText accessibilityRole="alert">{accessError}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              setAccessError(undefined);
              setRevision((value) => value + 1);
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
      {allowed &&
        record.status === "pending" &&
        !choice &&
        (["pay", "void"] as const).map((action) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (generation === getAuthGeneration()) setChoice(action);
            }}
          >
            <ThemedText>{t(`crewFinance.payout_${action}`)}</ThemedText>
          </Pressable>
        ))}
      {choice && (
        <>
          <ThemedText>
            {t(`crewFinance.payout_${choice}`)} ·{" "}
            {formatFinanceMoney(record.netAmountMinor, record.currency)}
          </ThemedText>
          <ThemedText>
            {t(choice === "pay" ? "crewFinance.recordPaymentHelp" : "crewFinance.voidHelp")}
          </ThemedText>
          {choice === "pay" ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {payoutMethods.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: value === method }}
                    disabled={locked}
                    style={{ padding: 10 }}
                    onPress={() => setMethod(value)}
                  >
                    <ThemedText>{t(`crewFinance.method_${value}`)}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel={t("crewFinance.reference")}
                placeholder={t("crewFinance.reference")}
                value={reference}
                onChangeText={setReference}
                editable={!locked}
                maxLength={180}
                style={{ padding: 12, color: theme.text }}
              />
              <TextInput
                accessibilityLabel={t("crewFinance.proofUrl")}
                placeholder={t("crewFinance.proofUrl")}
                value={proof}
                onChangeText={setProof}
                editable={!locked}
                autoCapitalize="none"
                maxLength={1024}
                style={{ padding: 12, color: theme.text }}
              />
            </>
          ) : (
            <TextInput
              accessibilityLabel={t("crewFinance.decisionReason")}
              placeholder={t("crewFinance.decisionReason")}
              value={reason}
              onChangeText={setReason}
              editable={!locked}
              multiline
              maxLength={2000}
              style={{ padding: 12, color: theme.text }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            disabled={locked || !parsed.success}
            style={{ padding: 12 }}
            onPress={() => {
              if (sent.current || generation !== getAuthGeneration() || !allowed || !parsed.success)
                return;
              const input = parsed.data;
              void op.run(
                () => {
                  sent.current = true;
                  setAttempted(true);
                  return decidePayout(record, input, userId, generation);
                },
                onSaved,
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          >
            <ThemedText>{t("crewFinance.confirmDecision")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() => setChoice(undefined)}
          >
            <ThemedText>{t("episodeOrganization.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("crewFinance.decisionRefresh")}</ThemedText>}
    </View>
  );
}
