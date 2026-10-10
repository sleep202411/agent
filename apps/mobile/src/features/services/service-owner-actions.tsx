import { useState } from "react";
import { CREATOR_SERVICE_STATUSES } from "@repo/shared/creator-service";
import { Pressable, View } from "react-native";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { changeServiceStatus, serviceActions, type ServiceAction } from "./owner-service-api";

export function ServiceOwnerActions(props: {
  id: string;
  creatorId: string;
  status: string;
  packageCount: number;
  refresh: () => void;
}) {
  const auth = useAuth();
  if (
    auth.status !== "authenticated" ||
    String(auth.user?.userId ?? auth.user?.id ?? "") !== props.creatorId
  )
    return null;
  return (
    <Actions
      key={JSON.stringify([props.id, auth.generation, props.status, props.packageCount])}
      {...props}
    />
  );
}
function Actions({
  id,
  status,
  packageCount,
  refresh,
}: {
  id: string;
  status: string;
  packageCount: number;
  refresh: () => void;
}) {
  const t = useTranslations();
  const op = useAuthFormOperation(id, useScreenActive());
  const [action, setAction] = useState<ServiceAction>();
  const [error, setError] = useState<string>();
  const actions = serviceActions(status);
  const needsPackage = (status === "draft" || status === "paused") && packageCount === 0;
  const knownStatus = CREATOR_SERVICE_STATUSES.find((value) => value === status);
  if (!knownStatus) return null;
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {t(`myServices.status.${knownStatus}`)}
      </ThemedText>
      {needsPackage && (
        <ThemedText type="small" themeColor="textSecondary">
          {t("myServices.publishNeedsPackage")}
        </ThemedText>
      )}
      {actions.map((value) => (
        <Pressable
          key={value}
          accessibilityRole="button"
          disabled={op.busy || (needsPackage && (value === "publish" || value === "resume"))}
          style={{
            opacity:
              op.busy || (needsPackage && (value === "publish" || value === "resume")) ? 0.45 : 1,
          }}
          onPress={() => {
            setAction(value);
            setError(undefined);
          }}
        >
          <ThemedText>{t(`myServices.action.${value}`)}</ThemedText>
        </Pressable>
      ))}
      {action && (
        <View style={{ gap: 8 }}>
          <ThemedText>
            {t(action === "archive" ? "myServices.archiveHint" : "myServices.confirmHint")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={op.busy}
            onPress={() => {
              void op.run(
                () => changeServiceStatus(id, action),
                () => {
                  setAction(undefined);
                  refresh();
                },
                (cause) => setError(cause instanceof Error ? cause.message : String(cause))
              );
            }}
          >
            <ThemedText>{t("myServices.confirm")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={op.busy}
            onPress={() => setAction(undefined)}
          >
            <ThemedText>{t("myServices.cancel")}</ThemedText>
          </Pressable>
        </View>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
