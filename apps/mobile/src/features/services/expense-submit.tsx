import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { type ExpenseRecord } from "./crew-expenses-api";
import { formatFinanceMoney } from "./crew-finance-api";
import { canSubmitExpense, submitExpense } from "./expense-submit-api";
export function ExpenseSubmit({
  record,
  userId,
  generation,
  onSaved,
}: {
  record: ExpenseRecord;
  userId: string;
  generation: number;
  onSaved: () => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(`${record.id}:${record.version}`, true);
  const [review, setReview] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  if (record.claimantUserId !== userId || record.submissionStatus !== null) return null;
  if (!canSubmitExpense(record)) return <ThemedText>{t("expenseSubmit.incomplete")}</ThemedText>;
  return (
    <View style={{ gap: 12 }}>
      {!review ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => {
            if (generation === getAuthGeneration()) setReview(true);
          }}
        >
          <ThemedText>{t("crewExpenses.submit")}</ThemedText>
        </Pressable>
      ) : (
        <>
          <ThemedText>{t("expenseSubmit.review")}</ThemedText>
          <ThemedText>
            {record.definition.category} · {t("crewExpenses.revision")} {record.version}
          </ThemedText>
          <ThemedText>{record.definition.purpose}</ThemedText>
          <ThemedText>
            {record.definition.occurredOn} ·{" "}
            {formatFinanceMoney(record.definition.amountMinor!, record.definition.currency)}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.receipts")} · {record.definition.receiptIds?.length ?? 0}
          </ThemedText>
          <ThemedText>{t("crewExpenses.note")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            disabled={op.busy}
            onPress={() => {
              if (generation !== getAuthGeneration()) return;
              void op.run(
                () => {
                  setAttempted(true);
                  return submitExpense(record, userId, generation);
                },
                onSaved,
                (e) => setError(e instanceof Error ? e.message : String(e))
              );
            }}
          >
            <ThemedText>
              {t(attempted ? "expenseSubmit.retry" : "expenseSubmit.confirm")}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            disabled={op.busy || attempted}
            onPress={() => setReview(false)}
          >
            <ThemedText>{t("common.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("expenseSubmit.retryHelp")}</ThemedText>}
    </View>
  );
}
