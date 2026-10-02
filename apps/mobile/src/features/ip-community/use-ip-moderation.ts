import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { showContentActionsMenu } from "@/components/report-actions";
import { blockIpContent, reportIpContent, type IpContentReport } from "@/data/browse-service";
import { invalidateBrowse } from "@/data/browse-refresh";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";

export type ReportDraft = IpContentReport & { title: string; blockIp: boolean };
export type ReportTarget = Pick<ReportDraft, "targetType" | "targetId" | "title">;

/** Native menus can outlive their route. Every deferred action is scoped to the
 * viewer and focused screen that presented it, including success-alert dismissal. */
export function useIpModeration(ipId: string, active: boolean, onBlocked: () => void) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const op = useAuthFormOperation(ipId, active);
  const scope = useMemo(
    () => ({ ipId, generation: auth.generation, active }),
    [ipId, auth.generation, active]
  );
  const live = useRef<typeof scope | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [accepted, setAccepted] = useState(false);
  const drafts = useRef(new Map<string, ReportDraft>());
  const receipts = useRef(new Set<string>());
  const draftKey = (target: ReportTarget) => `${target.targetType}:${target.targetId}`;
  const reportInput = (value: ReportDraft): IpContentReport => ({
    targetType: value.targetType,
    targetId: value.targetId,
    reason: value.reason,
    description: value.description?.trim() || undefined,
  });
  const reportIdentity = (value: ReportDraft) =>
    JSON.stringify([scope.generation, reportInput(value)]);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = (
    request: () => Promise<void>,
    success: () => void,
    failure: (error: unknown) => void
  ) => {
    if (pending.current) return;
    void op.run(
      async () => {
        pending.current = true;
        setSaving(true);
        try {
          await request();
        } finally {
          pending.current = false;
          if (mounted.current && getAuthGeneration() === scope.generation) setSaving(false);
        }
      },
      success,
      failure
    );
  };
  useLayoutEffect(() => {
    live.current = active ? scope : null;
    return () => {
      live.current = null;
    };
  }, [active, scope]);
  const current = () => live.current === scope && getAuthGeneration() === scope.generation;
  const failure = (error: unknown, label: "report.failed" | "ipDetail.blockFailed") => {
    if (error instanceof ApiRequestError && error.status === 401) {
      setReportOpen(false);
      gate.openLogin();
    } else {
      Alert.alert(t(label), error instanceof Error ? error.message : undefined);
    }
  };
  const confirmBlock = () => {
    if (!current() || pending.current) return;
    Alert.alert(t("ipDetail.blockConfirmTitle"), t("ipDetail.blockConfirmBody"), [
      { text: t("report.cancel"), style: "cancel" },
      {
        text: t("ipDetail.blockConfirmAction"),
        style: "destructive",
        onPress: () => {
          run(
            async () => {
              await blockIpContent(ipId);
              invalidateBrowse();
            },
            () =>
              Alert.alert(t("ipDetail.blockSuccessTitle"), t("ipDetail.blockSuccessBody"), [
                {
                  text: t("report.close"),
                  onPress: () => {
                    if (current()) onBlocked();
                  },
                },
              ]),
            (error) => failure(error, "ipDetail.blockFailed")
          );
        },
      },
    ]);
  };
  const openActions = (target: ReportTarget = { targetType: "ip", targetId: ipId, title: "" }) => {
    if (!current() || pending.current) return;
    if (auth.status !== "authenticated") {
      gate.requireAuth();
      return;
    }
    showContentActionsMenu({
      t,
      blockLabel: t("ipDetail.blockAction"),
      onReport: () => {
        if (current()) {
          const saved = drafts.current.get(draftKey(target)) ?? {
            ...target,
            reason: "copyright",
            description: "",
            blockIp: false,
          };
          drafts.current.set(draftKey(target), saved);
          setDraft(saved);
          setAccepted(receipts.current.has(reportIdentity(saved)));
          setReportOpen(true);
        }
      },
      onBlock: confirmBlock,
    });
  };
  const submitReport = () => {
    if (!current() || auth.status !== "authenticated" || !draft) return;
    const report = reportInput(draft);
    const identity = reportIdentity(draft);
    run(
      async () => {
        if (!receipts.current.has(identity)) {
          await reportIpContent(report);
          receipts.current.add(identity);
          if (mounted.current && getAuthGeneration() === scope.generation) setAccepted(true);
        }
        // Never start the next mutation on a replacement account or abandoned route.
        if (!mounted.current || getAuthGeneration() !== scope.generation) return;
        if (draft.blockIp) {
          await blockIpContent(ipId);
          invalidateBrowse();
        }
        receipts.current.delete(identity);
        drafts.current.delete(draftKey(draft));
        setAccepted(false);
        setDraft(null);
        setReportOpen(false);
      },
      () => {
        Alert.alert(
          t("report.successTitle"),
          t(draft.blockIp ? "report.successBlocked" : "report.successBody")
        );
      },
      (error) =>
        failure(error, receipts.current.has(identity) ? "ipDetail.blockFailed" : "report.failed")
    );
  };
  return {
    openActions,
    draft,
    accepted,
    updateDraft: (changes: Partial<ReportDraft>) => {
      if (current() && !pending.current && draft && !receipts.current.has(reportIdentity(draft))) {
        const value = { ...draft, ...changes };
        drafts.current.set(draftKey(value), value);
        setDraft(value);
      }
    },
    submitReport,
    reportOpen: active && reportOpen,
    busy: saving,
    closeReport: () => {
      if (!pending.current) setReportOpen(false);
    },
  };
}
