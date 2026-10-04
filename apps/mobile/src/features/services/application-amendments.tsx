import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { formatFinanceMoney } from "./crew-finance-api";
import { proposalMinor } from "./terms-proposal-api";
import { type Terms } from "./application-terms-api";
import {
  amendmentProposal,
  fetchAmendmentContext,
  fetchApplicationAmendments,
  proposeAmendment,
  decideAmendment,
  canDecideAmendment,
  type AmendmentProposal,
  type ApplicationAmendment,
  type AmendmentDecision,
} from "./application-amendments-api";
type Props = {
  active?: boolean;
  crewId: string;
  applicationId: string;
  applicantId: string;
  taskId?: string;
  userId: string;
  generation: number;
  reviewer?: boolean;
  onClose: () => void;
};
type Request =
  | { kind: "proposal"; data: AmendmentProposal }
  | { kind: "decision"; row: ApplicationAmendment; action: AmendmentDecision };
export function ApplicationAmendments(props: Props) {
  const [revision, setRevision] = useState(0),
    [cursor, setCursor] = useState<string | null>(null);
  return (
    <Session
      key={`${revision}:${cursor}`}
      {...props}
      cursor={cursor}
      onMore={setCursor}
      onRefresh={() => {
        setCursor(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function major(value: string) {
  const n = BigInt(value);
  return `${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
function Session(
  props: Props & { cursor: string | null; onMore: (s: string) => void; onRefresh: () => void }
) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.applicationId, true);
  const [readRevision, setReadRevision] = useState(0);
  const [context, setContext] = useState<Awaited<ReturnType<typeof fetchAmendmentContext>>>(),
    [page, setPage] = useState<Awaited<ReturnType<typeof fetchApplicationAmendments>>>();
  const [error, setError] = useState<string>(),
    [draft, setDraft] = useState<{
      scope: string;
      fee: string;
      share: string;
      basis: string;
      reason: string;
    }>();
  const [retry, setRetry] = useState<Request>(),
    [denied, setDenied] = useState(false),
    [saved, setSaved] = useState<ApplicationAmendment>(),
    [decision, setDecision] = useState<Extract<Request, { kind: "decision" }>>();
  const readKey = `${props.active !== false}:${readRevision}`;
  const [lastReadKey, setLastReadKey] = useState(readKey);
  if (lastReadKey !== readKey) {
    setLastReadKey(readKey);
    setError(undefined);
    setContext(undefined);
    setPage(undefined);
  }
  useEffect(() => {
    if (props.active === false) return;
    const c = new AbortController();
    void (async () => {
      const ctx = await fetchAmendmentContext(
        props.crewId,
        props.applicationId,
        props.applicantId,
        props.taskId,
        props.userId,
        !!props.reviewer,
        props.generation,
        c.signal
      );
      const history = await fetchApplicationAmendments(
        ctx.scope,
        props.cursor,
        props.generation,
        c.signal
      );
      if (!c.signal.aborted && props.generation === getAuthGeneration()) {
        setContext(ctx);
        setPage(history);
      }
    })().catch((cause) => {
      if (!c.signal.aborted && props.generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => c.abort();
  }, [
    props.crewId,
    props.applicationId,
    props.applicantId,
    props.taskId,
    props.userId,
    props.reviewer,
    props.generation,
    props.cursor,
    props.active,
    readRevision,
  ]);
  const effective = context?.terms.items.find(
    (r) => r.version === context.terms.currentVersion && r.confirmedAt
  );
  const locked = op.busy || !!retry || denied || !!saved;
  const write = (request: Request) => {
    if (
      props.active === false ||
      !context ||
      props.generation !== getAuthGeneration() ||
      denied ||
      saved
    )
      return;
    void op.run(
      () => {
        setError(undefined);
        return request.kind === "proposal"
          ? proposeAmendment(context.scope, request.data, props.userId, props.generation)
          : decideAmendment(request.row, props.userId, props.generation, request.action);
      },
      (result) => {
        setSaved(result);
        setRetry(undefined);
        setDecision(undefined);
        setDraft(undefined);
      },
      (cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        const status =
          cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 403, 404, 409, 422].includes(status)) {
          setDenied(true);
          setRetry(undefined);
        } else setRetry(request);
      }
    );
  };
  const send = () => {
    if (props.active === false || !context || !effective || !draft || !context.canPropose || locked)
      return;
    const share = proposalMinor(draft.share);
    const parsed = amendmentProposal.safeParse({
      id: uuid.v4(),
      expectedVersion: effective.version,
      expectedTaskVersion: context.taskVersion,
      scope: draft.scope,
      feeAmount: proposalMinor(draft.fee),
      currency: effective.currency,
      feePeriod: "project",
      revenueShareBp: share === null ? null : Number(share),
      shareBasis: share !== null && BigInt(share) > 0n ? draft.basis.trim() || null : null,
      reason: draft.reason,
    });
    if (!parsed.success) {
      setError(t("nativeAmendments.invalid"));
      return;
    }
    write({ kind: "proposal", data: parsed.data });
  };
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || op.busy }}
      disabled={disabled || op.busy}
      onPress={onPress}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled || op.busy ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const termsView = (row: Terms | AmendmentProposal) => (
    <View style={{ gap: 6 }}>
      <ThemedText>{row.scope}</ThemedText>
      <ThemedText>
        {formatFinanceMoney(row.feeAmount, row.currency)} / {t("crewTerms.project")}
      </ThemedText>
      <ThemedText>
        {t("crewTerms.share")} · {(row.revenueShareBp / 100).toFixed(2)}%
      </ThemedText>
      {row.shareBasis && <ThemedText>{row.shareBasis}</ThemedText>}
    </View>
  );
  const canPropose =
    context?.canPropose &&
    effective?.feePeriod === "project" &&
    context.taskVersion !== null &&
    props.cursor === null &&
    !page?.items.some((r) => ["pending", "awaiting_settlement"].includes(r.status));
  if (props.active === false) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("crewAmendments.title")}</ThemedText>
      <ThemedText>{t("crewAmendments.boundary")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {effective && !saved && (
        <>
          <ThemedText>
            {t("crewAmendments.effective").replace("{version}", String(effective.version))}
          </ThemedText>
          {termsView(effective)}
        </>
      )}
      {saved && (
        <ThemedText>
          {t("crewAmendments.saved")} · {t(`crewAmendments.status.${saved.status}`)}
        </ThemedText>
      )}
      {retry && context && (
        <>
          <ThemedText>{t("crewAmendments.retryHelp")}</ThemedText>
          {action(t("crewAmendments.retry"), () => write(retry))}
        </>
      )}
      {denied && <ThemedText>{t("crewAmendments.stale")}</ThemedText>}
      {canPropose &&
        !draft &&
        !saved &&
        action(
          t("crewAmendments.propose"),
          () =>
            setDraft({
              scope: effective!.scope,
              fee: major(effective!.feeAmount),
              share: major(String(effective!.revenueShareBp)),
              basis: effective!.shareBasis ?? "",
              reason: "",
            }),
          locked || !!decision
        )}
      {draft && context && effective && (
        <>
          <ThemedText>
            {t("crewAmendments.basedOn")
              .replace("{terms}", String(effective.version))
              .replace("{task}", String(context.taskVersion))}
          </ThemedText>
          <ThemedText>
            {effective.currency} · {t("crewTerms.project")}
          </ThemedText>
          {(["scope", "fee", "share", "basis", "reason"] as const).map((key) => (
            <View key={key} style={{ gap: 6 }}>
              <ThemedText>{t(`crewAmendments.${key}`)}</ThemedText>
              <TextInput
                accessibilityLabel={t(`crewAmendments.${key}`)}
                value={draft[key]}
                editable={!locked}
                multiline={!["fee", "share"].includes(key)}
                keyboardType={["fee", "share"].includes(key) ? "decimal-pad" : "default"}
                maxLength={
                  key === "scope" ? 10000 : key === "basis" ? 5000 : key === "reason" ? 4000 : 17
                }
                onChangeText={(value) => setDraft({ ...draft, [key]: value })}
                style={{
                  color: theme.text,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                }}
              />
            </View>
          ))}
          {action(t("crewAmendments.sendProposal"), send, locked)}
        </>
      )}
      <ThemedText>{t("crewAmendments.historyHelp")}</ThemedText>
      {page?.items.length === 0 && <ThemedText>{t("crewAmendments.empty")}</ThemedText>}
      {page?.items.map((original) => {
        const row = saved?.id === original.id ? saved : original;
        return (
          <View
            key={row.id}
            style={{
              gap: 8,
              padding: 12,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          >
            <ThemedText>{t(`crewAmendments.status.${row.status}`)}</ThemedText>
            <ThemedText>
              {t("crewAmendments.proposer").replace("{id}", row.proposedByUserId)}
            </ThemedText>
            <ThemedText>
              {t("crewAmendments.basedOn")
                .replace("{terms}", String(row.proposal.expectedVersion))
                .replace("{task}", String(row.proposal.expectedTaskVersion))}
            </ThemedText>
            {termsView(row.proposal)}
            <ThemedText>
              {t("crewAmendments.reason")}: {row.proposal.reason}
            </ThemedText>
            {(["confirm", "reject", "withdraw"] as const)
              .filter(
                (a) =>
                  canDecideAmendment(row, props.userId, a) &&
                  (a !== "withdraw" || context?.canWithdraw)
              )
              .map((a) => (
                <View key={a}>
                  {action(
                    t(`crewAmendments.${a}`),
                    () => setDecision({ kind: "decision", row, action: a }),
                    locked || !!draft || !!decision
                  )}
                </View>
              ))}
          </View>
        );
      })}
      {decision && context && page && !saved && !retry && (
        <>
          <ThemedText>
            {t("nativeAmendments.confirmDecision")
              .replace("{action}", t(`crewAmendments.${decision.action}`))
              .replace("{id}", decision.row.id)}
          </ThemedText>
          {action(t("applicationReview.confirm"), () => write(decision), locked)}
          {action(t("report.cancel"), () => setDecision(undefined), locked)}
        </>
      )}
      {!context && error && action(t("common.retry"), () => setReadRevision((n) => n + 1))}
      {op.busy && <ActivityIndicator />}
      {page?.nextCursor &&
        action(
          t("crewAmendments.more"),
          () => props.onMore(page.nextCursor!),
          !!retry || !!draft || !!decision
        )}
      {action(
        t(draft ? "crewAmendments.discard" : "crewAmendments.refresh"),
        props.onRefresh,
        !!retry
      )}
      {action(t("nativeApplications.back"), props.onClose)}
    </ScrollView>
  );
}
