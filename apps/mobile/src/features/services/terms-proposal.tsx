import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { formatFinanceMoney } from "./crew-finance-api";
import { fetchApplicationTerms } from "./application-terms-api";
import {
  fetchProposalContext,
  proposalCurrency,
  proposalMinor,
  proposeApplicationTerms,
  termsProposal,
  type TermsProposal,
} from "./terms-proposal-api";
type Props = {
  crewId: string;
  applicationId: string;
  userId: string;
  generation: number;
  onClose: () => void;
};
export function TermsProposalScreen(props: Props) {
  const [revision, setRevision] = useState(0),
    [before, setBefore] = useState<number | null>(null);
  return (
    <ProposalSession
      key={`${revision}:${before}`}
      {...props}
      before={before}
      onMore={setBefore}
      onRefresh={() => {
        setBefore(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function ProposalSession(
  props: Props & { before: number | null; onMore: (n: number) => void; onRefresh: () => void }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.applicationId, true);
  const [context, setContext] = useState<Awaited<ReturnType<typeof fetchProposalContext>>>();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchApplicationTerms>>>();
  const [error, setError] = useState<string>(),
    [scope, setScope] = useState(""),
    [fee, setFee] = useState(""),
    [share, setShare] = useState("0"),
    [basis, setBasis] = useState("");
  const [period, setPeriod] = useState<TermsProposal["feePeriod"]>("project");
  const [retry, setRetry] = useState<TermsProposal>(),
    [denied, setDenied] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      const value = await fetchProposalContext(
        props.crewId,
        props.applicationId,
        props.generation,
        c.signal
      );
      const page =
        props.before === null
          ? value.terms
          : await fetchApplicationTerms(props.applicationId, props.before, c.signal);
      if (!c.signal.aborted && props.generation === getAuthGeneration()) {
        setContext(value);
        setHistory(page);
      }
    })().catch((cause) => {
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => c.abort();
  }, [props.crewId, props.applicationId, props.generation, props.before]);
  const locked = op.busy || !!retry || denied || saved;
  const write = () => {
    if (!context || denied || saved || props.generation !== getAuthGeneration()) return;
    const feeAmount = proposalMinor(fee),
      shareBp = proposalMinor(share);
    const parsed = termsProposal.safeParse(
      retry ?? {
        expectedVersion: context.terms.currentVersion,
        scope,
        feeAmount,
        currency: proposalCurrency,
        feePeriod: context.taskLinked ? "project" : period,
        revenueShareBp: shareBp === null ? null : Number(shareBp),
        shareBasis: shareBp !== null && BigInt(shareBp) > 0n ? basis.trim() || null : null,
      }
    );
    if (!parsed.success) {
      setError(t("crewTerms.invalid"));
      return;
    }
    const data = parsed.data;
    if (context.taskLinked && BigInt(data.feeAmount) > 10_000_000_000n) {
      setError(t("termsProposal.taskFee"));
      return;
    }
    void op.run(
      () => {
        setError(undefined);
        return proposeApplicationTerms(
          context.app,
          context.taskLinked,
          data,
          props.userId,
          props.generation
        );
      },
      () => {
        setRetry(undefined);
        setSaved(true);
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        const status =
          cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 403, 404, 409, 422].includes(status)) {
          setRetry(undefined);
          setDenied(true);
        } else setRetry(data);
      }
    );
  };
  const action = (label: string, onPress: () => void, disabled = false, selected = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy, selected }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? theme.brand : theme.border,
        backgroundColor: theme.backgroundElement,
        opacity: disabled || op.busy ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const field = (
    key: Parameters<typeof t>[0],
    value: string,
    change: (s: string) => void,
    maxLength: number,
    decimal = false
  ) => (
    <View style={{ gap: 6 }}>
      <ThemedText>
        {t(key)}
        {key === "crewTerms.fee" ? ` (${proposalCurrency})` : ""}
      </ThemedText>
      <TextInput
        accessibilityLabel={t(key)}
        value={value}
        onChangeText={change}
        editable={!locked}
        maxLength={maxLength}
        multiline={!decimal}
        keyboardType={decimal ? "decimal-pad" : "default"}
        style={{
          color: theme.text,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          minHeight: decimal ? 44 : 90,
        }}
      />
    </View>
  );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("crewTerms.title")}</ThemedText>
      {!context && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("termsProposal.saved")}</ThemedText>}
      {context && history && (
        <>
          <ThemedText>
            {context.app.applicantId} · {context.app.positionId}
          </ThemedText>
          {history.items.length === 0 && <ThemedText>{t("crewTerms.none")}</ThemedText>}
          {history.items.map((row) => (
            <View
              key={row.id}
              style={{
                padding: 12,
                gap: 8,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
              }}
            >
              <ThemedText>
                {t("crewTerms.version").replace("{version}", String(row.version))} ·{" "}
                {t(row.confirmedAt ? "crewTerms.confirmed" : "crewTerms.awaiting")}
              </ThemedText>
              <ThemedText>{row.scope}</ThemedText>
              <ThemedText>
                {formatFinanceMoney(row.feeAmount, row.currency)} /{" "}
                {t(`crewTerms.${row.feePeriod}`)}
              </ThemedText>
              <ThemedText>
                {t("crewTerms.share")} · {(row.revenueShareBp / 100).toFixed(2)}%
              </ThemedText>
              {row.shareBasis && <ThemedText>{row.shareBasis}</ThemedText>}
            </View>
          ))}
          {history.nextBeforeVersion !== null &&
            action(t("crewTerms.more"), () => props.onMore(history.nextBeforeVersion!), !!retry)}
          {props.before === null &&
            context.app.status === "pending" &&
            context.app.applicantId !== props.userId &&
            !saved && (
              <>
                <ThemedText>
                  {t("crewTerms.draftVersion").replace(
                    "{version}",
                    String(context.terms.currentVersion)
                  )}
                </ThemedText>
                {field("crewTerms.scope", scope, setScope, 10000)}
                {field("crewTerms.fee", fee, setFee, 17, true)}
                <ThemedText>{t("crewTerms.period")}</ThemedText>
                {(["project", "episode", "month"] as const).map((p) => (
                  <View key={p}>
                    {action(
                      t(`crewTerms.${p}`),
                      () => setPeriod(p),
                      locked || (context.taskLinked && p !== "project"),
                      p === (context.taskLinked ? "project" : period)
                    )}
                  </View>
                ))}
                {context.taskLinked && <ThemedText>{t("termsProposal.taskFee")}</ThemedText>}
                {field("crewTerms.share", share, setShare, 5, true)}
                {field("crewTerms.basis", basis, setBasis, 5000)}
                <ThemedText>{t("crewTerms.noPayment")}</ThemedText>
                {retry ? (
                  <>
                    <ThemedText>{t("termsProposal.retryHelp")}</ThemedText>
                    {action(t("termsProposal.retry"), write)}
                  </>
                ) : (
                  action(t("crewTerms.propose"), write, locked)
                )}
                {denied && <ThemedText>{t("termsProposal.changed")}</ThemedText>}
              </>
            )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {action(t(saved ? "crewTerms.refresh" : "crewTerms.discardDraft"), props.onRefresh, !!retry)}
      {action(t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
