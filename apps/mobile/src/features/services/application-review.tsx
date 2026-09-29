import { ApplicationAmendments } from "./application-amendments";
import { TermsProposalScreen } from "./terms-proposal";
import { ApplicationInterview } from "./application-interview";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { formatFinanceMoney } from "./crew-finance-api";
import {
  fetchReviewApplications,
  fetchReviewApplication,
  canApproveReview,
  decideReviewApplication,
  type ReviewStatus,
} from "./application-review-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onWeb: () => void;
};
export function ApplicationReview(props: Props) {
  const [selected, setSelected] = useState<string>(),
    [status, setStatus] = useState<ReviewStatus>("pending"),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  if (selected)
    return (
      <Review
        key={selected}
        {...props}
        applicationId={selected}
        onClose={() => {
          setSelected(undefined);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <ReviewList
      key={`${status}:${cursor}:${revision}`}
      {...props}
      status={status}
      cursor={cursor}
      onSelect={setSelected}
      onMore={setCursor}
      onStatus={(s) => {
        setStatus(s);
        setCursor(null);
      }}
      onRefresh={() => {
        setCursor(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function ReviewList(
  props: Props & {
    status: ReviewStatus;
    cursor: string | null;
    onSelect: (id: string) => void;
    onMore: (cursor: string) => void;
    onStatus: (status: ReviewStatus) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchReviewApplications>>>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchReviewApplications(
      props.crewId,
      props.generation,
      props.status,
      props.cursor,
      c.signal
    ).then(
      (value) => {
        if (!c.signal.aborted) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.generation, props.status, props.cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("applicationReview.title")}</ThemedText>
      {(["pending", "approved", "rejected"] as const).map((status) => (
        <Action
          key={status}
          selected={status === props.status}
          label={t(`crewTerms.${status}`)}
          onPress={() => props.onStatus(status)}
        />
      ))}
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.items.map((row) => (
        <Action
          key={row.id}
          label={`${row.applicantId} · ${row.positionId} · ${row.createdAt.slice(0, 10)}`}
          onPress={() => props.onSelect(row.id)}
        />
      ))}
      {page?.items.length === 0 && <ThemedText>{t("crewTerms.empty")}</ThemedText>}
      {page?.nextCursor && (
        <Action label={t("crewTerms.more")} onPress={() => props.onMore(page.nextCursor!)} />
      )}
      <Action label={t("crewTerms.refresh")} onPress={props.onRefresh} />
      <Action label={t("nativeApplications.webWorkflow")} onPress={props.onWeb} />
      <Action label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Review(props: Props & { applicationId: string }) {
  const [revision, setRevision] = useState(0);
  const [proposal, setProposal] = useState(false);
  const [amendmentApplicant, setAmendmentApplicant] = useState<string>();
  const [interviewApplicant, setInterviewApplicant] = useState<string>();
  if (amendmentApplicant)
    return (
      <ApplicationAmendments
        {...props}
        applicantId={amendmentApplicant}
        reviewer
        onClose={() => {
          setAmendmentApplicant(undefined);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (proposal)
    return (
      <TermsProposalScreen
        {...props}
        onClose={() => {
          setProposal(false);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (interviewApplicant)
    return (
      <ApplicationInterview
        applicationId={props.applicationId}
        applicantId={interviewApplicant}
        reviewer
        userId={props.userId}
        generation={props.generation}
        onClose={() => {
          setInterviewApplicant(undefined);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <ReviewDetail
      key={revision}
      {...props}
      onAmendments={setAmendmentApplicant}
      onProposal={() => setProposal(true)}
      onInterview={setInterviewApplicant}
      onRefresh={() => setRevision((n) => n + 1)}
    />
  );
}
function ReviewDetail(
  props: Props & {
    applicationId: string;
    onProposal: () => void;
    onAmendments: (applicantId: string) => void;
    onInterview: (applicantId: string) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations(),
    locale = useLocale(),
    op = useAuthFormOperation(props.applicationId, true);
  const [review, setReview] = useState<Awaited<ReturnType<typeof fetchReviewApplication>>>(),
    [error, setError] = useState<string>();
  const [decision, setDecision] = useState<"approve" | "reject">(),
    [attempted, setAttempted] = useState(false),
    [result, setResult] = useState<ReviewStatus>();
  useEffect(() => {
    const c = new AbortController();
    void fetchReviewApplication(props.crewId, props.applicationId, props.generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted) setReview(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.applicationId, props.generation]);
  const latest = review?.terms.items.find((row) => row.version === review.terms.currentVersion);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("applicationReview.title")}</ThemedText>
      {!review && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {review && (
        <>
          <ThemedText>
            {review.app.applicantId} · {review.app.positionId}
          </ThemedText>
          <ThemedText>{t(`crewTerms.${result ?? review.app.status}`)}</ThemedText>
          {review.app.message && <ThemedText>{review.app.message}</ThemedText>}
          {review.app.portfolioUrl && <ThemedText>{review.app.portfolioUrl}</ThemedText>}
          {review.app.expectedCompensation && (
            <ThemedText>
              {t("applicationReview.expected")} · {review.app.expectedCompensation.currency}{" "}
              {review.app.expectedCompensation.amount.toLocaleString(locale)} /{" "}
              {review.app.expectedCompensation.period}
            </ThemedText>
          )}
          {review.app.availableStartDate && (
            <ThemedText>
              {t("applicationReview.start")} · {review.app.availableStartDate}
            </ThemedText>
          )}
          {review.app.yearsExperience !== null && (
            <ThemedText>
              {t("applicationReview.experience")} · {review.app.yearsExperience}
            </ThemedText>
          )}
          <ThemedText>{t("crewTerms.title")}</ThemedText>
          {latest ? (
            <>
              <ThemedText>
                {t("crewTerms.version").replace("{version}", String(latest.version))} ·{" "}
                {t(latest.confirmedAt ? "crewTerms.confirmed" : "crewTerms.awaiting")}
              </ThemedText>
              <ThemedText>{latest.scope}</ThemedText>
              <ThemedText>
                {formatFinanceMoney(latest.feeAmount, latest.currency)} /{" "}
                {t(`crewTerms.${latest.feePeriod}`)}
              </ThemedText>
              <ThemedText>
                {t("crewTerms.share")} · {(latest.revenueShareBp / 100).toFixed(2)}%
              </ThemedText>
              {latest.shareBasis && <ThemedText>{latest.shareBasis}</ThemedText>}
            </>
          ) : (
            <ThemedText>{t("crewTerms.none")}</ThemedText>
          )}
          <ThemedText>
            {t("crewInterview.title")} · {t(`crewInterview.${review.interview.state}`)}
          </ThemedText>
          {review.interview.scheduledAt && (
            <ThemedText>{new Date(review.interview.scheduledAt).toLocaleString(locale)}</ThemedText>
          )}
          {review.interview.items.map((event) => (
            <ThemedText key={event.id}>
              {t(`crewInterview.${event.action}`)} ·{" "}
              {new Date(event.createdAt).toLocaleString(locale)} · {event.message}
            </ThemedText>
          ))}
          <Action
            disabled={op.busy}
            label={t("reviewerInterview.open")}
            onPress={() => props.onInterview(review.app.applicantId)}
          />
          <Action disabled={op.busy} label={t("termsProposal.open")} onPress={props.onProposal} />
          {(result ?? review.app.status) === "approved" && (
            <Action
              disabled={op.busy}
              label={t("crewAmendments.title")}
              onPress={() => props.onAmendments(review.app.applicantId)}
            />
          )}
          <ThemedText>{t("applicationReview.requirements")}</ThemedText>
          {review.app.status === "pending" && !result && !attempted && (
            <>
              {!decision ? (
                <>
                  <Action
                    disabled={!canApproveReview(review, props.userId)}
                    label={t("applicationReview.approve")}
                    onPress={() => setDecision("approve")}
                  />
                  <Action
                    label={t("applicationReview.reject")}
                    onPress={() => setDecision("reject")}
                  />
                </>
              ) : (
                <>
                  <ThemedText>
                    {t(
                      decision === "approve"
                        ? "applicationReview.approveHelp"
                        : "applicationReview.rejectHelp"
                    )}
                  </ThemedText>
                  <Action
                    disabled={op.busy}
                    label={t("applicationReview.confirm")}
                    onPress={() =>
                      void op.run(
                        () => {
                          setAttempted(true);
                          setError(undefined);
                          return decideReviewApplication(
                            review.app,
                            props.userId,
                            props.generation,
                            decision
                          );
                        },
                        (value) => setResult(value.status),
                        (cause) => setError(cause instanceof Error ? cause.message : String(cause))
                      )
                    }
                  />
                  <Action
                    disabled={op.busy}
                    label={t("report.cancel")}
                    onPress={() => setDecision(undefined)}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      {attempted && !result && !op.busy && (
        <ThemedText>{t("applicationReview.recheck")}</ThemedText>
      )}
      <Action disabled={op.busy} label={t("crewTerms.refresh")} onPress={props.onRefresh} />
      <Action
        disabled={op.busy}
        label={t("nativeApplications.webWorkflow")}
        onPress={props.onWeb}
      />
      <Action disabled={op.busy} label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        borderWidth: 1,
        borderColor: selected ? theme.brand : theme.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
