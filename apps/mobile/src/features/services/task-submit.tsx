import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTaskSubmitSession, type TaskSubmitSession } from "./use-task-submit-session";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { AssetFileUpload } from "@/features/crew-assets/file-upload";
import { CrewAssetPicker } from "@/features/crew-assets/asset-picker";
import type { TaskDetail } from "./task-detail-api";
import { fetchTaskDeliveryTemplate, type DeliveryTemplate } from "./task-delivery-api";
import {
  fetchTaskSubmitPermission,
  fetchDeliveryFolders,
  validateTaskSubmission,
  type DeliveryAnswers,
  type DeliveryFolder,
  type TaskSubmitInput,
} from "./task-submit-api";

type Props = {
  task: TaskDetail;
  userId: string;
  generation: number;
  onRefresh: () => void;
  session?: TaskSubmitSession;
  /** TaskDetail owns the upload modal across detail refreshes. */
  uploadHosted?: boolean;
};
export function TaskSubmit(props: Props) {
  if (props.session) return <SubmissionWithUpload {...props} session={props.session} />;
  return (
    <LocalSubmission key={`${props.task.id}:${props.userId}:${props.generation}`} {...props} />
  );
}
function LocalSubmission(props: Props) {
  const session = useTaskSubmitSession(props.task.id, props.generation, props.onRefresh);
  return <SubmissionWithUpload {...props} session={session} />;
}
function SubmissionWithUpload(props: Props & { session: TaskSubmitSession }) {
  return (
    <>
      <SubmissionAccess {...props} />
      {!props.uploadHosted && (
        <TaskSubmissionUpload
          session={props.session}
          crewId={props.task.crewId}
          userId={props.userId}
          generation={props.generation}
        />
      )}
    </>
  );
}
export function TaskSubmissionUpload(props: {
  session: TaskSubmitSession;
  crewId: string;
  userId: string;
  generation: number;
}) {
  return props.session.upload ? (
    <SubmissionUploadDialog key={props.session.upload.sequence} {...props} />
  ) : null;
}
function SubmissionUploadDialog({
  session,
  crewId,
  userId,
  generation,
}: {
  session: TaskSubmitSession;
  crewId: string;
  userId: string;
  generation: number;
}) {
  const theme = useTheme(),
    t = useTranslations();
  const upload = session.upload!;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const close = () => {
    if (live.current && generation === getAuthGeneration()) session.setUpload(undefined);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <AssetFileUpload
          crewId={crewId}
          userId={userId}
          generation={generation}
          parentId={upload.parentId}
          destination={upload.destination ?? t("studioMedia.root")}
          onClose={close}
          onAttached={(asset) => {
            if (!live.current || generation !== getAuthGeneration()) return;
            session.setAssets((current) =>
              current.some((item) => item.id === asset.id) ? current : [...current, asset]
            );
            // Bind to the template selected before opening the native picker, even if a
            // foreground refresh loads a different delivery template in the meantime.
            session.setAnswersByTemplate((current) => {
              const answers = current[upload.templateKey] ?? {};
              const previous = answers[upload.field];
              return {
                ...current,
                [upload.templateKey]: {
                  ...answers,
                  [upload.field]: [
                    ...new Set([...(Array.isArray(previous) ? previous : []), asset.id]),
                  ],
                },
              };
            });
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}
function SubmissionAccess(props: Props & { session: TaskSubmitSession }) {
  if (!["open", "in_progress", "revision_requested"].includes(props.task.status)) return null;
  return (
    <SubmissionForm key={`${props.task.id}:${props.task.version}:${props.generation}`} {...props} />
  );
}
function SubmissionForm({
  task,
  userId,
  generation,
  onRefresh,
  session,
}: Props & { session: TaskSubmitSession }) {
  const t = useTranslations(),
    theme = useTheme();
  const { note, setNote, assets, setAssets, folder, setFolder } = session;
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const observe = session.observe;
  useLayoutEffect(() => observe(task), [observe, task]);
  const [context, setContext] = useState<{
    allowed: boolean;
    template: DeliveryTemplate | null;
    folders: DeliveryFolder[];
  }>();
  const [localError, setError] = useState<string>();
  const error = localError ?? session.error;
  const templateKey = context?.template
    ? `${context.template.categoryId}:${context.template.version}`
    : "none";
  const answers = session.answersByTemplate[templateKey] ?? {};
  const setAnswers = (update: SetStateAction<DeliveryAnswers>) =>
    session.setAnswersByTemplate((previous) => ({
      ...previous,
      [templateKey]: typeof update === "function" ? update(previous[templateKey] ?? {}) : update,
    }));
  const [picker, setPicker] = useState<"files" | "folders">();
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const allowed = await fetchTaskSubmitPermission(task, userId, controller.signal);
      if (!allowed || controller.signal.aborted || generation !== getAuthGeneration())
        return { allowed: false, template: null, folders: [] };
      const [template, folders] = await Promise.all([
        fetchTaskDeliveryTemplate(task.id, controller.signal),
        fetchDeliveryFolders(task.crewId, controller.signal),
      ]);
      return { allowed, template, folders };
    })().then(
      (value) => {
        if (!controller.signal.aborted && generation === getAuthGeneration()) setContext(value);
      },
      (cause) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [task, userId, generation]);
  if (context?.allowed === false) return null;
  const locked = session.locked(task);
  const blocked = task.blockedBy.some((dependency) => !dependency.resolved);
  const input: TaskSubmitInput = {
    note,
    assetNodeIds: assets.map((a) => a.id),
    ...(folder ? { deliveryFolderId: folder.id } : {}),
    ...(context?.template
      ? {
          professionalDelivery: {
            categoryId: context.template.categoryId,
            version: context.template.version,
            answers,
          },
        }
      : {}),
  };
  let valid = false;
  if (context) {
    try {
      validateTaskSubmission(input, context.template);
      valid = true;
    } catch {
      /* Required fields remain visible below. */
    }
  }
  const remove = (id: string) => {
    setAssets((current) => current.filter((a) => a.id !== id));
    setAnswers((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.filter((item) => item !== id) : value,
        ])
      )
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("taskSubmit.submitTitle")}</ThemedText>
      {!context && !error && <ActivityIndicator />}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {context?.allowed && (
        <>
          <ThemedText>{t("taskSubmit.submitDescription")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => setPicker("folders")}
            style={{ padding: 12 }}
          >
            <ThemedText>
              {t("taskSubmit.deliveryFolder")}:{" "}
              {folder?.name ?? t("taskSubmit.automaticDeliveryFolder")}
            </ThemedText>
          </Pressable>
          <TextInput
            accessibilityLabel={t("taskSubmit.submitNotePlaceholder")}
            placeholder={t("taskSubmit.submitNotePlaceholder")}
            placeholderTextColor={theme.textSecondary}
            value={note}
            onChangeText={setNote}
            editable={!locked}
            multiline
            maxLength={5000}
            style={{ color: theme.text, padding: 12, minHeight: 60 }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={locked || assets.length >= 100}
            onPress={() => setPicker("files")}
            style={{ padding: 12 }}
          >
            <ThemedText>
              {t("crewAssets.choose")} · {assets.length}/100
            </ThemedText>
          </Pressable>
          {assets.map((asset) => (
            <Pressable
              key={asset.id}
              accessibilityRole="button"
              disabled={locked}
              accessibilityLabel={`${t("crewAssets.remove")} ${asset.name}`}
              onPress={() => remove(asset.id)}
              style={{ padding: 12 }}
            >
              <ThemedText>{asset.name} ×</ThemedText>
            </Pressable>
          ))}
          {context.template?.definition.fields.map((field) => (
            <View key={field.key} style={{ gap: 8 }}>
              <ThemedText>
                {field.label}
                {field.required ? " *" : ""}
              </ThemedText>
              {!!field.instructions && <ThemedText>{field.instructions}</ThemedText>}
              {field.type === "text" ? (
                <TextInput
                  accessibilityLabel={field.label}
                  value={
                    typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""
                  }
                  onChangeText={(value) =>
                    setAnswers((current) => ({ ...current, [field.key]: value }))
                  }
                  editable={!locked}
                  multiline
                  maxLength={5000}
                  style={{ color: theme.text, padding: 12, minHeight: 60 }}
                />
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("thread.uploadFile")}: ${field.label}`}
                    disabled={locked || assets.length >= 100}
                    onPress={() => {
                      if (!session.locked(task) && generation === getAuthGeneration())
                        session.beginUpload(task, templateKey, field.key);
                    }}
                    style={{ padding: 12 }}
                  >
                    <ThemedText>{t("thread.uploadFile")}</ThemedText>
                  </Pressable>
                  {!assets.length && <ThemedText>{t("taskSubmit.selectFilesFirst")}</ThemedText>}
                  {assets.map((asset) => {
                    const value = answers[field.key],
                      ids = Array.isArray(value) ? value : [],
                      checked = ids.includes(asset.id);
                    return (
                      <Pressable
                        key={asset.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        disabled={locked}
                        onPress={() =>
                          setAnswers((current) => {
                            const previous = current[field.key],
                              selected = Array.isArray(previous) ? previous : [];
                            return {
                              ...current,
                              [field.key]: selected.includes(asset.id)
                                ? selected.filter((id) => id !== asset.id)
                                : [...selected, asset.id],
                            };
                          })
                        }
                        style={{ padding: 12 }}
                      >
                        <ThemedText>
                          {checked ? "● " : "○ "}
                          {asset.name}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </View>
          ))}
          {blocked && (
            <ThemedText accessibilityRole="alert">
              {t("taskRelations.blockedSubmitHint")}
            </ThemedText>
          )}
          {!valid && <ThemedText>{t("taskSubmit.completeRequired")}</ThemedText>}
          <Pressable
            accessibilityRole="button"
            disabled={locked || !valid || blocked}
            style={{ padding: 12 }}
            onPress={() => {
              if (session.locked(task) || !valid || blocked || generation !== getAuthGeneration())
                return;
              setError(undefined);
              session.save(task, userId, input, context.template);
            }}
          >
            <ThemedText>{t("taskSubmit.submitAction")}</ThemedText>
          </Pressable>
          {session.busy && <ActivityIndicator />}
        </>
      )}
      <Modal visible={!!picker} animationType="slide" onRequestClose={() => setPicker(undefined)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          {picker === "files" && (
            <CrewAssetPicker
              crewId={task.crewId}
              excludedIds={assets.map((a) => a.id)}
              remaining={100 - assets.length}
              onClose={() => setPicker(undefined)}
              onSelect={(selected) => {
                if (!live.current || generation !== getAuthGeneration() || session.locked(task))
                  return;
                setAssets((current) =>
                  [
                    ...current,
                    ...selected.filter((a) => !current.some((old) => old.id === a.id)),
                  ].slice(0, 100)
                );
                setPicker(undefined);
              }}
            />
          )}
          {picker === "folders" && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              <ThemedText type="smallBold">{t("taskSubmit.deliveryFolder")}</ThemedText>
              <Pressable
                onPress={() => {
                  setFolder(undefined);
                  setPicker(undefined);
                }}
              >
                <ThemedText>{t("taskSubmit.automaticDeliveryFolder")}</ThemedText>
              </Pressable>
              {context?.folders.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: folder?.id === item.id }}
                  onPress={() => {
                    if (generation === getAuthGeneration()) setFolder(item);
                    setPicker(undefined);
                  }}
                  style={{ padding: 12 }}
                >
                  <ThemedText>{item.name}</ThemedText>
                </Pressable>
              ))}
              <Pressable onPress={() => setPicker(undefined)}>
                <ThemedText>{t("myServices.cancel")}</ThemedText>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
