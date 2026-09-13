"use client";

import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FIELD_CONTROL } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  moveStoryProject,
  storyApiErrorMessage,
  type StoryProjectSummary,
} from "@/lib/story-projects-api";

export function MoveStoryProjectDialog({
  project,
  onClose,
}: {
  project: StoryProjectSummary;
  onClose: () => void;
}) {
  const t = useTranslations("storyStudio");
  const destinationId = useId();
  const { workspaces, setActiveWorkspaceId, refresh } = useWorkspace();
  const queryClient = useQueryClient();
  const destinations = workspaces.filter(
    (workspace) =>
      workspace.id !== project.workspaceId &&
      workspace.accessScope !== "project_only" &&
      ["owner", "admin"].includes(workspace.role ?? "")
  );
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const move = useMutation({
    mutationFn: () =>
      moveStoryProject(project.id, {
        targetWorkspaceId,
        expectedWorkspaceId: project.workspaceId,
        expectedProjectVersion: project.projectVersion,
      }),
    onSuccess: async (result) => {
      setActiveWorkspaceId(result.workspaceId);
      refresh();
      await queryClient.invalidateQueries({ queryKey: ["story-studio"] });
      toast.success(t("move.success"));
      onClose();
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("move.failed"))),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !move.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("move.title", { title: project.title })}</DialogTitle>
          <DialogDescription>{t("move.description")}</DialogDescription>
        </DialogHeader>
        <Field label={t("move.destination")} htmlFor={destinationId} required>
          <Select
            value={targetWorkspaceId}
            onValueChange={setTargetWorkspaceId}
            disabled={move.isPending || destinations.length === 0}
            required
          >
            <SelectTrigger
              id={destinationId}
              aria-required="true"
              className={`${FIELD_CONTROL} w-full data-[size=default]:h-11`}
            >
              <SelectValue placeholder={t("move.choose")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                {destinations.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <p className="text-sm text-white/50">
          {destinations.length ? t("move.credits") : t("move.noDestination")}
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={move.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={() => move.mutate()} disabled={!targetWorkspaceId || move.isPending}>
            {t(move.isPending ? "move.moving" : "move.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
