import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { fetchTaskCommentAccess } from "./task-comment-api";
import {
  fetchTaskDeliveryTemplate,
  deliveryPrice,
  type DeliveryTemplate,
} from "./task-delivery-api";
import {
  fetchDeliveryCatalog,
  setDeliveryTemplate,
  type DeliveryCategory,
} from "./task-delivery-management-api";
import type { TaskDetail } from "./task-detail-api";
type Props = { task: TaskDetail; generation: number; userId: string; onRefresh(): void };
export function TaskDeliveryManagement(props: Props) {
  if (props.task.status !== "open" || props.task.submissions.length) return null;
  return <Manager key={`${props.generation}:${props.task.id}:${props.task.version}`} {...props} />;
}
function Manager({ task, generation, userId, onRefresh }: Props) {
  const t = useTranslations();
  const [allowed, setAllowed] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<DeliveryCategory[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [template, setTemplate] = useState<DeliveryTemplate | null>();
  const [choice, setChoice] = useState<DeliveryCategory | null | undefined>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [failedSave, setFailedSave] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchTaskCommentAccess(task.crewId, userId, controller.signal).then(
      (a) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setAllowed(a.canManage);
      },
      (e) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setError(String(e instanceof Error ? e.message : e));
      }
    );
    return () => {
      controller.abort();
      active.current?.abort();
      active.current = null;
    };
  }, [task.crewId, userId, generation]);
  async function load(more = false) {
    if (active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const [page, current] = await Promise.all([
        fetchDeliveryCatalog(
          task.crewId,
          controller.signal,
          more ? (cursor ?? undefined) : undefined
        ),
        more ? Promise.resolve(undefined) : fetchTaskDeliveryTemplate(task.id, controller.signal),
      ]);
      if (controller.signal.aborted || generation !== getAuthGeneration()) return;
      if (more && page.nextCursor === cursor)
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
  }
  async function save() {
    if (
      !allowed ||
      choice === undefined ||
      busy ||
      active.current ||
      failedSave ||
      error ||
      generation !== getAuthGeneration()
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      await setDeliveryTemplate(
        task.id,
        task.version,
        choice ? { id: choice.id, version: choice.version } : null,
        generation,
        controller.signal
      );
      if (!controller.signal.aborted && generation === getAuthGeneration()) onRefresh();
    } catch (e) {
      if (!controller.signal.aborted && generation === getAuthGeneration()) {
        setError(e instanceof Error ? e.message : String(e));
        setFailedSave(true);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  const selected = choice === undefined ? template?.definition : choice?.definition;
  return (
    <View style={{ gap: 8 }}>
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onRefresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      )}
      {busy && <ActivityIndicator />}
      {allowed && !expanded && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void load()}>
          <ThemedText>{t("taskDelivery.manage")}</ThemedText>
        </Pressable>
      )}
      {allowed && expanded && (
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
              {t("taskDelivery.noTemplate")}
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
                    : choice?.id === row.id,
              }}
              disabled={busy || failedSave}
              onPress={() => setChoice(row)}
            >
              <ThemedText>
                {(
                  choice === undefined
                    ? template?.categoryId === row.id && template.version === row.version
                    : choice?.id === row.id
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
              onPress={() => void load(true)}
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
          <Pressable
            style={{ paddingVertical: 12 }}
            accessibilityRole="button"
            disabled={choice === undefined || busy || failedSave || !!error}
            onPress={() => void save()}
          >
            <ThemedText>{t("taskDelivery.saveTemplate")}</ThemedText>
          </Pressable>
          <Pressable
            style={{ paddingVertical: 12 }}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setExpanded(false);
              setChoice(undefined);
            }}
          >
            <ThemedText>{t("common.cancel")}</ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}
