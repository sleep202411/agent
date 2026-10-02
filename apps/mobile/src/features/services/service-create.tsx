import { serviceFieldStyle } from "./service-field-style";
import { useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import { inquiryKey } from "./inquiry-api";
import { createServiceDraft, serviceDraftSchema } from "./service-create-api";

/** Mounted only by the authenticated owner screen; key by auth generation. */
export function ServiceCreate({ onCreated }: { onCreated: (id: string) => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("new-service", useScreenActive());
  const [open, setOpen] = useState(false),
    [submitted, setSubmitted] = useState(false);
  const [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [category, setCategory] = useState<string>("other"),
    [tags, setTags] = useState("");
  const [error, setError] = useState<string>();
  const intent = useRef<{ data: ReturnType<typeof serviceDraftSchema.parse>; key: string } | null>(
    null
  );
  const parsed = serviceDraftSchema.safeParse({
    title,
    summary,
    category,
    tags: tags
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
  });
  const locked = op.busy || submitted;
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
        disabled={op.busy || !parsed.success}
        onPress={() => {
          if (!parsed.success) return;
          void op.run(
            () => {
              intent.current ??= { data: parsed.data, key: inquiryKey() };
              setSubmitted(true);
              setError(undefined);
              return createServiceDraft(intent.current.data, intent.current.key);
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
