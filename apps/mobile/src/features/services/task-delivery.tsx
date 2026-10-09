import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, useLocale } from "@/i18n";
import { ConversationFile } from "./conversation-file";
import { useUserDisplays } from "./user-displays";
import {
  fetchTaskDeliveryTemplate,
  deliveryPrice,
  type DeliveryTemplate,
  type TaskSubmission,
} from "./task-delivery-api";
export function TaskDelivery({
  taskId,
  generation,
  submissions,
}: {
  taskId: string;
  generation: number;
  submissions: TaskSubmission[];
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [revision, setRevision] = useState(0),
    [result, setResult] = useState<{
      revision: number;
      template?: DeliveryTemplate | null;
      error?: string;
    }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskDeliveryTemplate(taskId, controller.signal).then(
      (template) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, template });
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setResult({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [taskId, generation, revision]);
  const current = result?.revision === revision ? result : undefined;
  const displays = useUserDisplays(
    String(generation),
    submissions.flatMap((s) => [
      s.submittedByUserId,
      ...(s.reviewedByUserId ? [s.reviewedByUserId] : []),
    ])
  );
  const name = (id: string) => displays?.get(id)?.nickname || id;
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("taskDelivery.requirements")}</ThemedText>
      {!current && <ActivityIndicator />}
      {current?.error && (
        <>
          <ThemedText accessibilityRole="alert">{current.error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => setRevision((v) => v + 1)}>
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {current?.template === null && <ThemedText>{t("taskDelivery.noTemplate")}</ThemedText>}
      {current?.template && <Template template={current.template} />}
      <ThemedText type="smallBold">{t("taskDelivery.submissions")}</ThemedText>
      {!submissions.length && <ThemedText>{t("taskDelivery.noSubmissions")}</ThemedText>}
      {[...submissions]
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map((submission) => (
          <View key={submission.id} style={{ gap: 8, paddingVertical: 10 }}>
            <ThemedText type="smallBold">
              {t("taskDelivery.version")} {submission.versionNumber} ·{" "}
              {name(submission.submittedByUserId)}
            </ThemedText>
            <ThemedText>{new Date(submission.createdAt).toLocaleString(locale)}</ThemedText>
            {!!submission.note && <ThemedText>{submission.note}</ThemedText>}
            {submission.professionalDelivery && (
              <Template
                template={submission.professionalDelivery}
                answers={submission.professionalDelivery.answers}
                assets={submission.assets}
              />
            )}
            {submission.assets.map((file) => (
              <View key={file.id}>
                {file.mediaAssetId ? (
                  <ConversationFile
                    mediaAssetId={file.mediaAssetId}
                    name={file.name}
                    contentType={file.contentType ?? undefined}
                  />
                ) : (
                  <ThemedText>
                    {file.name} · {t("taskActivity.unavailable")}
                  </ThemedText>
                )}
              </View>
            ))}
            {(submission.canvasVersionId || submission.productionVersionId) && (
              <ThemedText>{t("taskDelivery.snapshot")}</ThemedText>
            )}
            {!!submission.reviewNote && (
              <ThemedText>
                {t("taskDelivery.reviewNote")}: {submission.reviewNote}
              </ThemedText>
            )}
            {submission.reviewedAt && (
              <ThemedText>
                {t("taskDelivery.reviewed")}:{" "}
                {submission.reviewedByUserId
                  ? name(submission.reviewedByUserId)
                  : t("taskActivity.system")}{" "}
                · {new Date(submission.reviewedAt).toLocaleString(locale)}
              </ThemedText>
            )}
            {submission.mergedAt && (
              <ThemedText>
                {t("taskDelivery.merged")}: {new Date(submission.mergedAt).toLocaleString(locale)}
              </ThemedText>
            )}
          </View>
        ))}
    </View>
  );
}
function Template({
  template,
  answers,
  assets = [],
}: {
  template: DeliveryTemplate;
  answers?: Record<string, string | string[]>;
  assets?: TaskSubmission["assets"];
}) {
  const t = useTranslations();
  return (
    <View style={{ gap: 6 }}>
      <ThemedText type="smallBold">
        {template.definition.name} · {t("taskDelivery.version")} {template.version}
      </ThemedText>
      {!!template.definition.description && (
        <ThemedText>{template.definition.description}</ThemedText>
      )}
      {!!template.definition.prices.length && (
        <>
          <ThemedText>{t("taskDelivery.referencePrices")}</ThemedText>
          {template.definition.prices.map((price) => (
            <ThemedText key={price.currency}>
              {price.currency} {deliveryPrice(price.amountMinor)} / {price.unit}
            </ThemedText>
          ))}
          <ThemedText>{t("taskDelivery.referencePriceNote")}</ThemedText>
        </>
      )}
      {template.definition.fields.map((field) => {
        const value = answers?.[field.key];
        return (
          <View key={field.key} style={{ gap: 4 }}>
            <ThemedText>
              {field.label}
              {field.required ? ` (${t("taskDelivery.required")})` : ""}
            </ThemedText>
            {!!field.instructions && <ThemedText>{field.instructions}</ThemedText>}
            {answers && (
              <ThemedText>
                {Array.isArray(value)
                  ? value
                      .map(
                        (id) =>
                          assets.find((a) => a.id === id)?.name ?? t("taskActivity.unavailable")
                      )
                      .join(", ") || t("thread.taskUnset")
                  : value || t("thread.taskUnset")}
              </ThemedText>
            )}
          </View>
        );
      })}
    </View>
  );
}
