import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import { repairTargets, type RepairContent } from "../lib/story-repair-fields";
import {
  compileRepairInteractions,
  newRepairInteraction,
  readRepairInteractions,
  type RepairInteraction,
} from "../lib/story-repair-interactions";
import { StoryRepairEffectsEditor } from "./story-repair-effects-editor";
const draftSchema = z.object({ base: z.string(), rows: z.array(z.record(z.unknown())).max(100) });
type Draft = z.infer<typeof draftSchema>;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export function StoryRepairInteractionsEditor({
  content,
  nodeId,
  defaultLocale,
  userId,
  storageKey,
  canEdit,
  applyError,
  onApply,
  onClose,
}: {
  content: RepairContent;
  nodeId: string;
  defaultLocale: string;
  userId: string;
  storageKey: string;
  canEdit: boolean;
  applyError?: string;
  onApply: (value: RepairInteraction[]) => boolean;
  onClose: () => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const record = useMemo(
    () => durableRecord("story-interactions-edit", userId, storageKey),
    [userId, storageKey]
  );
  const source = content.graph.nodes.find((n) => n.nodeId === nodeId)?.interactions;
  const base = JSON.stringify(source);
  const initial = (): Draft => ({ base, rows: readRepairInteractions(content, nodeId) });
  const [loaded] = useState(() => {
    try {
      const raw = record.read();
      return {
        draft: raw === null || raw === "null" ? initial() : draftSchema.parse(JSON.parse(raw)),
        error: undefined,
      };
    } catch (e) {
      return { draft: null, error: String(e) };
    }
  });
  const [draft, setDraft] = useState<Draft | null>(loaded.draft),
    [error, setError] = useState<string | undefined>(loaded.error),
    [rejected, setRejected] = useState(false),
    [selected, setSelected] = useState(0),
    [effectOutcome, setEffectOutcome] = useState<string>();
  const conflict = !!draft && draft.base !== base,
    disabled = !canEdit || conflict;
  const change = (rows: Draft["rows"]) => {
    if (disabled || !draft) return false;
    try {
      const next = { ...draft, rows };
      record.write(JSON.stringify(next));
      setDraft(next);
      setError(undefined);
      setRejected(false);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  const current = draft?.rows[selected];
  const update = (patch: Record<string, unknown>) =>
    !!draft && change(draft.rows.map((r, i) => (i === selected ? { ...r, ...patch } : r)));
  const field = (
    label: string,
    value: unknown,
    onChange: (value: string) => void,
    maxLength?: number
  ) => (
    <View>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value == null ? "" : String(value)}
        editable={!disabled}
        onChangeText={onChange}
        maxLength={maxLength}
        style={{
          color: theme.text,
          minHeight: 44,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
        }}
      />
    </View>
  );
  const action = (label: string, onPress: () => void, blocked = disabled) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked }}
      disabled={blocked}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: blocked ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
  const select = (
    label: string,
    value: unknown,
    values: (
      | "tap"
      | "swipe"
      | "press-hold"
      | "up"
      | "down"
      | "left"
      | "right"
      | "window"
      | "hold"
      | "none"
      | "continue"
      | "pause"
      | "seek"
      | "goto"
    )[],
    onChange: (v: string) => void
  ) => (
    <View>
      <ThemedText type="small">{label}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {values.map((v) => (
          <View key={v}>
            {action(`${v === value ? "● " : "○ "}${t(`storyHotspot.${v}`)}`, () => onChange(v))}
          </View>
        ))}
      </View>
    </View>
  );
  const outcomes = obj(current?.outcomes),
    trigger = obj(current?.trigger),
    rect = obj(current?.rect),
    labels = obj(current?.label);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 12 }}
        >
          <ThemedText type="smallBold">{t("storyHotspot.title")}</ThemedText>
          {action(t("agent.close"), onClose, false)}
          <ThemedText type="small">{t("storyHotspot.help")}</ThemedText>
          {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
          {rejected ? (
            <ThemedText accessibilityRole="alert">
              {applyError || t("storyCondition.applyFailed")}
            </ThemedText>
          ) : null}
          {conflict ? (
            <ThemedText accessibilityRole="alert">{t("storyCondition.conflict")}</ThemedText>
          ) : null}
          {draft?.rows.map((r, i) => (
            <View key={String(r.interactionId)}>
              {action(
                `${i === selected ? "● " : "○ "}${obj(r.label)[locale] || obj(r.label)[defaultLocale] || `${t("storyHotspot.item")} ${i + 1}`}`,
                () => setSelected(i),
                false
              )}
            </View>
          ))}
          {draft
            ? action(
                t("storyHotspot.add"),
                () => {
                  const next = newRepairInteraction(uuid.v4(), locale, defaultLocale);
                  if (change([...draft.rows, next])) setSelected(draft.rows.length);
                },
                disabled || draft.rows.length >= 100
              )
            : null}
          {current ? (
            <>
              {[...new Set([defaultLocale, locale])].map((lang) => (
                <View key={lang}>
                  {field(
                    `${t("storyHotspot.label")} (${lang})`,
                    labels[lang],
                    (v) => update({ label: { ...labels, [lang]: v } }),
                    4000
                  )}
                </View>
              ))}
              {select(
                t("storyHotspot.trigger"),
                trigger.kind,
                ["tap", "swipe", "press-hold"],
                (kind) =>
                  update({
                    trigger:
                      kind === "tap"
                        ? { kind }
                        : kind === "swipe"
                          ? { kind, direction: "right" }
                          : { kind, durationMs: 1000, controlTimeline: false },
                  })
              )}
              {trigger.kind === "swipe"
                ? select(
                    t("storyHotspot.direction"),
                    trigger.direction,
                    ["up", "down", "left", "right"],
                    (direction) => update({ trigger: { ...trigger, direction } })
                  )
                : null}
              {trigger.kind === "press-hold" ? (
                <>
                  {field(t("storyHotspot.duration"), trigger.durationMs, (v) =>
                    update({ trigger: { ...trigger, durationMs: v } })
                  )}
                  {action(
                    `${trigger.controlTimeline ? "● " : "○ "}${t("storyHotspot.controlTimeline")}`,
                    () =>
                      update({ trigger: { ...trigger, controlTimeline: !trigger.controlTimeline } })
                  )}
                </>
              ) : null}
              {select(
                t("storyHotspot.timing"),
                current.timing ?? "window",
                ["window", "hold"],
                (timing) => update({ timing })
              )}
              {(["startMs", "endMs", "branchAtMs"] as const).map((key) => (
                <View key={key}>
                  {field(t(`storyHotspot.${key}`), current[key], (v) => update({ [key]: v }))}
                </View>
              ))}
              <ThemedText type="small">{t("storyHotspot.rectHelp")}</ThemedText>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <View key={key}>
                  {field(t(`storyHotspot.${key}`), rect[key], (v) =>
                    update({ rect: { ...rect, [key]: v } })
                  )}
                </View>
              ))}
              {(["success", "failure", "timeout"] as const).map((key) => {
                const out = obj(outcomes[key]);
                const set = (next: Record<string, unknown> | null) => {
                  const all = { ...outcomes };
                  if (next) all[key] = next;
                  else delete all[key];
                  update({ outcomes: all });
                };
                return (
                  <View
                    key={key}
                    style={{
                      borderColor: theme.border,
                      borderWidth: 1,
                      borderRadius: 8,
                      padding: 12,
                      gap: 8,
                    }}
                  >
                    {select(
                      t(`storyHotspot.${key}`),
                      out.kind ?? "none",
                      key === "success"
                        ? ["continue", "pause", "seek", "goto"]
                        : ["none", "continue", "pause", "seek", "goto"],
                      (kind) =>
                        set(
                          kind === "none"
                            ? null
                            : {
                                kind,
                                ...(out.effects ? { effects: out.effects } : {}),
                                ...(kind === "seek" ? { timeMs: 0 } : {}),
                                ...(kind === "goto"
                                  ? { target: repairTargets(content, locale)[0]?.value }
                                  : {}),
                              }
                        )
                    )}
                    {out.kind === "seek"
                      ? field(t("storyHotspot.seekMs"), out.timeMs, (v) =>
                          set({ ...out, timeMs: v })
                        )
                      : null}
                    {out.kind === "goto" ? (
                      <View>
                        {repairTargets(content, locale).map((target) => (
                          <View key={JSON.stringify(target.value)}>
                            {action(
                              `${JSON.stringify(out.target) === JSON.stringify(target.value) ? "● " : "○ "}${target.label}`,
                              () => set({ ...out, target: target.value })
                            )}
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {out.kind ? action(t("storyEffects.title"), () => setEffectOutcome(key)) : null}
                  </View>
                );
              })}
              {action(t("storyHotspot.remove"), () =>
                Alert.alert(t("storyHotspot.remove"), t("storyHotspot.removeHelp"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("storyHotspot.remove"),
                    style: "destructive",
                    onPress: () => {
                      if (draft && change(draft.rows.filter((_, i) => i !== selected)))
                        setSelected(0);
                    },
                  },
                ])
              )}
            </>
          ) : null}
          {draft
            ? action(t("storyHotspot.apply"), () => {
                try {
                  const next = compileRepairInteractions(draft.rows);
                  if (onApply(next)) {
                    record.write("null");
                    onClose();
                  } else setRejected(true);
                } catch (e) {
                  setError(String(e));
                }
              })
            : null}
          {conflict || !draft
            ? action(
                t("storyCondition.reload"),
                () => {
                  try {
                    const next = initial();
                    record.write("null");
                    setDraft(next);
                    setError(undefined);
                    setRejected(false);
                  } catch (e) {
                    setError(String(e));
                  }
                },
                !canEdit
              )
            : null}
        </ScrollView>
        {effectOutcome && current ? (
          <StoryRepairEffectsEditor
            content={content}
            effects={obj(outcomes[effectOutcome]).effects ?? []}
            userId={userId}
            storageKey={`${storageKey}:${String(current.interactionId)}:${effectOutcome}`}
            canEdit={!disabled}
            applyError={error}
            onApply={(effects) =>
              update({
                outcomes: {
                  ...outcomes,
                  [effectOutcome]: { ...obj(outcomes[effectOutcome]), effects },
                },
              })
            }
            onClose={() => setEffectOutcome(undefined)}
          />
        ) : null}
      </View>
    </Modal>
  );
}
