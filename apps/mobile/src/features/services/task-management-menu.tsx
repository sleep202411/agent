import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchTaskCommentAccess } from "./task-comment-api";
import type { TaskDetail } from "./task-detail-api";
export function TaskManagementMenu({
  task,
  userId,
  generation,
  edit,
  invite,
  recruit,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
  edit(): void;
  invite(): void;
  recruit(): void;
}) {
  const t = useTranslations();
  const [canInvite, setCanInvite] = useState(false);
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, c.signal)
      .then((v) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) {
          setAllowed(v.canManage);
          setCanInvite(v.canInvite);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e));
      });
    return () => c.abort();
  }, [task.crewId, userId, generation]);
  if (error) return <ThemedText accessibilityRole="alert">{error}</ThemedText>;
  if (!allowed || generation !== getAuthGeneration()) return null;
  const available =
    !task.assignees.length && !["approved", "cancelled", "submitted"].includes(task.status);
  const item = (
    label: "taskMenu.edit" | "taskMenu.invite" | "taskMenu.recruit",
    action: () => void
  ) => (
    <Pressable
      accessibilityRole="button"
      style={{ minHeight: 44, padding: 12 }}
      onPress={() => {
        setOpen(false);
        action();
      }}
    >
      <ThemedText>{t(label)}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("taskMenu.title")}
        accessibilityState={{ expanded: open }}
        style={{ padding: 12, minHeight: 44 }}
        onPress={() => setOpen(!open)}
      >
        <ThemedText>•••</ThemedText>
      </Pressable>
      {open && (
        <View>
          {item("taskMenu.edit", edit)}
          {canInvite && available && task.isRecruiting === false && item("taskMenu.invite", invite)}
          {available && item("taskMenu.recruit", recruit)}
        </View>
      )}
    </View>
  );
}
