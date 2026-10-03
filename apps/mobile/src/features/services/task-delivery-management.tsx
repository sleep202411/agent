import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { fetchTaskCommitments } from "./task-commitment-api";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskDeliveryTemplate,
  deliveryPrice,
  type DeliveryTemplate,
} from "./task-delivery-api";
import { fetchDeliveryCatalog, type DeliveryCategory } from "./task-delivery-management-api";
import { useTaskDeliverySession, type TaskDeliverySession } from "./use-task-delivery-session";
import type { TaskDetail } from "./task-detail-api";
type Props = {
  task: TaskDetail;
  generation: number;
  userId: string;
  onRefresh(): void;
  session?: TaskDeliverySession;
};
export function TaskDeliveryManagement(props: Props) {
  if (props.session) return <DeliveryAccess {...props} session={props.session} />;
  return <LocalDelivery key={`${props.generation}:${props.task.id}`} {...props} />;
}
function LocalDelivery(props: Props) {
  const session = useTaskDeliverySession(props.task.id, props.generation, props.onRefresh);
  return <DeliveryAccess {...props} session={session} />;
}
type ActiveProps = Props & { session: TaskDeliverySession };
function DeliveryAccess(props: ActiveProps) {
  if (props.task.status !== "open" || props.task.submissions.length) return null;
  return <Manager key={`${props.generation}:${props.task.id}:${props.task.version}`} {...props} />;
}
function Manager({ task, generation, userId, onRefresh, session }: ActiveProps) {
  const t = useTranslations();
  const [locked, setLocked] = useState(false);
  const [allowed, setAllowed] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<DeliveryCategory[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [template, setTemplate] = useState<DeliveryTemplate | null>();
  const choice = session.draft?.choice;
  const setChoice = session.change;
  const failedSave = !!session.draft?.attemptedAt;
  const stale = !!session.draft && task.version !== session.draft.snapshot.version;
  const canReview =
    !!session.draft &&
    !session.busy &&
    (stale || (failedSave && task !== session.draft.attemptedAt));
  const [loading, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const editing = !!session.draft;
  const busy = loading || session.busy || (allowed && editing && !expanded && !error);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, controller.signal)
      .then(async (a) => {
        if (controller.signal.aborted || generation !== getAuthGeneration() || !a.canManage) return;
        const commitments = await fetchTaskCommitments(task.id, controller.signal);
        if (!controller.signal.aborted && generation === getAuthGeneration()) {
          const hasAccepted = commitments.some((record) => record.acceptedAt !== null);
          setLocked(hasAccepted);
          setAllowed(!hasAccepted);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(String(e instanceof Error ? e.message : e));
      });
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [task.crewId, task.id, userId, generation]);
  const load = useCallback(
    async (pageCursor?: string) => {
      const more = pageCursor !== undefined;
      if (active.current || generation !== getAuthGeneration()) return;
      const controller = new AbortController();
      active.current = controller;
      setBusy(true);
      setError(undefined);
      try {
        const [page, current] = await Promise.all([
          fetchDeliveryCatalog(task.crewId, controller.signal, pageCursor),
          more ? Promise.resolve(undefined) : fetchTaskDeliveryTemplate(task.id, controller.signal),
        ]);
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        if (more && page.nextCursor === pageCursor)
          throw Error("Delivery catalog pagination did not advance.");
        setRows((previous) =>
          Array.from(
            new Map([...(more ? previous : []), ...page.items].map((r) => [r.id, r])).values()
          )
        );
        setCursor(page.nextCursor);
        if (!more) setTemplate(current);
        setExpanded(true);
      } catch (e) {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
        }
      }
    },
    [task.crewId, task.id, generation]
  );
  useEffect(() => {
    if (!allowed || !editing || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    active.current = controller;
    void Promise.all([
      fetchDeliveryCatalog(task.crewId, controller.signal),
      fetchTaskDeliveryTemplate(task.id, controller.signal),
    ])
      .then(
        ([page, current]) => {
          if (controller.signal.aborted || generation !== getAuthGeneration()) return;
          setRows(page.items);
          setCursor(page.nextCursor);
          setTemplate(current);
          setExpanded(true);
        },
        (cause) => {
          if (!controller.signal.aborted && generation === getAuthGeneration())
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      )
      .finally(() => {
        if (active.current === controller) active.current = null;
      });
    return () => {
      controller.abort();
      if (active.current === controller) active.current = null;
    };
  }, [allowed, editing, task.crewId, task.id, generation]);
  const canSave = choice !== undefined && !busy && !failedSave && !stale && !error;
  const selected = choice === undefined ? template?.definition : choice?.definition;
  return (
    <View style={{ gap: 8 }}>
      {locked && <ThemedText>{t("taskDelivery.requirementsLocked")}</ThemedText>}
      {(error || session.draft?.error) && (
        <>
          <ThemedText accessibilityRole="alert">{error ?? session.draft?.error}</ThemedText>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {allowed && editing && !expanded && !busy && error && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => void load()}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={session.cancel}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText>{t("common.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
      {busy && <ActivityIndicator />}
      {allowed && !editing && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => session.open(task)}>
          <ThemedText>{t("taskDelivery.manage")}</ThemedText>
        </Pressable>
      )}
      {allowed && editing && expanded && (
        <>
          <ThemedText type="smallBold">{t("taskDelivery.manage")}</ThemedText>
          <Pressable
            style={{ paddingVertical: 12 }}
            accessibilityRole="radio"
            accessibilityState={{
              checked: choice === null || (choice === undefined && template === null),
            }}
            disabled={busy || failedSave}
            onPress={() => setChoice(null)}
          >
            <ThemedText>
              {choice === null || (choice === undefined && template === null) ? "✓ " : ""}
              {t("taskDelivery.withoutTemplate")}
            </ThemedText>
          </Pressable>
          {rows.map((row) => (
            <Pressable
              style={{ paddingVertical: 12 }}
              key={row.id}
              accessibilityRole="radio"
              accessibilityState={{
                checked:
                  choice === undefined
                    ? template?.categoryId === row.id && template.version === row.version
                    : choice?.id === row.id && choice.version === row.version,
              }}
              disabled={busy || failedSave}
              onPress={() => setChoice(row)}
            >
              <ThemedText>
                {(
                  choice === undefined
                    ? template?.categoryId === row.id && template.version === row.version
                    : choice?.id === row.id && choice.version === row.version
                )
                  ? "✓ "
                  : ""}
                {row.definition.name} · {t("taskDelivery.version")} {row.version}
              </ThemedText>
            </Pressable>
          ))}
          {cursor && (
            <Pressable
              style={{ paddingVertical: 12 }}
              accessibilityRole="button"
              disabled={busy || failedSave}
              onPress={() => void load(cursor ?? undefined)}
            >
              <ThemedText>{t("taskDelivery.moreCategories")}</ThemedText>
            </Pressable>
          )}
          {selected && (
            <>
              <ThemedText>{selected.description}</ThemedText>
              {selected.fields.map((f) => (
                <ThemedText key={f.key}>
                  {f.label}
                  {f.required ? ` (${t("taskDelivery.required")})` : ""}
                  {f.instructions ? ` · ${f.instructions}` : ""}
                </ThemedText>
              ))}
              {selected.prices.map((p) => (
                <ThemedText key={p.currency}>
                  {p.currency} {deliveryPrice(p.amountMinor)} / {p.unit}
                </ThemedText>
              ))}
              {!!selected.prices.length && (
                <ThemedText>{t("taskDelivery.referencePriceNote")}</ThemedText>
              )}
            </>
          )}
          {canReview && !loading && !error && (
            <View style={{ gap: 8 }}>
              <ThemedText>{t("taskDelivery.latestTemplate")}</ThemedText>
              <ThemedText>
                {template
                  ? `${template.definition.name} · ${t("taskDelivery.version")} ${template.version}`
                  : t("taskDelivery.noTemplate")}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                style={{ paddingVertical: 12 }}
                onPress={() => session.review(task)}
              >
                <ThemedText>{t("taskBrief.reviewLatest")}</ThemedText>
              </Pressable>
            </View>
          )}
          <Pressable
            style={{ paddingVertical: 12, opacity: canSave ? 1 : 0.45 }}
            accessibilityRole="button"
            disabled={!canSave}
            onPress={() => {
              if (allowed && !busy && !failedSave && !stale && !error) session.save(task);
            }}
          >
            <ThemedText>{t("taskDelivery.saveTemplate")}</ThemedText>
          </Pressable>
          <Pressable
            style={{ paddingVertical: 12 }}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setExpanded(false);
              session.cancel();
            }}
          >
            <ThemedText>{t("common.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}
