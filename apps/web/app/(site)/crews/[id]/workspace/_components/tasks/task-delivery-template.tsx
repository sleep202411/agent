"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import {
  crewKeys,
  crewAccountQueries,
  crewTaskDetailQueries,
} from "@/app/(site)/crews/_hooks/shared";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import type { CrewDeliveryTemplateDTO, CrewTaskDTO } from "@/app/(site)/crews/_hooks/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
export function useTaskDeliveryTemplate(taskId?: string, enabled = true) {
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: ["task-delivery-template", taskId, user?.id],
    enabled: !!user && !!taskId && enabled,
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<CrewDeliveryTemplateDTO | null>(`/crew-tasks/${taskId}/delivery-template`, {
        signal,
      }),
  });
  return { ...query, accountId: user?.id };
}

export function DeliveryReferencePrices({
  definition,
}: {
  definition: CrewDeliveryTemplateDTO["definition"];
}) {
  const t = useTranslations("crewDeliveryTemplate");
  if (!definition.prices?.length) return null;
  return (
    <aside className="space-y-1 text-xs text-muted-foreground">
      <p>{t("referencePrices")}</p>
      {definition.prices.map((price) => {
        const digits = price.amountMinor.padStart(3, "0");
        return (
          <p key={price.currency}>
            {price.currency} {digits.slice(0, -2)}.{digits.slice(-2)} / {price.unit}
          </p>
        );
      })}
      <p>{t("referencePriceNote")}</p>
    </aside>
  );
}

export function TaskDeliveryFields({
  template,
  answers,
  onChange,
  assets,
  disabled,
}: {
  template: CrewDeliveryTemplateDTO;
  answers: Record<string, string | string[]>;
  onChange: (answers: Record<string, string | string[]>) => void;
  assets: { id: string; name: string }[];
  disabled: boolean;
}) {
  const t = useTranslations("crewDeliveryTemplate");
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <h3 className="text-sm font-medium sm:col-span-2">
        {template.definition.name} · {t("revision")} {template.version}
      </h3>
      <div className="sm:col-span-2">
        <DeliveryReferencePrices definition={template.definition} />
      </div>
      {template.definition.fields.map((field) => (
        <div
          key={field.key}
          className={`space-y-2 rounded-lg bg-white/[0.035] p-4 text-sm ${field.type === "text" ? "sm:col-span-2" : ""}`}
        >
          <p>
            {field.label}
            {field.required ? ` (${t("required")})` : ""}
          </p>
          {field.instructions ? (
            <p className="text-xs text-muted-foreground">{field.instructions}</p>
          ) : null}
          {field.type === "text" ? (
            <Textarea
              aria-label={field.label}
              disabled={disabled}
              required={field.required}
              maxLength={5000}
              value={typeof answers[field.key] === "string" ? (answers[field.key] as string) : ""}
              onChange={(e) => onChange({ ...answers, [field.key]: e.target.value })}
            />
          ) : (
            <div className="space-y-1">
              {!assets.length ? (
                <p>{t("selectAttachments")}</p>
              ) : (
                assets.map((asset) => {
                  const selected = Array.isArray(answers[field.key])
                    ? (answers[field.key] as string[])
                    : [];
                  return (
                    <label key={asset.id} className="flex items-center gap-2">
                      <Checkbox
                        disabled={disabled}
                        checked={selected.includes(asset.id)}
                        onCheckedChange={() =>
                          onChange({
                            ...answers,
                            [field.key]: selected.includes(asset.id)
                              ? selected.filter((id) => id !== asset.id)
                              : [...selected, asset.id],
                          })
                        }
                      />
                      {asset.name}
                    </label>
                  );
                })
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
export function TaskDeliveryTemplatePanel(props: { task: CrewTaskDTO; canManage: boolean }) {
  const { user } = useCurrentUser();
  return user ? <TemplatePanel key={`${user.id}:${props.task.id}`} {...props} /> : null;
}
function TemplatePanel({ task, canManage }: { task: CrewTaskDTO; canManage: boolean }) {
  const t = useTranslations("crewDeliveryTemplate"),
    { user } = useCurrentUser();
  const qc = useQueryClient();
  const refreshTask = () => {
    if (!user?.id) return;
    void qc.invalidateQueries({ queryKey: [...crewKeys.task(task.id), user.id] });
    void qc.invalidateQueries(crewTaskDetailQueries(task.crewId, task.id, user.id));
    void qc.invalidateQueries(crewAccountQueries(crewKeys.tasks(task.crewId), user.id));
    void qc.invalidateQueries(crewAccountQueries(crewKeys.taskTimeline(task.id), user.id));
  };
  const current = useTaskDeliveryTemplate(task.id);
  const requirementsLocked = task.status !== "open" || task.submissions.length > 0;
  type Category = {
    id: string;
    version: number;
    definition: CrewDeliveryTemplateDTO["definition"];
  };
  const catalog = useInfiniteQuery({
    queryKey: ["crew-delivery-catalog", task.crewId, user?.id],
    enabled: canManage,
    initialPageParam: undefined as string | undefined,
    retry: false,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: Category[]; nextCursor: string | null }>(
        `/crews/${task.crewId}/delivery-catalog`,
        { signal, query: { cursor: pageParam, limit: 50 } }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [draft, setDraft] = useState<{ choice: string; expectedVersion: number } | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    []
  );
  const choice = draft?.choice ?? null;
  const categories = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const currentKey = current.data ? `${current.data.categoryId}:${current.data.version}` : "";
  const selectedDefinition =
    requirementsLocked || choice === null
      ? current.data?.definition
      : categories.find((row) => `${row.id}:${row.version}` === choice)?.definition;
  async function save() {
    if (
      active.current ||
      !draft ||
      !canManage ||
      requirementsLocked ||
      current.isError ||
      catalog.isError ||
      current.isPending ||
      catalog.isPending
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(null);
    try {
      const [id, version] = draft.choice.split(":");
      await crewApi.post(`/crew-tasks/${task.id}/delivery-template`, {
        signal: controller.signal,
        body: {
          expectedVersion: draft.expectedVersion,
          category: draft.choice ? { id, version: Number(version) } : null,
        },
      });
      if (!controller.signal.aborted) {
        setDraft(null);
        await current.refetch();
        if (!controller.signal.aborted) refreshTask();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="space-y-3 border-t border-white/[0.055] py-5 text-[13px] text-[#b8bac0]">
      <h3 className="text-xs font-semibold text-[#d7d9de]">{t("title")}</h3>
      {current.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : !current.isError ? (
        <p>
          {current.data
            ? `${current.data.definition.name} · ${t("revision")} ${current.data.version}`
            : t("none")}
        </p>
      ) : null}
      {current.error || catalog.error || error ? (
        <div role="alert" className="space-y-2">
          <p className="break-words text-[#e85b60]">
            {error ?? current.error?.message ?? catalog.error?.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            color="muted"
            disabled={pending}
            onClick={() => {
              void current.refetch();
              if (canManage) void catalog.refetch();
              refreshTask();
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {canManage && requirementsLocked ? (
        <p className="text-xs text-muted-foreground">{t("requirementsLocked")}</p>
      ) : null}
      {canManage && !requirementsLocked && (categories.length > 0 || current.data) ? (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            className="min-w-0 flex-1 basis-52"
            aria-label={t("title")}
            disabled={
              pending ||
              current.isPending ||
              catalog.isPending ||
              current.isError ||
              catalog.isError
            }
            value={choice ?? currentKey}
            onChange={(choice) => setDraft({ choice, expectedVersion: task.version })}
          >
            <NativeSelectOption value="">{t("none")}</NativeSelectOption>
            {current.data &&
            !categories.some((row) => `${row.id}:${row.version}` === currentKey) ? (
              <NativeSelectOption value={currentKey}>
                {current.data.definition.name} · {t("revision")} {current.data.version}
              </NativeSelectOption>
            ) : null}
            {categories.map((row) => (
              <NativeSelectOption key={row.id} value={`${row.id}:${row.version}`}>
                {row.definition.name} · {t("revision")} {row.version}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            variant="outline"
            color="muted"
            disabled={pending || choice === null || current.isError || catalog.isError}
            onClick={() => void save()}
          >
            {t("save")}
          </Button>
          {catalog.hasNextPage ? (
            <Button
              size="sm"
              variant="ghost"
              color="muted"
              disabled={pending || catalog.isFetching}
              onClick={() => void catalog.fetchNextPage({ cancelRefetch: false })}
            >
              {t("more")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {selectedDefinition ? <DeliveryReferencePrices definition={selectedDefinition} /> : null}
      {task.submissions
        .filter((submission) => submission.professionalDelivery?.categoryId)
        .map((submission) => {
          const form = submission.professionalDelivery!;
          return (
            <div key={submission.id} className="space-y-1">
              <p>
                {form.definition.name} · {t("revision")} {form.version}
              </p>
              {form.definition.fields.map((field) => (
                <p key={field.key}>
                  <strong>{field.label}: </strong>
                  {Array.isArray(form.answers[field.key])
                    ? (form.answers[field.key] as string[])
                        .map(
                          (id) =>
                            submission.assets.find((asset) => asset.id === id)?.name ??
                            t("unavailableAttachment")
                        )
                        .join(", ")
                    : form.answers[field.key]}
                </p>
              ))}
            </div>
          );
        })}
    </section>
  );
}
