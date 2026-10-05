import { serviceFieldStyle } from "./service-field-style";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import { inquiryKey } from "./inquiry-api";
import { createServiceDraft, serviceDraftSchema } from "./service-create-api";
import { serviceCreationPending } from "./service-create-pending";

/** Mounted only by the authenticated owner screen; key by auth generation. */
export function ServiceCreate({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("new-service", useScreenActive());
  const auth = useAuth();
  const [box] = useState(() =>
    serviceCreationPending(String(auth.user?.userId ?? auth.user?.id ?? ""), auth.generation)
  );
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: undefined };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [open, setOpen] = useState(!!initial.pending || !!initial.error),
    [submitted, setSubmitted] = useState(!!initial.pending);
  const [title, setTitle] = useState(initial.pending?.data.title ?? ""),
    [summary, setSummary] = useState(initial.pending?.data.summary ?? ""),
    [category, setCategory] = useState<string>(initial.pending?.data.category ?? "other"),
    [tags, setTags] = useState(initial.pending?.data.tags.join("\n") ?? "");
  const [error, setError] = useState<string | undefined>(initial.error);
  const intent = useRef(initial.pending);
  const parsed = serviceDraftSchema.safeParse({
    title,
    summary,
    category,
    tags: tags
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
  });
  const locked = op.busy || submitted || !!initial.error;
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <ThemedText>{t("serviceCreate.title")}</ThemedText>
      </Pressable>
    );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("serviceCreate.title")}</ThemedText>
      <ThemedText>{t("serviceCreate.hint")}</ThemedText>
      <ThemedText>{t("serviceEdit.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("serviceEdit.name")}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        editable={!locked}
        style={serviceFieldStyle(theme)}
      />
      <ThemedText>{t("serviceEdit.summary")}</ThemedText>
      <TextInput
        accessibilityLabel={t("serviceEdit.summary")}
        value={summary}
        onChangeText={setSummary}
        maxLength={1000}
        multiline
        editable={!locked}
        style={serviceFieldStyle(theme, true)}
      />
      <ScrollView horizontal>
        {SERVICE_CATEGORIES.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === value }}
            disabled={locked}
            onPress={() => setCategory(value)}
            style={{
              padding: 10,
              backgroundColor:
                category === value ? theme.backgroundSelected : theme.backgroundElement,
            }}
          >
            <ThemedText>{serviceCategoryLabel(value, t)}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <ThemedText>{t("serviceEdit.tags")}</ThemedText>
      <TextInput
        accessibilityLabel={t("serviceEdit.tags")}
        value={tags}
        onChangeText={setTags}
        multiline
        editable={!locked}
        style={serviceFieldStyle(theme, true)}
      />
      {!parsed.success && <ThemedText>{t("serviceEdit.invalid")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {submitted && !op.busy && <ThemedText>{t("serviceCreate.retryHint")}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || !!initial.error || !parsed.success}
        onPress={() => {
          if (!parsed.success) return;
          void op.run(
            async () => {
              const pending = intent.current ?? { data: parsed.data, clientKey: inquiryKey() };
              box.save(pending);
              intent.current = pending;
              setSubmitted(true);
              setError(undefined);
              const result = await createServiceDraft(pending.data, pending.clientKey);
              box.clear(pending.clientKey);
              return result;
            },
            (result) => {
              setOpen(false);
              setTitle("");
              setSummary("");
              setTags("");
              setCategory("other");
              setSubmitted(false);
              intent.current = null;
              onCreated(result.id);
            },
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t(submitted ? "common.retry" : "serviceCreate.save")}</ThemedText>
      </Pressable>
      {!submitted && (
        <Pressable accessibilityRole="button" disabled={op.busy} onPress={() => setOpen(false)}>
          <ThemedText>{t("myServices.cancel")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
