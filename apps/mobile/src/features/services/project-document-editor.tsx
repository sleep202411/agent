import { useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  createProjectDocumentSaver,
  ProjectDocumentSaveError,
  type ProjectDocumentPage,
} from "./project-document-api";
import { DocumentEditorFrame } from "./production-document-editor-frame";
import { documentEditorHtml, editorMessage } from "./production-document-editor-bridge";
export const editorLabelKeys = [
  "indent",
  "outdent",
  "background",
  "top",
  "middle",
  "bottom",
  "format",
  "save",
  "saving",
  "apply",
  "invalid",
  "undo",
  "redo",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bold",
  "italic",
  "underline",
  "strike",
  "bulletList",
  "orderedList",
  "taskList",
  "quote",
  "code",
  "codeBlock",
  "rule",
  "superscript",
  "subscript",
  "left",
  "center",
  "right",
  "justify",
  "link",
  "linkUrl",
  "unlink",
  "color",
  "highlight",
  "hexColor",
  "clearFormat",
  "emoji",
  "emojiName",
  "table",
  "addRow",
  "deleteRow",
  "addColumn",
  "deleteColumn",
  "mergeCells",
  "splitCell",
  "deleteTable",
] as const;
export function ProjectDocumentEditor({
  page,
  crewId,
  userId,
  generation,
  onClose,
  onSaved,
}: {
  page: ProjectDocumentPage;
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const [html] = useState(() =>
    documentEditorHtml(
      page.document,
      Object.fromEntries(editorLabelKeys.map((key) => [key, t(`documentEditor.${key}`)]))
    )
  );
  const [save] = useState(() => createProjectDocumentSaver(crewId, userId, generation, page));
  const active = useRef(true),
    pending = useRef(false),
    locked = useRef(false),
    dirty = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    active.current = true;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!pending.current) {
        if (dirty.current) setConfirm(true);
        else onClose();
      }
      return true;
    });
    return () => {
      active.current = false;
      back.remove();
    };
  }, [onClose]);
  const current = () => active.current && generation === getAuthGeneration();
  return (
    <View style={{ flex: 1, padding: 12, gap: 8 }}>
      <ThemedText type="smallBold">{t("documentEditor.title")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ThemedText>{t("documentEditor.saving")}</ThemedText>}
      {confirm ? (
        <View>
          <ThemedText>{t("documentEditor.discardQuestion")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClose}>
            <ThemedText>{t("documentEditor.discard")}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setConfirm(false)}>
            <ThemedText>{t("documentEditor.keepEditing")}</ThemedText>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            if (dirty.current) setConfirm(true);
            else onClose();
          }}
        >
          <ThemedText>{t("crewTasks.back")}</ThemedText>
        </Pressable>
      )}
      <DocumentEditorFrame
        title={t("documentEditor.title")}
        html={html}
        onError={() => {
          if (current()) {
            locked.current = true;
            setError(t("projectDocument.loadError"));
          }
        }}
        onMessage={(raw) => {
          if (!current()) return;
          const message = editorMessage(raw);
          if (!message) return;
          if (message.type === "dirty") {
            dirty.current = true;
            return;
          }
          if (message.type === "error") {
            locked.current = true;
            setError(t("projectDocument.loadError"));
            return;
          }
          if (message.type !== "save" || pending.current || locked.current) return;
          pending.current = true;
          dirty.current = true;
          setBusy(true);
          setError(undefined);
          void save(message.document)
            .then(
              () => {
                if (current()) onSaved();
              },
              (e) => {
                if (current()) {
                  locked.current = true;
                  setError(
                    e instanceof ProjectDocumentSaveError
                      ? t(`projectDocument.save.${e.code}`)
                      : e instanceof Error
                        ? e.message
                        : String(e)
                  );
                }
              }
            )
            .finally(() => {
              pending.current = false;
              if (current()) setBusy(false);
            });
        }}
      />
    </View>
  );
}
