import {
  useServiceEditorState,
  useClearServiceEditorDraft,
  useServiceReceipt,
} from "./service-editor-drafts";
import { useServiceIntent } from "./service-intent";
import { inquiryOutbox } from "./inquiry-outbox";
import { useLayoutEffect, useRef, useState } from "react";
import { useIsFocused, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { inquiryKey, sendServiceInquiry } from "./inquiry-api";
export function ServiceContact({
  serviceId,
  creatorId,
  status,
}: {
  serviceId: string;
  creatorId: string;
  status: string;
}) {
  const auth = useAuth(),
    gate = useAuthGate(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const intentControl = useServiceIntent();
  const receipt = useServiceReceipt("contact");
  const isOpen = intentControl ? intentControl.kind === "contact" : open;
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (
    (status !== "listed" && !receipt.id) ||
    String(auth.user?.userId ?? auth.user?.id ?? "") === creatorId
  )
    return null;
  return isOpen && auth.status === "authenticated" ? (
    <Composer
      key={JSON.stringify([serviceId, auth.generation])}
      serviceId={serviceId}
      close={() => {
        setOpen(false);
        intentControl?.close();
      }}
    />
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        intentControl
          ? intentControl.request("contact")
          : gate.requireAuth({
              onAuthenticated: () => {
                if (active.current) setOpen(true);
              },
            })
      }
    >
      <ThemedText type="smallBold">{t("serviceContact.title")}</ThemedText>
    </Pressable>
  );
}
function Composer({ serviceId, close }: { serviceId: string; close: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const auth = useAuth();
  const op = useAuthFormOperation(serviceId, useIsFocused());
  const [outbox] = useState(() =>
    inquiryOutbox(serviceId, String(auth.user?.userId ?? auth.user?.id ?? ""), auth.generation)
  );
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: undefined };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const receipt = useServiceReceipt("contact");
  const clearDraft = useClearServiceEditorDraft("contact");
  useServiceEditorState("contact:open", true);
  const [locked, setLocked] = useState(!!initial.pending);
  const [body, setBody] = useServiceEditorState("contact:body", initial.pending?.body ?? ""),
    [error, setError] = useState<string | undefined>(initial.error),
    [localResult, setConversation] = useState<string>();
  const conversation = receipt.id ?? localResult;
  const intent = useRef<{ body: string; clientKey: string } | undefined>(
    initial.pending ?? undefined
  );
  const send = () => {
    const trimmed = body.trim();
    if (!trimmed || initial.error) return;
    void op.run(
      async () => {
        setError(undefined);
        const pending = intent.current ?? { body: trimmed, clientKey: inquiryKey() };
        outbox.save(pending);
        intent.current = pending;
        setLocked(true);
        const id = await sendServiceInquiry(
          serviceId,
          intent.current.body,
          intent.current.clientKey
        );
        outbox.clear(intent.current.clientKey);
        clearDraft();
        receipt.save(id);
        return id;
      },
      (id) => {
        setConversation(id);
      },
      (cause) => setError(cause instanceof Error ? cause.message : t("profileEdit.failed"))
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("serviceContact.title")}</ThemedText>
      {conversation ? (
        <>
          <ThemedText>{t("serviceContact.sent")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(toHref(`/conversation/${encodeURIComponent(conversation)}`))}
          >
            <ThemedText>{t("serviceContact.open")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel={t("serviceContact.message")}
            value={body}
            onChangeText={setBody}
            editable={!locked && !op.busy && !initial.error}
            multiline
            maxLength={4000}
            style={{
              minHeight: 100,
              borderWidth: 1,
              borderRadius: 8,
              padding: 12,
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={op.busy || !body.trim() || !!initial.error}
            onPress={send}
          >
            <ThemedText>{t("serviceContact.send")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        onPress={() => {
          clearDraft();
          receipt.clear();
          close();
        }}
      >
        <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
