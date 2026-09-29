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
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (status !== "listed" || String(auth.user?.userId ?? auth.user?.id ?? "") === creatorId)
    return null;
  return open && auth.status === "authenticated" ? (
    <Composer
      key={JSON.stringify([serviceId, auth.generation])}
      serviceId={serviceId}
      close={() => setOpen(false)}
    />
  ) : (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        gate.requireAuth({
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
  const op = useAuthFormOperation(serviceId, useIsFocused());
  const [body, setBody] = useState(""),
    [error, setError] = useState<string>(),
    [conversation, setConversation] = useState<string>();
  const intent = useRef<{ body: string; key: string } | undefined>(undefined);
  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    void op.run(
      async () => {
        setError(undefined);
        if (intent.current?.body !== trimmed) intent.current = { body: trimmed, key: inquiryKey() };
        return sendServiceInquiry(serviceId, trimmed, intent.current.key);
      },
      setConversation,
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
            editable={!op.busy}
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
          <Pressable accessibilityRole="button" disabled={op.busy || !body.trim()} onPress={send}>
            <ThemedText>{t("serviceContact.send")}</ThemedText>
          </Pressable>
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {op.busy && <ActivityIndicator />}
      <Pressable accessibilityRole="button" disabled={op.busy} onPress={close}>
        <ThemedText>{t("experienceEdit.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
