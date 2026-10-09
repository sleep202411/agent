import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  fetchTemplates,
  fetchTemplateModels,
  saveTemplates,
  templatesCommand,
  templatesDraft,
  templatesOutbox,
  type TemplatesSnapshot,
  type TemplatesDraft,
  type TemplatesCommand,
  type GenerationTemplate,
  type TemplateModel,
} from "./templates-api";
import { pickTemplateLogo, confirmTemplateLogo } from "./template-logo";
type Props = { ipId: string; userId: string; generation: number };
const fields = [
  { key: "name", max: 120 },
  { key: "description", max: 500 },
  { key: "promptPrefix", max: 2000 },
  { key: "promptSuffix", max: 2000 },
  { key: "referenceImageHint", max: 200 },
] as const;
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function IpTemplatesPanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [store] = useState(() => templatesDraft(ipId, userId, generation)),
    [box] = useState(() => templatesOutbox(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { draft: store.read(), pending: box.read(), error: "" };
    } catch (e) {
      return { draft: null, pending: null, error: String(e) };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [pending, setPending] = useState(initial.pending),
    [snapshot, setSnapshot] = useState<TemplatesSnapshot>(),
    [models, setModels] = useState<TemplateModel[]>([]),
    [modelError, setModelError] = useState(""),
    [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [selected, setSelected] = useState(initial.draft?.templates[0]?.id),
    [picker, setPicker] = useState(false),
    [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<
    { kind: "remove"; id: string } | { kind: "reset" | "logo" } | null
  >(null);
  const draftRef = useRef(draft),
    controller = useRef<AbortController | null>(null);
  function persist(value: TemplatesDraft) {
    store.save(value);
    draftRef.current = value;
    setDraft(value);
    setSaved(false);
  }
  function accept(value: TemplatesSnapshot) {
    setSnapshot(value);
    if (!draftRef.current) {
      const next = { ...value, logo: null };
      store.save(next);
      draftRef.current = next;
      setDraft(next);
      setSelected(next.templates[0]?.id);
    }
  }
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchTemplates(ipId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) accept(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    void fetchTemplateModels(generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setModels(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setModelError(String(e.message ?? e));
      });
    return () => c.abort();
    // Session identity is fixed by the parent key; drafts are read once and written synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ipId, generation]);
  function failure(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setReviewed(false);
      setConfirm(null);
    }
  }
  function change(templates: GenerationTemplate[]) {
    try {
      if (draftRef.current) persist({ ...draftRef.current, templates });
    } catch (e) {
      failure(e);
    }
  }
  function patch(id: string, value: Partial<GenerationTemplate>) {
    if (draftRef.current)
      change(
        draftRef.current.templates.map((item) => (item.id === id ? { ...item, ...value } : item))
      );
  }
  function refresh() {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError(initial.error);
    setConfirm(null);
    setReviewed(false);
    void op.run(
      async () => {
        const value = await fetchTemplates(ipId, generation, signal);
        const catalog = await fetchTemplateModels(generation, signal)
          .then((data) => ({ data, error: "" }))
          .catch((e) => ({ data: [] as TemplateModel[], error: String(e.message ?? e) }));
        return { value, catalog };
      },
      ({ value, catalog }) => {
        accept(value);
        setModels(catalog.data);
        setModelError(catalog.error);
        setReviewed(true);
      },
      failure
    );
  }
  function save(command: TemplatesCommand) {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    setSaved(false);
    setReviewed(false);
    void op.run(
      async () => {
        box.save(command);
        setPending(command);
        return saveTemplates(ipId, userId, generation, command, signal);
      },
      (value) => {
        persist({ ...value, logo: null });
        setSnapshot(value);
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      failure
    );
  }
  function logo(id: string, resume = false) {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    void op.run(
      async () => {
        const checkpoint = resume
          ? draftRef.current?.logo
          : await pickTemplateLogo(id, generation, signal, (value) => {
              const current = draftRef.current;
              if (!current) throw Error("Template draft missing.");
              persist({ ...current, logo: value });
            });
        if (!checkpoint) return;
        const assetId = await confirmTemplateLogo(checkpoint, generation, signal),
          current = draftRef.current;
        if (
          !current ||
          current.logo?.storageKey !== checkpoint.storageKey ||
          !current.templates.some((item) => item.id === checkpoint.templateId)
        )
          throw Error("Logo target changed.");
        persist({
          ...current,
          logo: null,
          templates: current.templates.map((item) =>
            item.id === checkpoint.templateId ? { ...item, logoAssetId: assetId } : item
          ),
        });
      },
      () => {},
      failure
    );
  }
  const busy = loading || op.busy,
    frozen = busy || !!pending || !!draft?.logo || !!initial.error;
  const inputStyle = {
    padding: 10,
    minHeight: 44,
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    borderRadius: 8,
  };
  if (!active) return null;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t("ipTemplates.hint")}
      </ThemedText>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipTemplates.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} disabled={busy} onPress={refresh} />
      {snapshot && draft && (
        <>
          {!!modelError && <ThemedText accessibilityRole="alert">{modelError}</ThemedText>}
          {!models.length && <ThemedText type="small">{t("ipTemplates.noModels")}</ThemedText>}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            <Button
              label={t("ipTemplates.add")}
              disabled={frozen || !models.length || draft.templates.length >= 50}
              onPress={() => {
                const id = uuid.v4();
                change([
                  ...draft.templates,
                  {
                    id,
                    name: "",
                    description: "",
                    modelId: models[0].id,
                    promptPrefix: "",
                    promptSuffix: "",
                    requireReferenceImage: true,
                    referenceImageHint: "",
                    outputAspectRatio: "1:1",
                    logoAssetId: null,
                    enabled: true,
                    order: draft.templates.length + 1,
                  },
                ]);
                setSelected(id);
                setPicker(false);
              }}
            />
            <Button
              label={t("ipTemplates.save")}
              disabled={
                frozen ||
                !templatesCommand.safeParse({
                  clientKey: ipId,
                  expectedVersion: draft.version,
                  templates: draft.templates,
                }).success
              }
              onPress={() =>
                save({
                  clientKey: uuid.v4(),
                  expectedVersion: draft.version,
                  templates: draft.templates.map((item, i) => ({ ...item, order: i + 1 })),
                })
              }
            />
          </View>
          {!draft.templates.length && <ThemedText>{t("ipTemplates.empty")}</ThemedText>}
          {draft.templates.map((item, index) => (
            <View
              key={item.id}
              style={{
                gap: 8,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Button
                label={`${index + 1}. ${item.name || t("ipTemplates.untitled")}`}
                disabled={busy}
                onPress={() => {
                  setSelected(selected === item.id ? undefined : item.id);
                  setPicker(false);
                }}
              />
              {selected === item.id && (
                <>
                  {fields.map((field) => (
                    <View key={field.key} style={{ gap: 4 }}>
                      <ThemedText type="small">{t(`ipTemplates.${field.key}`)}</ThemedText>
                      <TextInput
                        accessibilityLabel={t(`ipTemplates.${field.key}`)}
                        value={item[field.key]}
                        editable={!frozen}
                        onChangeText={(value) => patch(item.id, { [field.key]: value })}
                        maxLength={field.max}
                        multiline={field.key !== "name"}
                        style={inputStyle}
                      />
                    </View>
                  ))}
                  <ThemedText type="small">
                    {t("ipTemplates.model")}:{" "}
                    {models.find((m) => m.id === item.modelId)?.name || item.modelId}
                  </ThemedText>
                  <Button
                    label={t("ipTemplates.chooseModel")}
                    disabled={frozen || !models.length}
                    onPress={() => {
                      setPicker(!picker);
                      setSearch("");
                    }}
                  />
                  {picker && (
                    <View style={{ gap: 4 }}>
                      <TextInput
                        accessibilityLabel={t("ipTemplates.searchModels")}
                        placeholder={t("ipTemplates.searchModels")}
                        placeholderTextColor={theme.textSecondary}
                        value={search}
                        onChangeText={setSearch}
                        editable={!frozen}
                        style={inputStyle}
                      />
                      {models
                        .filter((m) =>
                          `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase())
                        )
                        .map((m) => (
                          <Button
                            key={m.id}
                            label={m.name}
                            disabled={frozen}
                            onPress={() => {
                              patch(item.id, { modelId: m.id });
                              setPicker(false);
                            }}
                          />
                        ))}
                    </View>
                  )}
                  <ThemedText type="small">{t("ipTemplates.ratio")}</ThemedText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {(["1:1", "4:5", "9:16", "16:9"] as const).map((ratio) => (
                      <Button
                        key={ratio}
                        label={`${item.outputAspectRatio === ratio ? "✓ " : ""}${ratio}`}
                        disabled={frozen}
                        onPress={() => patch(item.id, { outputAspectRatio: ratio })}
                      />
                    ))}
                  </View>
                  {(["enabled", "requireReferenceImage"] as const).map((key) => (
                    <Button
                      key={key}
                      label={`${item[key] ? "✓ " : "○ "}${t(`ipTemplates.${key}`)}`}
                      disabled={frozen}
                      onPress={() => patch(item.id, { [key]: !item[key] })}
                    />
                  ))}
                  <ThemedText type="small">
                    {t(item.logoAssetId ? "ipTemplates.logoAttached" : "ipTemplates.noLogo")}
                  </ThemedText>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    <Button
                      label={t("ipTemplates.uploadLogo")}
                      disabled={frozen}
                      onPress={() => logo(item.id)}
                    />
                    {!!item.logoAssetId && (
                      <Button
                        label={t("ipTemplates.removeLogo")}
                        disabled={frozen}
                        onPress={() => patch(item.id, { logoAssetId: null })}
                      />
                    )}
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {([-1, 1] as const).map((delta) => (
                      <Button
                        key={delta}
                        label={t(delta < 0 ? "ipTemplates.up" : "ipTemplates.down")}
                        disabled={
                          frozen || index + delta < 0 || index + delta >= draft.templates.length
                        }
                        onPress={() => {
                          const next = [...draft.templates];
                          [next[index], next[index + delta]] = [next[index + delta], next[index]];
                          change(next.map((row, i) => ({ ...row, order: i + 1 })));
                        }}
                      />
                    ))}
                    <Button
                      label={t("ipTemplates.remove")}
                      disabled={frozen}
                      onPress={() => setConfirm({ kind: "remove", id: item.id })}
                    />
                  </View>
                </>
              )}
            </View>
          ))}
          {draft.logo && (
            <>
              <ThemedText>
                {t("ipTemplates.logoPending")}: {draft.logo.fileName}
              </ThemedText>
              <Button
                label={t("ipTemplates.retryLogo")}
                disabled={busy || !!initial.error}
                onPress={() => logo(draft.logo!.templateId, true)}
              />
              <Button
                label={t("ipTemplates.cancelLogo")}
                disabled={busy}
                onPress={() => setConfirm({ kind: "logo" })}
              />
            </>
          )}
          {pending && (
            <>
              <ThemedText>{t("ipTemplates.pending")}</ThemedText>
              <Button
                label={t("common.retry")}
                disabled={busy || !!initial.error}
                onPress={() => save(pending)}
              />
            </>
          )}
          {reviewed && (
            <>
              <ThemedText type="smallBold">{t("ipTemplates.current")}</ThemedText>
              {!snapshot.templates.length && <ThemedText>{t("ipTemplates.empty")}</ThemedText>}
              {snapshot.templates.map((item) => (
                <View
                  key={item.id}
                  style={{
                    gap: 4,
                    padding: 12,
                    backgroundColor: theme.backgroundElement,
                    borderRadius: 8,
                  }}
                >
                  {fields.map((field) => (
                    <ThemedText key={field.key} type="small">
                      {t(`ipTemplates.${field.key}`)}: {item[field.key] || "—"}
                    </ThemedText>
                  ))}
                  <ThemedText type="small">
                    {t("ipTemplates.model")}:{" "}
                    {models.find((m) => m.id === item.modelId)?.name || item.modelId}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("ipTemplates.ratio")}: {item.outputAspectRatio}
                  </ThemedText>
                  {(["enabled", "requireReferenceImage"] as const).map((key) => (
                    <ThemedText key={key} type="small">
                      {item[key] ? "✓ " : "○ "}
                      {t(`ipTemplates.${key}`)}
                    </ThemedText>
                  ))}
                  <ThemedText type="small">
                    {t(item.logoAssetId ? "ipTemplates.logoAttached" : "ipTemplates.noLogo")}
                  </ThemedText>
                </View>
              ))}
              <Button
                label={t("ipTemplates.reset")}
                disabled={busy || !!initial.error}
                onPress={() => setConfirm({ kind: "reset" })}
              />
            </>
          )}
          {confirm && (
            <>
              <ThemedText>
                {t(
                  confirm.kind === "remove"
                    ? "ipTemplates.removeHint"
                    : confirm.kind === "logo"
                      ? "ipTemplates.cancelLogoHint"
                      : "ipTemplates.resetHint"
                )}
              </ThemedText>
              <Button
                label={t("ipTemplates.confirm")}
                disabled={busy}
                onPress={() => {
                  try {
                    if (confirm.kind === "remove")
                      change(
                        draft.templates
                          .filter((item) => item.id !== confirm.id)
                          .map((item, i) => ({ ...item, order: i + 1 }))
                      );
                    else if (confirm.kind === "logo") persist({ ...draft, logo: null });
                    else {
                      if (pending) box.clear(pending.clientKey);
                      persist({ ...snapshot, logo: null });
                      setPending(null);
                      setSelected(snapshot.templates[0]?.id);
                    }
                    setConfirm(null);
                  } catch (e) {
                    failure(e);
                  }
                }}
              />
              <Button label={t("common.cancel")} disabled={busy} onPress={() => setConfirm(null)} />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
