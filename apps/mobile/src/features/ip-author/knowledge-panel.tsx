import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchKnowledge, saveKnowledge, type KnowledgeSnapshot } from "./knowledge-api";

export function IpKnowledgePanel({ ipId, generation }: { ipId: string; generation: number }) {
  const theme = useTheme(),
    t = useTranslations();
  const [value, setValue] = useState<KnowledgeSnapshot | null>(null);
  const [busy, setBusy] = useState(true),
    [conflict, setConflict] = useState(false);
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(true);
  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);
  useEffect(() => {
    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    fetchKnowledge(ipId, generation, request.signal)
      .then((result) => {
        if (!request.signal.aborted) setValue(result);
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : translate.current("ipKnowledgeAdmin.failed")
          );
      })
      .finally(() => {
        if (!request.signal.aborted) {
          inFlight.current = false;
          setBusy(false);
        }
      });
    return () => controller.current?.abort();
  }, [ipId, generation]);
  async function request(save: boolean) {
    if (inFlight.current || (save && (!value || conflict))) return;
    inFlight.current = true;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result =
        save && value
          ? await saveKnowledge(ipId, generation, value, pending.signal)
          : await fetchKnowledge(ipId, generation, pending.signal);
      if (!pending.signal.aborted) {
        setValue(result);
        setConflict(false);
        setSaved(save);
      }
    } catch (cause) {
      if (!pending.signal.aborted) {
        const stale =
          typeof cause === "object" && cause !== null && "status" in cause && cause.status === 409;
        setConflict(stale);
        setError(
          stale
            ? t("ipKnowledgeAdmin.conflict")
            : cause instanceof Error
              ? cause.message
              : t("ipKnowledgeAdmin.failed")
        );
      }
    } finally {
      if (!pending.signal.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const disabled = busy || !value || conflict;
  function update(id: string, changes: Partial<KnowledgeSnapshot["documents"][number]>) {
    setSaved(false);
    setValue(
      (current) =>
        current && {
          ...current,
          documents: current.documents.map((item) =>
            item.id === id ? { ...item, ...changes } : item
          ),
        }
    );
  }
  const inputStyle = {
    color: theme.text,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <ThemedText>{t("ipKnowledgeAdmin.description")}</ThemedText>
      {busy ? <ActivityIndicator /> : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {saved ? <ThemedText>{t("ipKnowledgeAdmin.saved")}</ThemedText> : null}
      {value?.documents.length === 0 ? (
        <ThemedText>{t("ipKnowledgeAdmin.empty")}</ThemedText>
      ) : null}
      {value?.documents.map((item, index) => (
        <View key={item.id} style={{ gap: 10 }}>
          <ThemedText>
            {t("ipKnowledgeAdmin.title")} {index + 1}
          </ThemedText>
          <TextInput
            accessibilityLabel={`${t("ipKnowledgeAdmin.title")} ${index + 1}`}
            editable={!disabled}
            style={inputStyle}
            value={item.title}
            maxLength={240}
            onChangeText={(title) => update(item.id, { title })}
          />
          <ThemedText>
            {t("ipKnowledgeAdmin.content")} {index + 1}
          </ThemedText>
          <TextInput
            accessibilityLabel={`${t("ipKnowledgeAdmin.content")} ${index + 1}`}
            editable={!disabled}
            style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
            multiline
            value={item.content}
            maxLength={20000}
            onChangeText={(content) => update(item.id, { content })}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch
              accessibilityLabel={t("ipKnowledgeAdmin.published")}
              disabled={disabled}
              value={item.isPublished}
              onValueChange={(isPublished) => update(item.id, { isPublished })}
            />
            <ThemedText style={{ flex: 1 }}>{t("ipKnowledgeAdmin.published")}</ThemedText>
          </View>
          <KnowledgeButton
            label="remove"
            disabled={disabled}
            onPress={() => {
              setSaved(false);
              setValue(
                (current) =>
                  current && {
                    ...current,
                    documents: current.documents.filter((doc) => doc.id !== item.id),
                  }
              );
            }}
          />
        </View>
      ))}
      <KnowledgeButton
        label="add"
        onPress={() => {
          setSaved(false);
          setValue(
            (current) =>
              current && {
                ...current,
                documents: [
                  ...current.documents,
                  { id: uuid.v4(), title: "", content: "", isPublished: false },
                ],
              }
          );
        }}
        disabled={disabled || (value?.documents.length ?? 0) >= 50}
      />
      <KnowledgeButton
        label="save"
        onPress={() => void request(true)}
        disabled={
          disabled || !!value?.documents.some((item) => !item.title.trim() || !item.content.trim())
        }
      />
      <KnowledgeButton label="reload" onPress={() => void request(false)} disabled={busy} />
    </ScrollView>
  );
}

function KnowledgeButton({
  label,
  onPress,
  disabled,
}: {
  label: "remove" | "add" | "save" | "reload";
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme(),
    t = useTranslations();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{t(`ipKnowledgeAdmin.${label}`)}</ThemedText>
    </Pressable>
  );
}
