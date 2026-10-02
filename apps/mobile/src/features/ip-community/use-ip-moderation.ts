import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { showContentActionsMenu } from "@/components/report-actions";
import { blockIpContent, reportIpContent, type IpReportReason } from "@/data/browse-service";
import { invalidateBrowse } from "@/data/browse-refresh";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";

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
  const openActions = () => {
    if (!current() || pending.current) return;
    if (auth.status !== "authenticated") {
      gate.requireAuth();
      return;
    }
    showContentActionsMenu({
      t,
      blockLabel: t("ipDetail.blockAction"),
      onReport: () => {
        if (current()) setReportOpen(true);
      },
      onBlock: confirmBlock,
    });
  };
  const submitReport = (reason: IpReportReason) => {
    if (!current() || auth.status !== "authenticated") return;
    run(
      async () => {
        await reportIpContent(ipId, reason);
        // Keep the accepted result even if focus changes before the reply.
        if (mounted.current && getAuthGeneration() === scope.generation) setReportOpen(false);
      },
      () => {
        setReportOpen(false);
        Alert.alert(t("report.successTitle"), t("report.successBody"));
      },
      (error) => failure(error, "report.failed")
    );
  };
  return {
    openActions,
    submitReport,
    reportOpen: active && reportOpen,
    busy: saving,
    closeReport: () => {
      if (!pending.current) setReportOpen(false);
    },
  };
}
