import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchTaskCommentAccess } from "./task-comment-api";
import { teamInvitationAccess } from "./crew-team-invitations-api";
import { CrewInviteLinks } from "./crew-invite-links";
import type { TaskDetail } from "./task-detail-api";
export function TaskInviteLinks({
  task,
  userId,
  generation,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
}) {
  const active = useScreenActive();
  if (
    !active ||
    generation !== getAuthGeneration() ||
    task.isRecruiting !== false ||
    task.assignees.length ||
    ["submitted", "approved", "cancelled"].includes(task.status)
  )
    return null;
  return (
    <Session
      key={`${task.id}:${task.version}:${userId}:${generation}`}
      task={task}
      userId={userId}
      generation={generation}
    />
  );
}
function Session({
  task,
  userId,
  generation,
}: {
  task: TaskDetail;
  userId: string;
  generation: number;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      fetchTaskCommentAccess(task.crewId, userId, c.signal),
      teamInvitationAccess(task.crewId, userId, generation, c.signal),
    ])
      .then(([access]) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setAllowed(access.canManage);
      })
      .catch((cause: unknown) => {
        if (c.signal.aborted || generation !== getAuthGeneration()) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message !== "Crew invitation permission is required.") setError(message);
      });
    return () => c.abort();
  }, [task.crewId, userId, generation, revision]);
  if (error)
    return (
      <View>
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
        <Pressable
          accessibilityRole="button"
          style={{ paddingVertical: 12 }}
          onPress={() => {
            setError("");
            setRevision((v) => v + 1);
          }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      </View>
    );
  if (!allowed) return null;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        style={{ paddingVertical: 12 }}
        onPress={() => setOpen(true)}
      >
        <ThemedText>{t("workspace.taskInviteTitle")}</ThemedText>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && (
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <CrewInviteLinks
              crewId={task.crewId}
              userId={userId}
              generation={generation}
              task={task}
              onClose={() => setOpen(false)}
            />
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
}
