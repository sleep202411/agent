import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { getAuthGeneration, subscribeAuth } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { pickAndUploadCrewFile, discardCrewUpload, type CrewUpload } from "./upload";
import { attachOrganizationFile, validateAssetDestination } from "./organization-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  parentId: string | null;
  destination: string;
  onClose: () => void;
};
export function AssetFileUpload(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Form
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.parentId}`}
      {...props}
    />
  ) : null;
}
function Form(props: Props) {
  const t = useTranslations(),
    op = useAuthFormOperation(`${props.crewId}:${props.parentId}`, true);
  const [file, setFile] = useState<CrewUpload>();
  const [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = subscribeAuth(() => {
      if (props.generation !== getAuthGeneration()) controller.current?.abort();
    });
    return () => {
      unsubscribe();
      controller.current?.abort();
    };
  }, [props.generation]);
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const pick = () => {
    if (op.busy || file || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        setError(undefined);
        const c = new AbortController();
        controller.current = c;
        await validateAssetDestination(
          props.crewId,
          props.userId,
          props.generation,
          props.parentId
        );
        c.signal.throwIfAborted();
        const result = await pickAndUploadCrewFile(props.crewId, c.signal);
        if (props.generation !== getAuthGeneration()) throw new Error("Upload session expired.");
        return result;
      },
      (result) => {
        if (result) setFile(result);
      },
      report
    );
  };
  const attach = () => {
    if (op.busy || !file || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        setError(undefined);
        setAttempted(true);
        return attachOrganizationFile(props.crewId, props.userId, props.generation, {
          mediaAssetId: file.mediaAssetId,
          name: file.name,
          parentId: props.parentId,
        });
      },
      props.onClose,
      report
    );
  };
  const discard = () => {
    if (op.busy || !file || attempted || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        await discardCrewUpload(props.crewId, file.mediaAssetId);
      },
      props.onClose,
      report
    );
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("thread.uploadFile")}</ThemedText>
      <ThemedText>
        {t("assetOrganization.destination")}: {props.destination}
      </ThemedText>
      <ThemedText>{t("assetUpload.help")}</ThemedText>
      {!file && <Button label={t("thread.uploadFile")} disabled={op.busy} onPress={pick} />}
      {file && <ThemedText>{file.name}</ThemedText>}
      {file && (
        <Button
          label={t(attempted ? "inbox.retry" : "assetUpload.attach")}
          disabled={op.busy}
          onPress={attach}
        />
      )}
      {file && !attempted && (
        <Button label={t("assetUpload.discard")} disabled={op.busy} onPress={discard} />
      )}
      {attempted && error && <ThemedText>{t("assetUpload.retryHelp")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      {file && !attempted && <ThemedText>{t("assetUpload.leaveHelp")}</ThemedText>}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
