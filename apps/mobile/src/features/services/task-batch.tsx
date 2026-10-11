import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, type MessageKey } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
import { fetchBatchTasks, canBatchTask, submitTaskBatch, type BatchTask } from "./task-batch-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  mode: "assign" | "recruit";
  onClose: () => void;
};
export function TaskBatch(props: Props) {
  const [revision, setRevision] = useState(0);
  return <BatchSession key={revision} {...props} refresh={() => setRevision((v) => v + 1)} />;
}
function BatchSession(props: Props & { refresh: () => void }) {
  const t = useTranslations();
  const op = useAuthFormOperation(props.crewId, true);
  const [tasks, setTasks] = useState<BatchTask[]>([]),
    [members, setMembers] = useState<CrewMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [memberCursor, setMemberCursor] = useState<string | null>(null);
  const [seen] = useState(() => new Set<string>()),
    [seenMembers] = useState(() => new Set<string>());
  const [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [attempted, setAttempted] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void Promise.all([
      fetchBatchTasks(props.crewId, props.userId, props.generation, null, c.signal),
      props.mode === "assign"
        ? fetchCrewMemberPage(props.crewId, props.userId, props.generation, null, c.signal)
        : null,
    ])
      .then(([page, people]) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        setTasks(page.items);
        setCursor(page.nextCursor);
        if (page.nextCursor) seen.add(page.nextCursor);
        if (people) {
          setMembers(people.items);
          setMemberCursor(people.nextCursor);
          if (people.nextCursor) seenMembers.add(people.nextCursor);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.mode, seen, seenMembers]);
  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }
  const locked = attempted || op.busy || loading || !!error;
  const chosen = tasks.filter((task) => selected.includes(task.id));
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">
        {t(
          props.mode === "assign" ? "mobileProduction.batchAssign" : "mobileProduction.batchRecruit"
        )}
      </ThemedText>
      <ThemedText>{t("mobileProduction.batchEligibility")}</ThemedText>
      <ThemedText>{t("mobileProduction.batchTerms")}</ThemedText>
      {loading && <ActivityIndicator />}
      {(
        [
          "all",
          "scripts",
          "characters",
          "scenes",
          "props",
          "art",
          "music",
          "production",
          "finalEditing",
          "other",
        ] as const
      ).map((category) => {
        const ids = tasks
          .filter(
            (task) => canBatchTask(task) && (category === "all" || task.assetCategory === category)
          )
          .map((task) => task.id);
        if (!ids.length) return null;
        const count = ids.filter((id) => selected.includes(id)).length;
        return (
          <Pressable
            key={category}
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: count === ids.length ? true : count ? "mixed" : false,
              disabled: locked,
            }}
            disabled={locked}
            style={{ padding: 12 }}
            onPress={() =>
              setSelected((current) =>
                count === ids.length || (count > 0 && current.length >= 100)
                  ? current.filter((id) => !ids.includes(id))
                  : [...new Set([...current, ...ids])].slice(0, 100)
              )
            }
          >
            <ThemedText>
              {t("mobileProduction.batchSelectGroup").replace(
                "{title}",
                t(`mobileProduction.batchGroup_${category}` as MessageKey)
              )}{" "}
              ({count}/{ids.length})
            </ThemedText>
          </Pressable>
        );
      })}
      {tasks.map((task) => (
        <View key={task.id} style={{ paddingVertical: 6 }}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{
              checked: selected.includes(task.id),
              disabled: locked || !canBatchTask(task),
            }}
            disabled={locked || !canBatchTask(task)}
            onPress={() =>
              setSelected((ids) =>
                ids.includes(task.id)
                  ? ids.filter((id) => id !== task.id)
                  : ids.length < 100
                    ? [...ids, task.id]
                    : ids
              )
            }
            style={{ padding: 12, opacity: canBatchTask(task) ? 1 : 0.5 }}
          >
            <ThemedText>
              {selected.includes(task.id) ? "✓ " : ""}TASK-{task.number} · {task.title}
            </ThemedText>
            <ThemedText>
              {task.rewardUsdMinor === null
                ? t("positionCreate.negotiable")
                : formatFinanceMoney(String(task.rewardUsdMinor), task.rewardCurrency)}
            </ThemedText>
          </Pressable>
        </View>
      ))}
      {cursor && (
        <Action
          disabled={locked}
          label={t("crewComputeFinance.older")}
          onPress={() =>
            void op.run(
              () =>
                fetchBatchTasks(
                  props.crewId,
                  props.userId,
                  props.generation,
                  cursor,
                  new AbortController().signal
                ),
              (page) => {
                if (
                  (page.nextCursor && seen.has(page.nextCursor)) ||
                  page.items.some((task) => tasks.some((old) => old.id === task.id))
                ) {
                  fail(new Error("Task pagination changed. Refresh to reload."));
                  return;
                }
                if (page.nextCursor) seen.add(page.nextCursor);
                setTasks((old) => [...old, ...page.items]);
                setCursor(page.nextCursor);
              },
              fail
            )
          }
        />
      )}
      <ThemedText>
        {t(
          props.mode === "assign"
            ? "mobileProduction.batchChooseMember"
            : "mobileProduction.batchChooseRole"
        )}
      </ThemedText>
      {(props.mode === "assign"
        ? members.map((member) => ({ id: member.userId, label: member.userId }))
        : PRESET_POSITIONS.map((position) => ({
            id: position.value,
            label: crewPositionLabel(position.value, t),
          }))
      ).map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: target === option.id }}
          disabled={locked}
          style={{ padding: 12 }}
          onPress={() => setTarget(option.id)}
        >
          <ThemedText>
            {target === option.id ? "✓ " : ""}
            {option.label}
          </ThemedText>
        </Pressable>
      ))}
      {memberCursor && (
        <Action
          disabled={locked}
          label={t("mobileProduction.moreMembers")}
          onPress={() =>
            void op.run(
              () =>
                fetchCrewMemberPage(
                  props.crewId,
                  props.userId,
                  props.generation,
                  memberCursor,
                  new AbortController().signal
                ),
              (page) => {
                if (
                  (page.nextCursor && seenMembers.has(page.nextCursor)) ||
                  page.items.some((member) => members.some((old) => old.userId === member.userId))
                ) {
                  fail(new Error("Member pagination changed. Refresh to reload."));
                  return;
                }
                if (page.nextCursor) seenMembers.add(page.nextCursor);
                setMembers((old) => [...old, ...page.items]);
                setMemberCursor(page.nextCursor);
              },
              fail
            )
          }
        />
      )}
      <ThemedText>
        {t("mobileProduction.selection").replace("{count}", String(selected.length))}
      </ThemedText>
      <Action
        disabled={locked || !chosen.length || !target}
        label={t(
          props.mode === "assign" ? "mobileProduction.batchAssign" : "mobileProduction.batchRecruit"
        )}
        onPress={() => {
          if (props.generation !== getAuthGeneration()) return;
          void op.run(
            async () => {
              setAttempted(true);
              return submitTaskBatch(
                props.crewId,
                props.userId,
                props.generation,
                chosen,
                props.mode,
                target
              );
            },
            () => setDone(true),
            fail
          );
        }}
      />
      {op.busy && <ActivityIndicator />}
      {done && <ThemedText>{t("mobileProduction.batchDone")}</ThemedText>}
      {attempted && !done && <ThemedText>{t("mobileProduction.batchRetryHelp")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Action disabled={op.busy} label={t("thread.refresh")} onPress={props.refresh} />
      <Action disabled={op.busy} label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
      onPress={onPress}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
