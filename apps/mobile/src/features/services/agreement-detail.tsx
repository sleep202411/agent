import { AgreementActions } from "./agreement-actions";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ConversationFile } from "./conversation-file";
import {
  fetchLinkedAgreement,
  agreementMediaId,
  openAgreementSigning,
} from "./agreement-detail-api";
type Props = {
  crewId: string;
  agreementId: string;
  memberUserId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  closeLabel?: string;
};
export function AgreementDetail(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.agreementId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [snapshot, setSnapshot] = useState<{
      revision: number;
      data?: Awaited<ReturnType<typeof fetchLinkedAgreement>>;
      error?: string;
    }>();
  const [busy, setBusy] = useState(false),
    [signError, setSignError] = useState<string>();
  const signing = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      signing.current?.abort();
    },
    []
  );
  useEffect(() => {
    const c = new AbortController();
    void fetchLinkedAgreement(
      props.crewId,
      props.agreementId,
      props.memberUserId,
      props.generation,
      c.signal
    ).then(
      (data) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, data });
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setSnapshot({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => c.abort();
  }, [props.crewId, props.agreementId, props.memberUserId, props.generation, revision]);
  const visible = snapshot?.revision === revision ? snapshot : undefined,
    record = visible?.data;
  const signedMedia = agreementMediaId(record?.archive.signedDocumentUrl ?? null),
    auditMedia = agreementMediaId(record?.archive.auditTrailUrl ?? null);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("agreementDetail.title")}</ThemedText>
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.data === null && <ThemedText>{t("agreementDetail.unavailable")}</ThemedText>}
      {record && (
        <>
          <ThemedText>{record.title}</ThemedText>
          <AgreementActions
            key={`${record.id}:${revision}`}
            record={record}
            generation={props.generation}
            onSaved={() => setRevision((n) => n + 1)}
          />
          <ThemedText>{t(`agreementDetail.status_${record.status}`)}</ThemedText>
          <ThemedText>
            {t("agreementDetail.signer")} · {record.signerName} · {record.memberUserId}
          </ThemedText>
          <ThemedText>{record.signerEmail}</ThemedText>
          <ThemedText>
            BoldSign{record.providerStatus ? ` · ${record.providerStatus}` : ""}
          </ThemedText>
          {(
            ["createdAt", "updatedAt", "sentAt", "signedAt", "lastSyncedAt", "voidedAt"] as const
          ).map(
            (key) =>
              record[key] && (
                <ThemedText key={key}>
                  {t(`agreementDetail.${key}`)} · {new Date(record[key]!).toLocaleString()}
                </ThemedText>
              )
          )}
          <ThemedText>
            {t("agreementDetail.delivery")} ·{" "}
            {t(`agreementDetail.delivery_${record.delivery.status}`)}
          </ThemedText>
          {!!record.delivery.error && (
            <ThemedText accessibilityRole="alert">{record.delivery.error}</ThemedText>
          )}
          <ThemedText>
            {t("agreementDetail.archive")} · {t(`agreementDetail.archive_${record.archive.status}`)}
          </ThemedText>
          {signedMedia && (
            <ConversationFile
              mediaAssetId={signedMedia}
              name={t("agreementDetail.signedDocument")}
              mediaKind="document"
              contentType="application/pdf"
            />
          )}
          {auditMedia && (
            <ConversationFile
              mediaAssetId={auditMedia}
              name={t("agreementDetail.auditTrail")}
              mediaKind="document"
              contentType="application/pdf"
            />
          )}
          {record.capabilities.sign &&
            record.memberUserId === props.userId &&
            record.status === "sent" && (
              <>
                <ThemedText>{t("agreementDetail.signHelp")}</ThemedText>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  style={{ padding: 12 }}
                  onPress={() => {
                    if (signing.current || props.generation !== getAuthGeneration()) return;
                    const c = new AbortController();
                    signing.current = c;
                    setBusy(true);
                    setSignError(undefined);
                    void openAgreementSigning(record, props.userId, props.generation, c.signal)
                      .then(async (url) => {
                        if (!c.signal.aborted && props.generation === getAuthGeneration())
                          await Linking.openURL(url);
                      })
                      .catch((cause) => {
                        if (!c.signal.aborted && props.generation === getAuthGeneration())
                          setSignError(cause instanceof Error ? cause.message : String(cause));
                      })
                      .finally(() => {
                        if (signing.current === c) {
                          signing.current = null;
                          if (!c.signal.aborted && props.generation === getAuthGeneration())
                            setBusy(false);
                        }
                      });
                  }}
                >
                  <ThemedText>{t("agreementDetail.sign")}</ThemedText>
                </Pressable>
              </>
            )}
        </>
      )}
      {signError && <ThemedText accessibilityRole="alert">{signError}</ThemedText>}
      {busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={{ padding: 12 }}
        onPress={() => {
          setSignError(undefined);
          setRevision((n) => n + 1);
        }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{props.closeLabel ?? t("crewFinance.backToRecord")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
