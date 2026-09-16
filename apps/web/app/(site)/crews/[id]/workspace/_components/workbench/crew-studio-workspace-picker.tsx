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
      key={`${props.crewId}:${user?.id}:${props.disabled}`}
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
  async function select(workspaceId: string | null) {
    if (!active.current || !userId || request.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError(null);
    try {
      await crewApi.patch(`/crews/${encodeURIComponent(crewId)}/studio-workspace`, {
        body: { workspaceId },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await client.invalidateQueries({
        queryKey: [...crewKeys.productionOverview(crewId), userId],
      });
      if (controller.signal.aborted) return;
      await client.invalidateQueries({ queryKey: ["crew-studio-workspaces", crewId, userId] });
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
          if (!saving) setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            color="muted"
            variant="ghost"
            disabled={disabled}
            loading={saving}
            icon={<IconLink className="size-3.5" />}
            className="max-w-48 text-xs"
          >
            <span className="truncate">
              {value?.name ?? (legacy ? t("legacyProject", { name: legacy.name }) : t("link"))}
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
                  disabled={saving}
                  onSelect={() => void select(workspace.id)}
                >
                  <IconBuilding className="size-4" />
                  <span className="truncate">{workspace.name}</span>
                </CommandItem>
              ))}
              {value || legacy ? (
                <CommandItem disabled={saving} onSelect={() => void select(null)}>
                  {legacy ? t("unlinkProject") : t("unlink")}
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <a
          className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:text-white"
          href={`${getStudioHref(locale)}/projects?ws=${encodeURIComponent(value.id)}`}
        >
          {t("open")}
        </a>
      ) : null}
    </>
  );
}
