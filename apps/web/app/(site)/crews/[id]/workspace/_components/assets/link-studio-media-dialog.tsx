"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useTranslations } from "@/src/i18n/i18n";
import {
  useCrewStudioMediaOptions,
  useLinkCrewStudioMedia,
  useSetCrewAssetStudioLink,
} from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets";

interface LinkStudioMediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  parentId: string | null;
  bindNodeId?: string | null;
}

export function LinkStudioMediaDialog(props: LinkStudioMediaDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open || !user) return null;
  return (
    <StudioMediaSession
      key={JSON.stringify([user.id, props.crewId, props.parentId, props.bindNodeId])}
      {...props}
    />
  );
}

function StudioMediaSession({
  open,
  onOpenChange,
  crewId,
  parentId,
  bindNodeId = null,
}: LinkStudioMediaDialogProps) {
  const t = useTranslations("crewAssets");
  const bind = Boolean(bindNodeId);
  const [projectKey, setProjectKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const filter = projectKey.startsWith("story:")
    ? { storyProjectId: projectKey.slice(6) }
    : projectKey.startsWith("canvas:")
      ? { projectId: projectKey.slice(7) }
      : undefined;
  const options = useCrewStudioMediaOptions(crewId, open, filter);
  const pull = useLinkCrewStudioMedia(crewId);
  const setLink = useSetCrewAssetStudioLink(crewId);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const pending = saving || pull.isPending || setLink.isPending;
  const ready =
    options.isSuccess &&
    !options.isFetching &&
    !options.isError &&
    Boolean(options.data?.workspaceId);
  const selectionValid =
    selected.size > 0 &&
    [...selected].every((id) => options.data?.items.some((item) => item.id === id));

  const close = () => {
    if (busy.current || pending) return;
    setSelected(new Set());
    setProjectKey("");
    onOpenChange(false);
  };

  const toggle = (id: string) => {
    if (busy.current || pending || !ready) return;
    setSelected((current) => {
      if (bind) return new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    const mediaAssetIds = [...selected];
    if (!active.current || busy.current || pending || !ready || !selectionValid) return;
    busy.current = true;
    setSaving(true);
    const projectId = filter?.projectId ?? null;
    const storyProjectId = filter?.storyProjectId ?? null;
    try {
      if (bind && bindNodeId) {
        await setLink.mutateAsync({
          nodeId: bindNodeId,
          mediaAssetId: mediaAssetIds[0]!,
          projectId,
          storyProjectId,
        });
        if (!active.current) return;
        toast.success(t("bindStudioSaved"));
      } else {
        const result = await pull.mutateAsync({
          parentId,
          mediaAssetIds,
          projectId,
          storyProjectId,
        });
        if (!active.current) return;
        toast.success(t("linkStudioAdded", { count: result.items.length }));
      }
      onOpenChange(false);
    } catch (error) {
      if (active.current)
        toast.error(error instanceof Error && error.message ? error.message : t("operationFailed"));
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };

  const workspaceMissing = options.data && !options.data.workspaceId;
  const empty = options.data && options.data.workspaceId && options.data.items.length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bind ? t("bindStudioTitle") : t("linkStudioTitle")}</DialogTitle>
          <DialogDescription>{t("linkStudioSelect")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {options.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : options.isError ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{options.error instanceof Error ? options.error.message : t("loadFailed")}</p>
              <Button type="button" variant="outline" onClick={() => void options.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : workspaceMissing ? (
            <p className="text-sm text-muted-foreground">{t("linkStudioEmptyWorkspace")}</p>
          ) : (
            <>
              <NativeSelect
                value={projectKey}
                disabled={pending}
                onChange={(value) => {
                  if (busy.current || pending) return;
                  setProjectKey(value);
                  setSelected(new Set());
                }}
                aria-label={t("linkStudioAllProjects")}
                className="h-9 w-full"
              >
                <option value="">{t("linkStudioAllProjects")}</option>
                {(options.data?.projects ?? []).map((project) => (
                  <option
                    key={`${project.kind}:${project.id}`}
                    value={`${project.kind}:${project.id}`}
                  >
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
              {empty ? (
                <p className="text-sm text-muted-foreground">{t("linkStudioEmptyMedia")}</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {(options.data?.items ?? []).map((item) => {
                    const checked = selected.has(item.id);
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary/40">
                          <input
                            type={bind ? "radio" : "checkbox"}
                            checked={checked}
                            disabled={pending || !ready}
                            onChange={() => toggle(item.id)}
                            className="size-3.5 accent-primary"
                          />
                          {item.contentType.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.previewUrl}
                              alt=""
                              className="size-10 rounded object-cover"
                            />
                          ) : (
                            <span className="grid size-10 place-items-center rounded bg-secondary text-[10px] uppercase text-muted-foreground">
                              {item.kind}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                            {item.name}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" color="muted" disabled={pending} onClick={close}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending || !ready || !selectionValid}
            loading={pending}
            onClick={() => void submit()}
          >
            {bind ? t("bindStudioConfirm") : t("linkStudioConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
