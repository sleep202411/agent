"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBuilding, IconLink } from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { getStudioHref } from "@/src/lib/region/cell";
import { crewApi } from "@/app/(site)/crews/_hooks/api";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";

type Workspace = { id: string; name: string };
export function CrewStudioWorkspacePicker(props: {
  crewId: string;
  value: Workspace | null;
  legacyProject?: Workspace | null;
  disabled: boolean;
}) {
  const { user } = useCurrentUser();
  return (
    <WorkspacePickerSession
      key={JSON.stringify([
        props.crewId,
        user?.id,
        props.disabled,
        props.value?.id,
        props.legacyProject?.id,
      ])}
      {...props}
      userId={user?.id ?? ""}
    />
  );
}
function WorkspacePickerSession({
  crewId,
  userId,
  value,
  legacyProject,
  disabled,
}: {
  crewId: string;
  userId: string;
  value: Workspace | null;
  legacyProject?: Workspace | null;
  disabled: boolean;
}) {
  const t = useTranslations("crewWorkspaceLink");
  const locale = useLocale();
  const legacy = value ? null : legacyProject;
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [initialized, setInitialized] = useState<Workspace | null>(null);
  const linkedWorkspace = value ?? initialized;
  const canInitialize = !disabled && Boolean(userId) && !linkedWorkspace && !legacyProject;

  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  const options = useQuery({
    queryKey: ["crew-studio-workspaces", crewId, userId],
    queryFn: ({ signal }) =>
      crewApi.get<Workspace[]>(`/crews/${encodeURIComponent(crewId)}/studio-workspace-options`, {
        signal,
      }),
    enabled: open && !disabled && Boolean(userId),
    retry: false,
  });
  const sourceReady = options.isSuccess && !options.isFetching && !options.isError;
  async function select(workspaceId: string | null, initialize = false) {
    if (!active.current || !userId || request.current || disabled || !sourceReady) return;
    if (workspaceId && !options.data?.some((workspace) => workspace.id === workspaceId)) return;
    if (initialize && (!canInitialize || !confirmCreate || !sourceReady)) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError(null);
    try {
      if (initialize) {
        const result = await crewApi.post<{ studioWorkspace: Workspace; created: boolean }>(
          `/crews/${encodeURIComponent(crewId)}/studio-workspace/initialize`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setInitialized(result.studioWorkspace);
      } else {
        await crewApi.patch(`/crews/${encodeURIComponent(crewId)}/studio-workspace`, {
          body: { workspaceId },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setInitialized(null);
      }
      setConfirmCreate(false);
      if (controller.signal.aborted) return;
      await client.invalidateQueries({
        queryKey: crewKeys.assets(crewId),
        predicate: (query) => query.queryKey.at(-1) === userId,
      });
      if (controller.signal.aborted) return;
      await client.invalidateQueries({ queryKey: ["crew-studio-workspaces", crewId, userId] });
      if (controller.signal.aborted) return;
      await client.invalidateQueries({
        queryKey: [...crewKeys.productionOverview(crewId), userId],
      });
      if (controller.signal.aborted) return;
      if (!controller.signal.aborted) setOpen(false);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!saving) {
            setOpen(next);
            setConfirmCreate(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            color="muted"
            variant="ghost"
            disabled={disabled}
            loading={saving}
            icon={<IconLink className="size-3.5" />}
            className="max-w-48 rounded-md border border-white/15 bg-white/5 text-xs hover:bg-white/10"
          >
            <span className="truncate">
              {linkedWorkspace?.name ??
                (legacy ? t("legacyProject", { name: legacy.name }) : t("link"))}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-3">
          <p className="mb-3 text-xs text-muted-foreground">
            {legacy ? t("legacyDescription", { name: legacy.name }) : t("description")}
          </p>
          {error || options.isError ? (
            <div role="alert" className="mb-2 text-xs text-destructive">
              {error ?? options.error?.message}
              <Button
                color="muted"
                variant="ghost"
                disabled={saving}
                onClick={() => void options.refetch()}
              >
                {t("retry")}
              </Button>
            </div>
          ) : null}
          <Command>
            <CommandInput placeholder={t("search")} disabled={saving} />
            <CommandList>
              <CommandEmpty>{options.isPending ? t("loading") : t("empty")}</CommandEmpty>
              {options.data?.map((workspace) => (
                <CommandItem
                  key={workspace.id}
                  value={`${workspace.name} ${workspace.id}`}
                  disabled={saving || !sourceReady}
                  onSelect={() => void select(workspace.id)}
                >
                  <IconBuilding className="size-4" />
                  <span className="truncate">{workspace.name}</span>
                </CommandItem>
              ))}
              {linkedWorkspace || legacy ? (
                <CommandItem disabled={saving || !sourceReady} onSelect={() => void select(null)}>
                  {legacy ? t("unlinkProject") : t("unlink")}
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>
          {canInitialize ? (
            <div className="mt-3 space-y-2">
              {confirmCreate ? (
                <>
                  <p className="text-xs text-muted-foreground">{t("createDescription")}</p>
                  <div className="flex gap-2">
                    <Button
                      disabled={saving || !sourceReady}
                      loading={saving}
                      onClick={() => void select(null, true)}
                    >
                      {t("createConfirm")}
                    </Button>
                    <Button
                      variant="ghost"
                      color="muted"
                      disabled={saving}
                      onClick={() => setConfirmCreate(false)}
                    >
                      {t("createCancel")}
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  variant="outline"
                  color="muted"
                  disabled={saving || !sourceReady}
                  className="h-8 px-3 text-xs"
                  onClick={() => setConfirmCreate(true)}
                >
                  {t("create")}
                </Button>
              )}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {linkedWorkspace ? (
        <a
          className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:text-white"
          href={`${getStudioHref(locale)}/projects?ws=${encodeURIComponent(linkedWorkspace.id)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("open")}
        </a>
      ) : null}
    </>
  );
}
