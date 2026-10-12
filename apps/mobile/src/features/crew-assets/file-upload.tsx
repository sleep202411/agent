import { uploadConfirmation, type UploadConfirmation } from "./upload-confirmation";
import { isExpiredCrewUpload } from "./upload-expiry";
import { uploadReceipt } from "./upload-receipt";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView } from "react-native";
import { getAuthGeneration, subscribeAuth } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { pickAndUploadCrewFile, discardCrewUpload, type CrewUpload } from "./upload";
import {
  attachOrganizationFile,
  validateAssetDestination,
  type OrganizationNode,
} from "./organization-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  parentId: string | null;
  destination: string;
  onClose: () => void;
  onAttached?: (asset: OrganizationNode) => void;
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
  const [receipt] = useState(() =>
    uploadReceipt(props.crewId, props.userId, props.generation, props.parentId)
  );
  const [confirmation] = useState(() =>
    uploadConfirmation(props.crewId, props.userId, props.generation, props.parentId)
  );
  const [initial] = useState(() => {
    try {
      return { saved: receipt.read(), pending: confirmation.read(), error: undefined };
    } catch (cause) {
      return {
        saved: null,
        pending: null,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  });
  const [file, setFile] = useState<CrewUpload | undefined>(
    initial.pending ? undefined : initial.saved?.file
  );
  const [pending, setPending] = useState<UploadConfirmation | null>(initial.pending);
  const restored = initial.error === undefined;
  const [expiredKey, setExpiredKey] = useState<string>();
  const [attempted, setAttempted] = useState(initial.saved?.attempted ?? false),
    [error, setError] = useState<string | undefined>(initial.error);
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
  const reportExpiry = (e: unknown, storageKey: string) => {
    report(e);
    if (isExpiredCrewUpload(e)) {
      try {
        if (confirmation.read()?.request.storageKey === storageKey && !receipt.read())
          setExpiredKey(storageKey);
      } catch {
        // Invalid local state must not grant permission to discard a checkpoint.
      }
    }
  };
  const restart = () => {
    if (op.busy || !expiredKey || props.generation !== getAuthGeneration()) return;
    try {
      if (receipt.read())
        throw new Error("A confirmed upload is pending. Reopen this folder before continuing.");
      confirmation.clear(expiredKey);
      setPending(null);
      setExpiredKey(undefined);
      setError(undefined);
    } catch (cause) {
      report(cause);
    }
  };
  const pick = () => {
    if (!restored || op.busy || file || pending || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        setError(undefined);
        if (receipt.read() || confirmation.read())
          throw new Error("Another upload is pending. Reopen this folder before continuing.");
        const c = new AbortController();
        controller.current = c;
        await validateAssetDestination(
          props.crewId,
          props.userId,
          props.generation,
          props.parentId
        );
        c.signal.throwIfAborted();
        let confirmationKey: string | undefined;
        const result = await pickAndUploadCrewFile(props.crewId, c.signal, (request, name) => {
          confirmation.save({ request, name });
          confirmationKey = request.storageKey;
          setPending(confirmation.read());
        });
        if (props.generation !== getAuthGeneration()) throw new Error("Upload session expired.");
        if (result) finishConfirmation(result, confirmationKey);
        return result;
      },
      (result) => {
        if (result) setFile(result);
      },
      report
    );
  };
  // Keep the confirmation until its media receipt is durable. A crash between
  // those two writes recovers the same media and preserves any attachment attempt.
  const finishConfirmation = (result: CrewUpload, storageKey?: string) => {
    const saved = confirmation.read();
    if (saved && saved.request.storageKey !== storageKey)
      throw new Error("Another upload confirmation is pending.");
    const existing = receipt.read();
    const attempted = existing?.attempted ?? false;
    receipt.save({ file: result, attempted });
    if (saved) confirmation.clear(saved.request.storageKey);
    setPending(null);
    setAttempted(attempted);
  };
  const recover = () => {
    if (!restored || op.busy || !pending || props.generation !== getAuthGeneration()) return;
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
        const result = await confirmation.recover(c.signal, pending.request.storageKey);
        finishConfirmation(result, pending.request.storageKey);
        return result;
      },
      setFile,
      (cause) => reportExpiry(cause, pending.request.storageKey)
    );
  };
  const attach = () => {
    if (op.busy || !file || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        setError(undefined);
        receipt.save({ file, attempted: true });
        setAttempted(true);
        return attachOrganizationFile(props.crewId, props.userId, props.generation, {
          mediaAssetId: file.mediaAssetId,
          name: file.name,
          parentId: props.parentId,
        });
      },
      (asset) => {
        props.onAttached?.(asset);
        receipt.clear(file.mediaAssetId);
        props.onClose();
      },
      report
    );
  };
  const discard = () => {
    if (op.busy || !file || attempted || props.generation !== getAuthGeneration()) return;
    void op.run(
      async () => {
        if (receipt.read()?.attempted)
          throw new Error(
            "This file may already be attached. Reopen the folder before continuing."
          );
        await discardCrewUpload(props.crewId, file.mediaAssetId);
      },
      () => {
        receipt.clear(file.mediaAssetId);
        props.onClose();
      },
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
      {!file && !pending && (
        <Button label={t("thread.uploadFile")} disabled={!restored || op.busy} onPress={pick} />
      )}
      {pending && <ThemedText>{pending.name}</ThemedText>}
      {pending && <ThemedText>{t("assetUpload.confirmRecovery")}</ThemedText>}
      {pending && (
        <Button label={t("inbox.retry")} disabled={!restored || op.busy} onPress={recover} />
      )}
      {pending && expiredKey && (
        <Button label={t("assetUpload.restart")} disabled={op.busy} onPress={restart} />
      )}
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
