import { serviceFieldStyle } from "./service-field-style";
import { useServiceEditorState, useClearServiceEditorDraft } from "./service-editor-drafts";
import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import type { CreatorServiceDetail } from "@/data/types";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import { saveServiceDetails, serviceDetailsSchema } from "./service-edit-api";

export function ServiceDetailsEditor(props: {
  service: CreatorServiceDetail;
  refresh: () => void;
}) {
  const auth = useAuth();
  if (
    auth.status !== "authenticated" ||
    String(auth.user?.userId ?? auth.user?.id ?? "") !== props.service.creatorId ||
    props.service.status === "archived" ||
    props.service.version === undefined
  )
    return null;
  return (
    <Editor
      key={JSON.stringify([props.service.id, props.service.version, auth.generation])}
      {...props}
    />
  );
}
function Editor({ service, refresh }: { service: CreatorServiceDetail; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme();
  const op = useAuthFormOperation(service.id, useScreenActive());
  const clearDraft = useClearServiceEditorDraft("details");
  const [draftVersion, setDraftVersion] = useServiceEditorState("details:version", service.version);
  const saved = () => {
    clearDraft();
    refresh();
  };
  const discardAndReload = () => {
    clearDraft();
    refresh();
  };
  const [open, setOpen] = useServiceEditorState("details:open", false);
  const [title, setTitle] = useServiceEditorState("details:title", service.title),
    [summary, setSummary] = useServiceEditorState("details:summary", service.summary),
    [category, setCategory] = useServiceEditorState("details:category", service.category),
    [tags, setTags] = useServiceEditorState("details:tags", service.tags.join("\n"));
  const [error, setError] = useState<string>();
  const parsed = serviceDetailsSchema.safeParse({
    title,
    summary,
    category,
    tags: tags
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
    expectedVersion: draftVersion,
  });
  const reset = () => {
    setDraftVersion(service.version);
    setTitle(service.title);
    setSummary(service.summary);
    setCategory(service.category);
    setTags(service.tags.join("\n"));
    setError(undefined);
    setOpen(false);
  };
  if (!open)
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
        <ThemedText>{t("serviceEdit.title")}</ThemedText>
      </Pressable>
    );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("serviceEdit.title")}</ThemedText>
      <ThemedText>{t("serviceEdit.name")}</ThemedText>
      <TextInput
        accessibilityLabel={t("serviceEdit.name")}
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        editable={!op.busy}
        style={serviceFieldStyle(theme)}
      />
      <ThemedText>{t("serviceEdit.summary")}</ThemedText>
      <TextInput
        accessibilityLabel={t("serviceEdit.summary")}
        value={summary}
        onChangeText={setSummary}
        maxLength={1000}
        multiline
        editable={!op.busy}
        style={serviceFieldStyle(theme, true)}
      />
      <ThemedText>{t("serviceEdit.category")}</ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {SERVICE_CATEGORIES.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: category === value }}
            disabled={op.busy}
            onPress={() => setCategory(value)}
            style={{
              padding: 10,
              borderRadius: 8,
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
        editable={!op.busy}
        style={serviceFieldStyle(theme, true)}
      />
      {!parsed.success && <ThemedText>{t("serviceEdit.invalid")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy || !parsed.success}
        onPress={() => {
          if (!parsed.success) return;
          void op.run(
            () => saveServiceDetails(service.id, parsed.data),
            saved,
            (cause) => setError(cause instanceof Error ? cause.message : String(cause))
          );
        }}
      >
        <ThemedText>{t("profileEdit.save")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={op.busy} onPress={reset}>
        <ThemedText>{t("myServices.cancel")}</ThemedText>
      </Pressable>
      {error && (
        <Pressable accessibilityRole="button" disabled={op.busy} onPress={discardAndReload}>
          <ThemedText>{t("serviceEdit.reload")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
