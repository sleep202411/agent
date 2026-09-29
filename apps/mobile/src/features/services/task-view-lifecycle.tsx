import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createTaskView,
  deleteTaskView,
  fetchViewLifecycleContext,
  newViewInput,
} from "./task-view-lifecycle-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  viewId: string;
  action: "create" | "remove";
  onClose: () => void;
  onChanged: (viewId: string) => void;
};
type Context = Awaited<ReturnType<typeof fetchViewLifecycleContext>>;
export function TaskViewLifecycle(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.viewId}:${props.action}`}
      {...props}
    />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [context, setContext] = useState<Context>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchViewLifecycleContext(
      props.crewId,
      props.viewId,
      props.userId,
      props.generation,
      c.signal
    ).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setContext(value);
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.viewId, props.userId, props.generation]);
  if (context) return <Form {...props} context={context} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {!error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </View>
  );
}
function Form(props: Props & { context: Context }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${props.viewId}:${props.action}`, true);
  const [name, setName] = useState(""),
    [layout, setLayout] = useState<"list" | "board">("list");
  const [armed, setArmed] = useState(false),
    [attempted, setAttempted] = useState(false),
    [error, setError] = useState<string>();
  const locked = op.busy || attempted,
    creating = props.action === "create";
  const parsed = newViewInput.safeParse({ name, layout });
  const deletable = !props.context.view.isSystem && !!props.context.fallbackId;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t(creating ? "viewLifecycle.create" : "viewLifecycle.remove")}
      </ThemedText>
      <ThemedText>{props.context.view.name}</ThemedText>
      {creating ? (
        <>
          <ThemedText>{t("viewLifecycle.copyHelp")}</ThemedText>
          <ThemedText>{t("viewEdit.name")}</ThemedText>
          <TextInput
            accessibilityLabel={t("viewEdit.name")}
            value={name}
            onChangeText={setName}
            editable={!locked}
            maxLength={80}
            style={{ padding: 12, color: theme.text }}
          />
          <ThemedText>{t("viewEdit.layout")}</ThemedText>
          {(["list", "board"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: layout === value, disabled: locked }}
              disabled={locked}
              onPress={() => setLayout(value)}
              style={{
                padding: 12,
                backgroundColor:
                  layout === value ? theme.backgroundSelected : theme.backgroundElement,
              }}
            >
              <ThemedText>{t(`viewEdit.${value}`)}</ThemedText>
            </Pressable>
          ))}
          <ThemedText>{t("viewEdit.webDisplay")}</ThemedText>
        </>
      ) : (
        <>
          <ThemedText>{t("viewLifecycle.deleteHelp")}</ThemedText>
          {!deletable && (
            <ThemedText accessibilityRole="alert">
              {t(props.context.view.isSystem ? "viewLifecycle.system" : "viewLifecycle.last")}
            </ThemedText>
          )}
          {armed && <ThemedText>{t("viewLifecycle.confirmHelp")}</ThemedText>}
        </>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && error && <ThemedText>{t("viewLifecycle.recheck")}</ThemedText>}
      <Button
        label={t(
          creating
            ? "viewLifecycle.create"
            : armed
              ? "viewLifecycle.confirmRemove"
              : "viewLifecycle.remove"
        )}
        disabled={locked || (creating ? !parsed.success : !deletable)}
        onPress={() => {
          if (locked || (creating ? !parsed.success : !deletable)) return;
          if (!creating && !armed) {
            setArmed(true);
            return;
          }
          void op.run(
            async () => {
              setAttempted(true);
              if (creating && parsed.success)
                return (
                  await createTaskView(
                    props.context.view,
                    parsed.data,
                    props.userId,
                    props.generation
                  )
                ).id;
              return deleteTaskView(props.context.view, props.userId, props.generation);
            },
            props.onChanged,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      />
      {op.busy && <ActivityIndicator />}
      <Button label={t("crewTasks.back")} disabled={op.busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
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
